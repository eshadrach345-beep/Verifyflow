const { getPool } = require("./auth");
const { getTransactionByPaymentReference, parseMinorUnits } = require("./monnify");
const { enqueuePaidOrder, processFulfilmentForOrder } = require("./fulfilment");

async function verifyAndApplyPayment(paymentReference) {
  const providerResult = await getTransactionByPaymentReference(paymentReference);
  const providerData = providerResult.responseBody || {};
  if (providerData.paymentReference !== paymentReference) {
    const error = new Error("Monnify returned a different payment reference.");
    error.code = "PAYMENT_REFERENCE_MISMATCH";
    throw error;
  }

  const providerStatus = String(providerData.paymentStatus || "").toUpperCase();
  const paidMinor = parseMinorUnits(providerData.amountPaid);
  const currency = String(providerData.currencyCode || providerData.currency || "").toUpperCase();
  const safeResponse = {
    paymentStatus: providerStatus || null,
    amountPaid: providerData.amountPaid ?? null,
    currencyCode: currency || null,
    paymentMethod: providerData.paymentMethod || null,
    transactionReference: providerData.transactionReference || null,
    paidOn: providerData.paidOn || null
  };

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      "SELECT p.id AS payment_id, p.order_id, p.currency, p.amount_minor, " +
      "p.status AS payment_status, o.status AS order_status, o.provider AS order_provider, o.metadata AS order_metadata " +
      "FROM vf_payments p JOIN vf_orders o ON o.id = p.order_id " +
      "WHERE p.payment_reference = $1 FOR UPDATE OF p, o",
      [paymentReference]
    );
    if (!found.rowCount) {
      const error = new Error("Payment reference was not found.");
      error.code = "PAYMENT_NOT_FOUND";
      throw error;
    }

    const payment = found.rows[0];
    const expectedCurrency = String(payment.currency).trim().toUpperCase();
    const expectedMinor = Number(payment.amount_minor);
    let nextStatus = "pending";

    if (providerStatus === "PAID") {
      nextStatus = paidMinor === expectedMinor && currency === expectedCurrency
        ? "paid" : "amount_mismatch";
    } else if (providerStatus === "FAILED") {
      nextStatus = "failed";
    } else if (providerStatus === "EXPIRED") {
      nextStatus = "expired";
    } else if (providerStatus === "REVERSED") {
      nextStatus = "reversed";
    }

    // A later pending/failed callback must never downgrade a verified payment.
    if (payment.payment_status === "paid" && nextStatus !== "reversed") {
      nextStatus = "paid";
    }

    await client.query(
      "UPDATE vf_payments SET status = $2, provider_status = $3, " +
      "transaction_reference = COALESCE($4, transaction_reference), " +
      "provider_response = $5::jsonb, verified_at = NOW(), updated_at = NOW() WHERE id = $1",
      [
        payment.payment_id, nextStatus, providerStatus || null,
        providerData.transactionReference || null, JSON.stringify(safeResponse)
      ]
    );

    if (nextStatus === "paid" && payment.order_status === "awaiting_payment") {
      await client.query(
        "UPDATE vf_orders SET status = 'paid', updated_at = NOW() " +
        "WHERE id = $1 AND status = 'awaiting_payment'",
        [payment.order_id]
      );
      await client.query(
        "INSERT INTO vf_order_events (order_id, event_type, message, details) " +
        "VALUES ($1, 'payment_confirmed', 'Payment verified with Monnify.', $2::jsonb)",
        [payment.order_id, JSON.stringify({
          paymentReference,
          transactionReference: providerData.transactionReference || null,
          currency,
          amountPaid: providerData.amountPaid ?? null
        })]
      );
      await enqueuePaidOrder(client, payment.order_id);
    } else if (nextStatus === "paid" && ["voidmob", "herosms"].includes(payment.order_provider)) {
      // Idempotently repair a missing queue row when Monnify retries a success notification.
      await enqueuePaidOrder(client, payment.order_id);
    } else if (nextStatus === "reversed" && payment.payment_status !== "reversed") {
      if (payment.order_status !== "completed") {
        await client.query(
          "UPDATE vf_orders SET status = 'failed', updated_at = NOW() " +
          "WHERE id = $1 AND status <> 'completed'",
          [payment.order_id]
        );
      }
      await client.query(
        "INSERT INTO vf_order_events (order_id, event_type, message, details) " +
        "VALUES ($1, 'payment_reversed', $2, $3::jsonb)",
        [payment.order_id,
          payment.order_status === "completed"
            ? "Monnify reversed a payment after the supplier service had completed. Admin investigation is required."
            : "Monnify reported that the payment was reversed.",
          JSON.stringify({ paymentReference, priorOrderStatus: payment.order_status })]
      );
    } else if ((nextStatus === "failed" || nextStatus === "expired") &&
               payment.order_status === "awaiting_payment") {
      await client.query(
        "UPDATE vf_orders SET status = 'failed', updated_at = NOW() " +
        "WHERE id = $1 AND status = 'awaiting_payment'",
        [payment.order_id]
      );
      await client.query(
        "INSERT INTO vf_order_events (order_id, event_type, message, details) " +
        "VALUES ($1, 'payment_not_completed', 'The Monnify checkout did not complete.', $2::jsonb)",
        [payment.order_id, JSON.stringify({ paymentReference, providerStatus })]
      );
    } else if (nextStatus === "amount_mismatch" &&
               payment.payment_status !== "amount_mismatch") {
      await client.query(
        "INSERT INTO vf_order_events (order_id, event_type, message, details) " +
        "VALUES ($1, 'payment_review', 'Payment amount or currency requires manual review.', $2::jsonb)",
        [payment.order_id, JSON.stringify({ paymentReference, providerStatus, currency })]
      );
    }

    await client.query("COMMIT");
    let fulfilment = null;
    if (nextStatus === "paid" && ["voidmob", "herosms"].includes(payment.order_provider)) {
      try {
        fulfilment = await processFulfilmentForOrder(payment.order_id);
      } catch (error) {
        // Payment confirmation is durable; a temporary fulfilment error must not make
        // Monnify retry an already-accepted payment event.
        console.error("[fulfilment/process]", error.code || error.message);
      }
    }
    const orderResult = await getPool().query("SELECT status FROM vf_orders WHERE id = $1", [payment.order_id]);
    return {
      paymentReference,
      status: nextStatus,
      providerStatus,
      amountPaid: providerData.amountPaid ?? null,
      currency,
      orderStatus: orderResult.rows[0]?.status || payment.order_status,
      fulfilment: fulfilment?.status || null
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { verifyAndApplyPayment };
