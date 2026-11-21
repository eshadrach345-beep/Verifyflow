"use strict";

const { createHmac, timingSafeEqual } = require("node:crypto");

function getSquadConfig() {
  const secretKey = String(process.env.SQUAD_SECRET_KEY || "").trim();
  const baseUrl = String(process.env.SQUAD_API_BASE_URL || "").replace(/\/+$/, "");
  if (!secretKey || !baseUrl) {
    const error = new Error("Squad payment credentials are not configured.");
    error.code = "SQUAD_CONFIG_MISSING";
    throw error;
  }
  if (!/^https:\/\//i.test(baseUrl)) throw new Error("Invalid Squad API base URL.");
  return { secretKey, baseUrl, environment: String(process.env.SQUAD_ENVIRONMENT || "sandbox").toLowerCase() };
}

async function squadRequest(path, options = {}) {
  const config = getSquadConfig();
  const response = await fetch(config.baseUrl + path, {
    method: options.method || "GET",
    headers: {
      Authorization: "Bearer " + config.secretKey,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(20000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const error = new Error("Squad payment request failed.");
    error.code = "SQUAD_API_ERROR";
    error.status = response.status;
    // Keep diagnostics useful without logging credentials or the full provider payload.
    error.providerMessage = String(payload.message || payload.error || "No provider message returned").slice(0, 240);
    error.providerCode = payload.code ? String(payload.code).slice(0, 80) : undefined;
    throw error;
  }
  return payload;
}

async function initiateSquadPayment({ email, customerName, amountMinor, currency, reference, callbackUrl, metadata }) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) throw new Error("Invalid Squad payment amount.");
  const payload = await squadRequest("/transaction/initiate", {
    method: "POST",
    body: {
      email, amount: amountMinor, currency,
      customer_name: customerName || undefined,
      initiate_type: "inline",
      transaction_ref: reference,
      callback_url: callbackUrl,
      payment_channels: ["card", "bank", "ussd", "transfer"],
      metadata: metadata || {},
      pass_charge: false
    }
  });
  const checkoutUrl = payload.data?.checkout_url || payload.checkout_url || payload.data?.checkoutUrl;
  if (!checkoutUrl) {
    const error = new Error("Squad did not return a checkout URL.");
    error.code = "SQUAD_CHECKOUT_URL_MISSING";
    throw error;
  }
  let parsed;
  try { parsed = new URL(checkoutUrl); } catch { throw new Error("Squad returned an invalid checkout URL."); }
  if (parsed.protocol !== "https:" || !(parsed.hostname.toLowerCase() === "squadco.com" || parsed.hostname.toLowerCase().endsWith(".squadco.com"))) {
    throw new Error("Squad returned an untrusted checkout URL.");
  }
  return { checkoutUrl, raw: payload };
}

async function verifySquadTransaction(reference) {
  const payload = await squadRequest("/transaction/verify/" + encodeURIComponent(reference));
  const data = payload.data || {};
  return {
    reference: String(data.transaction_ref || ""),
    status: String(data.transaction_status || "Pending").toLowerCase(),
    amountMinor: Number(data.transaction_amount),
    currency: String(data.transaction_currency_id || "").toUpperCase(),
    email: String(data.email || ""),
    gatewayReference: data.gateway_transaction_ref || null,
    raw: payload
  };
}

function verifySquadWebhook(rawBody, signature) {
  const { secretKey } = getSquadConfig();
  if (!signature) return false;
  const suppliedText = String(signature).trim().replace(/^sha512=/i, "");
  const expected = createHmac("sha512", secretKey).update(rawBody).digest();
  const candidates = [];
  try { candidates.push(Buffer.from(suppliedText, "hex")); } catch {}
  try { candidates.push(Buffer.from(suppliedText, "base64")); } catch {}
  return candidates.some(value => value.length === expected.length && timingSafeEqual(value, expected));
}

module.exports = { getSquadConfig, squadRequest, initiateSquadPayment, verifySquadTransaction, verifySquadWebhook };
