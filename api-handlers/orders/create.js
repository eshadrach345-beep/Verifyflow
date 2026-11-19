"use strict";

const { randomBytes, randomUUID } = require("node:crypto");
const { getPool, getSessionUser, sendJson, readJson, sameOrigin } = require("../../lib/auth");
const { getMonnifyConfig, initializeTransaction } = require("../../lib/monnify");
const { quoteProduct } = require("../../lib/voidmob");

function validCheckoutKey(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{20,80}$/.test(value);
}

function checkoutUrlIsSafe(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /(^|\.)monnify\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }
  if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: "Request could not be verified." });

  let body;
  try { body = await readJson(req); }
  catch { return sendJson(res, 400, { ok: false, error: "Please submit a valid order." }); }

  const checkoutKey = String(body.checkoutKey || "");
  if (!validCheckoutKey(checkoutKey)) {
    return sendJson(res, 400, { ok: false, error: "Refresh the product and try checkout again." });
  }

  try {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { ok: false, error: "Please sign in before placing an order." });

    // VerifyFlow uses USD product prices and Monnify's USD card checkout for global customers.
    if (process.env.MONNIFY_INTERNATIONAL_ENABLED !== "true") {
      return sendJson(res, 503, {
        ok: false,
        error: "USD international card checkout is not enabled on this Monnify account yet."
      });
    }
    const config = getMonnifyConfig();
    const selectedProvider = String(body.provider || "voidmob").toLowerCase();
    const providerFulfilmentEnabled = selectedProvider === "herosms"
      ? process.env.HEROSMS_FULFILMENT_ENABLED === "true" && process.env.HEROSMS_AUTOBUY_CONFIRMED === "true"
      : selectedProvider === "voidmob" && process.env.VOIDMOB_FULFILMENT_ENABLED === "true" && process.env.VOIDMOB_AUTOBUY_CONFIRMED === "true";
    if (!["voidmob", "herosms"].includes(selectedProvider)) {
      return sendJson(res, 400, { ok: false, error: "Choose a supported supplier." });
    }
    if (config.environment === "LIVE" &&
        (process.env.VERIFYFLOW_LIVE_ORDERS_ENABLED !== "true" || !providerFulfilmentEnabled)) {
      return sendJson(res, 503, {
        ok: false,
        error: "Live customer orders are still locked until payments, supplier auto-buy and fulfilment launch checks are complete."
      });
    }

    const productType = String(body.productType || "");
    const input = {
      productId: String(body.productId || ""),
      country: String(body.country || "us").toLowerCase(),
      durationDays: Number(body.durationDays),
      provider: selectedProvider
    };
    const quote = await quoteProduct(productType, input);
    if (!Number.isSafeInteger(quote.salePriceCents) || quote.salePriceCents <= 0 ||
        !Number.isSafeInteger(quote.supplierPriceCents) || quote.supplierPriceCents <= 0) {
      return sendJson(res, 503, { ok: false, error: "A current price could not be confirmed for this product." });
    }

    const pool = getPool();
    const existing = await pool.query(
      "SELECT o.id, o.order_number, o.status, p.payment_reference, p.checkout_url, p.status AS payment_status " +
      "FROM vf_orders o LEFT JOIN LATERAL (SELECT payment_reference, checkout_url, status FROM vf_payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1) p ON TRUE " +
      "WHERE o.user_id = $1 AND o.checkout_key = $2 LIMIT 1",
      [user.id, checkoutKey]
    );
    if (existing.rowCount) {
      const row = existing.rows[0];
      if (row.checkout_url && row.payment_status !== "paid") {
        return sendJson(res, 200, {
          ok: true, checkoutUrl: row.checkout_url, paymentReference: row.payment_reference,
          orderNumber: row.order_number, amountMinor: quote.salePriceCents, currency: "USD", reused: true
        });
      }
      return sendJson(res, 409, {
        ok: false,
        error: row.payment_status === "paid"
          ? "This checkout has already been paid. View your order in your account."
          : "This checkout is already being processed. Refresh your account orders."
      });
    }

    const orderId = randomUUID();
    const orderSuffix = randomBytes(6).toString("hex").toUpperCase();
    const orderNumber = "VF-" + orderSuffix;
    const paymentReference = "VF_" + randomBytes(12).toString("hex").toUpperCase();
    const orderIdempotencyKey = "vf-order-" + orderId.replace(/-/g, "");
    const redirectUrl = (process.env.PUBLIC_APP_URL || "https://verifyflow.us.ci").replace(/\/+$/, "") +
      "/payment-return.html?paymentReference=" + encodeURIComponent(paymentReference);

    const metadata = {
      platform: productType,
      checkout: {
        productSnapshot: quote.productSnapshot,
        supplierInput: quote.supplierInput,
        supplierPriceCents: quote.supplierPriceCents,
        retailPriceCents: quote.salePriceCents,
        currency: "USD",
        checkoutCreatedAt: new Date().toISOString()
      }
    };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO vf_orders (id, user_id, order_number, provider, product_type, product_name, status, currency, subtotal_minor, total_minor, idempotency_key, checkout_key, metadata) " +
        "VALUES ($1, $2, $3, $4, $5, $6, 'awaiting_payment', 'USD', $7, $7, $8, $9, $10::jsonb)",
        [orderId, user.id, orderNumber, quote.provider || selectedProvider, productType, quote.productName, quote.salePriceCents,
          orderIdempotencyKey, checkoutKey, JSON.stringify(metadata)]
      );
      await client.query(
        "INSERT INTO vf_payments (order_id, payment_reference, currency, amount_minor, status) " +
        "VALUES ($1, $2, 'USD', $3, 'initiated')",
        [orderId, paymentReference, quote.salePriceCents]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (error.code === "23505") {
        return sendJson(res, 409, { ok: false, error: "This checkout has already been started. Refresh your account orders." });
      }
      throw error;
    } finally {
      client.release();
    }

    try {
      const initialized = await initializeTransaction({
        amount: quote.salePriceCents / 100,
        customerName: user.full_name,
        customerEmail: user.email,
        paymentReference,
        paymentDescription: ("VerifyFlow " + quote.productName).slice(0, 120),
        currencyCode: "USD",
        contractCode: config.contractCode,
        redirectUrl,
        paymentMethods: ["CARD"]
      });
      const provider = initialized.responseBody || {};
      if (!checkoutUrlIsSafe(provider.checkoutUrl)) {
        const error = new Error("Monnify did not return a valid checkout URL.");
        error.code = "MONNIFY_CHECKOUT_URL_INVALID";
        throw error;
      }
      await pool.query(
        "UPDATE vf_payments SET checkout_url = $2, transaction_reference = $3, status = 'pending', provider_response = $4::jsonb, updated_at = NOW() WHERE payment_reference = $1",
        [paymentReference, provider.checkoutUrl, provider.transactionReference || null,
          JSON.stringify({ transactionReference: provider.transactionReference || null, enabledPaymentMethod: provider.enabledPaymentMethod || ["CARD"] })]
      );
      await pool.query(
        "INSERT INTO vf_order_events (order_id, event_type, message, details) VALUES ($1, 'checkout_created', 'Secure USD card checkout was created.', $2::jsonb)",
        [orderId, JSON.stringify({ paymentReference, amountMinor: quote.salePriceCents, currency: "USD" })]
      );
      return sendJson(res, 200, {
        ok: true, checkoutUrl: provider.checkoutUrl, paymentReference,
        orderNumber, productName: quote.productName, amountMinor: quote.salePriceCents, currency: "USD",
        note: "Payment is verified by Monnify before supplier fulfilment begins."
      });
    } catch (error) {
      await pool.query(
        "UPDATE vf_payments SET status = 'failed', provider_status = 'INITIALIZATION_FAILED', updated_at = NOW() WHERE payment_reference = $1",
        [paymentReference]
      ).catch(() => {});
      await pool.query(
        "UPDATE vf_orders SET status = 'failed', updated_at = NOW() WHERE id = $1 AND status = 'awaiting_payment'",
        [orderId]
      ).catch(() => {});
      await pool.query(
        "INSERT INTO vf_order_events (order_id, event_type, message, details) VALUES ($1, 'checkout_failed', 'Monnify could not initialize the checkout session.', $2::jsonb)",
        [orderId, JSON.stringify({ code: error.code || "MONNIFY_INITIALIZATION_FAILED" })]
      ).catch(() => {});
      console.error("[orders/create/monnify]", error.code || error.message);
      return sendJson(res, 502, { ok: false, error: "Secure checkout could not be started. No supplier order was placed." });
    }
  } catch (error) {
    console.error("[orders/create]", error.code || error.message);
    const status = error.status === 404 ? 404 : error.status === 409 ? 409 :
      error.code === "SUPPLIER_NOT_CONFIGURED" ? 503 :
      error.code === "COUNTRY_UNAVAILABLE" || error.code === "INVALID_DURATION" ? 400 : 503;
    const messages = {
      COUNTRY_UNAVAILABLE: "SMS verification and long-term rentals currently use US numbers only.",
      PRODUCT_UNAVAILABLE: "That product is currently unavailable. Please refresh the catalogue.",
      PRODUCT_NOT_FOUND: "That product could not be found. Please refresh the catalogue.",
      INVALID_DURATION: "Choose one of the available rental periods.",
      MONNIFY_LIVE_LOCKED: "Live payments are not enabled for this VerifyFlow account.",
      MONNIFY_CONFIG_MISSING: "Secure checkout is not fully configured yet.",
      SUPPLIER_NOT_CONFIGURED: "The supplier catalogue is temporarily unavailable.",
      SUPPLIER_PRICE_INVALID: "A current product price could not be confirmed.",
      INVALID_PRODUCT: "Please select a valid product from the catalogue."
    };
    return sendJson(res, status, { ok: false, error: messages[error.code] || "We couldn't prepare this order. Please refresh the catalogue and try again." });
  }
};
