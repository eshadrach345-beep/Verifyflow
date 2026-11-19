const { randomBytes } = require("node:crypto");
const { getPool, getSessionUser, sendJson, sameOrigin } = require("../../lib/auth");
const { getMonnifyConfig, initializeTransaction } = require("../../lib/monnify");

const TEST_AMOUNT_MINOR = 10000; // NGN 100.00; sandbox only; no service is delivered.

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }
  if (!sameOrigin(req)) {
    return sendJson(res, 403, { ok: false, error: "Request could not be verified." });
  }

  let orderId;
  let paymentReference;
  try {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { ok: false, error: "Please sign in before testing checkout." });
    const config = getMonnifyConfig();
    if (config.environment !== "SANDBOX") {
      return sendJson(res, 403, { ok: false, error: "The test checkout is only available in Sandbox." });
    }

    const suffix = randomBytes(10).toString("hex").toUpperCase();
    paymentReference = "VFTEST_" + suffix;
    const orderNumber = "VF-TEST-" + suffix;
    const origin = process.env.VERCEL_URL
      ? "https://" + process.env.VERCEL_URL
      : (process.env.PUBLIC_APP_URL || "https://verifyflow-five.vercel.app").replace(/\/+$/, "");
    const redirectUrl = origin + "/payment-return.html?paymentReference=" + encodeURIComponent(paymentReference);

    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const order = await client.query(
        "INSERT INTO vf_orders " +
        "(user_id, order_number, provider, product_type, product_name, status, currency, subtotal_minor, total_minor, metadata) " +
        "VALUES ($1, $2, 'manual', 'sms_otp', " +
        "'Monnify sandbox checkout test (no service supplied)', 'awaiting_payment', 'NGN', $3, $3, $4::jsonb) " +
        "RETURNING id",
        [user.id, orderNumber, TEST_AMOUNT_MINOR, JSON.stringify({ sandboxTest: true, noFulfilment: true })]
      );
      orderId = order.rows[0].id;
      await client.query(
        "INSERT INTO vf_payments (order_id, payment_reference, currency, amount_minor, status) " +
        "VALUES ($1, $2, 'NGN', $3, 'initiated')",
        [orderId, paymentReference, TEST_AMOUNT_MINOR]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    try {
      const initialized = await initializeTransaction({
        amount: TEST_AMOUNT_MINOR / 100,
        customerName: user.full_name,
        customerEmail: user.email,
        paymentReference,
        paymentDescription: "VerifyFlow sandbox checkout test - no service supplied",
        currencyCode: "NGN",
        contractCode: config.contractCode,
        redirectUrl,
        paymentMethods: ["CARD", "ACCOUNT_TRANSFER"]
      });
      const responseBody = initialized.responseBody || {};
      const checkoutUrl = responseBody.checkoutUrl;
      if (typeof checkoutUrl !== "string" || !checkoutUrl.startsWith("https://")) {
        const error = new Error("Monnify did not return a valid hosted checkout URL.");
        error.code = "MONNIFY_CHECKOUT_URL_MISSING";
        throw error;
      }

      await getPool().query(
        "UPDATE vf_payments SET checkout_url = $2, status = 'pending', updated_at = NOW() " +
        "WHERE payment_reference = $1",
        [paymentReference, checkoutUrl]
      );
      return sendJson(res, 200, {
        ok: true, checkoutUrl, paymentReference,
        amountMinor: TEST_AMOUNT_MINOR, currency: "NGN",
        note: "Sandbox test only. No VerifyFlow service will be supplied."
      });
    } catch (error) {
      await getPool().query(
        "UPDATE vf_payments SET status = 'failed', provider_status = 'INITIALIZATION_FAILED', updated_at = NOW() " +
        "WHERE payment_reference = $1",
        [paymentReference]
      ).catch(() => {});
      await getPool().query(
        "UPDATE vf_orders SET status = 'failed', updated_at = NOW() " +
        "WHERE id = $1 AND status = 'awaiting_payment'",
        [orderId]
      ).catch(() => {});
      console.error("[payments/create-test]", error.code || "MONNIFY_INITIALIZATION_FAILED");
      return sendJson(res, 502, {
        ok: false,
        error: "Monnify could not start the sandbox checkout. Check the API credentials and contract code."
      });
    }
  } catch (error) {
    console.error("[payments/create-test]", error.code || error.message);
    return sendJson(res, 503, {
      ok: false,
      error: "Sandbox checkout is temporarily unavailable. Please check the payment setup and try again."
    });
  }
};
