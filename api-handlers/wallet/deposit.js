"use strict";

const { randomBytes } = require("node:crypto");
const { getPool, getSessionUser, sendJson, readJson, sameOrigin } = require("../../lib/auth");
const { getMonnifyConfig, initializeTransaction } = require("../../lib/monnify");
const { getCheckoutAmount } = require("../../lib/checkout-currency");

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
  catch { return sendJson(res, 400, { ok: false, error: "Enter a valid wallet amount." }); }

  try {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { ok: false, error: "Please sign in to fund your wallet." });
    const walletAmountMinor = Number(body.amountUsdCents);
    if (!Number.isSafeInteger(walletAmountMinor) || walletAmountMinor < 500 || walletAmountMinor > 100000) {
      return sendJson(res, 400, { ok: false, error: "Wallet funding must be between $5 and $1,000 per deposit." });
    }

    const config = getMonnifyConfig();
    const checkout = getCheckoutAmount(walletAmountMinor);
    const paymentReference = "VFWALLET_" + randomBytes(12).toString("hex").toUpperCase();
    const redirectUrl = (process.env.PUBLIC_APP_URL || "https://verifyflow.us.ci").replace(/\/+$/, "") +
      "/payment-return.html?paymentReference=" + encodeURIComponent(paymentReference);
    const pool = getPool();
    await pool.query(
      "INSERT INTO vf_wallet_topups " +
      "(user_id, payment_reference, payment_currency, payment_amount_minor, wallet_amount_minor, status) " +
      "VALUES ($1, $2, $3, $4, $5, 'initiated')",
      [user.id, paymentReference, checkout.currency, checkout.amountMinor, walletAmountMinor]
    );

    try {
      const initialized = await initializeTransaction({
        amount: checkout.amountMinor / 100,
        customerName: user.full_name,
        customerEmail: user.email,
        paymentReference,
        paymentDescription: "VerifyFlow wallet funding",
        currencyCode: checkout.currency,
        contractCode: config.contractCode,
        redirectUrl
      });
      const provider = initialized.responseBody || {};
      if (!checkoutUrlIsSafe(provider.checkoutUrl)) {
        const error = new Error("Monnify did not return a valid checkout URL.");
        error.code = "MONNIFY_CHECKOUT_URL_INVALID";
        throw error;
      }
      await pool.query(
        "UPDATE vf_wallet_topups SET checkout_url = $2, transaction_reference = $3, " +
        "status = 'pending', provider_response = $4::jsonb, updated_at = NOW() WHERE payment_reference = $1",
        [paymentReference, provider.checkoutUrl, provider.transactionReference || null,
          JSON.stringify({ transactionReference: provider.transactionReference || null, enabledPaymentMethod: provider.enabledPaymentMethod || [] })]
      );
      return sendJson(res, 200, {
        ok: true,
        checkoutUrl: provider.checkoutUrl,
        paymentReference,
        walletAmountMinor,
        paymentAmountMinor: checkout.amountMinor,
        currency: checkout.currency,
        usdNgnRate: checkout.usdNgnRate,
        note: "Wallet funds are credited only after VerifyFlow verifies the completed Monnify transaction server-to-server."
      });
    } catch (error) {
      await pool.query(
        "UPDATE vf_wallet_topups SET status = 'failed', provider_status = 'INITIALIZATION_FAILED', updated_at = NOW() WHERE payment_reference = $1",
        [paymentReference]
      ).catch(() => {});
      console.error("[wallet/deposit/monnify]", error.code || error.message);
      return sendJson(res, 502, { ok: false, error: "Monnify could not start wallet funding. No wallet balance has been added." });
    }
  } catch (error) {
    console.error("[wallet/deposit]", error.code || error.message);
    const messages = {
      CHECKOUT_EXCHANGE_RATE_MISSING: "Local NGN wallet funding is not configured yet. Please contact support.",
      CHECKOUT_EXCHANGE_RATE_INVALID: "The local checkout exchange rate is invalid. Please contact support.",
      MONNIFY_CONFIG_MISSING: "Secure payments are not fully configured yet."
    };
    return sendJson(res, 503, { ok: false, error: messages[error.code] || "Wallet funding is temporarily unavailable." });
  }
};
