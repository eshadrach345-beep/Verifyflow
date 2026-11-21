"use strict";

function calculateVat(subtotalMinor, env = process.env) {
  if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor <= 0) {
    const error = new Error("A valid pre-tax retail amount is required.");
    error.code = "VAT_SUBTOTAL_INVALID";
    throw error;
  }
  const enabled = String(env.VERIFYFLOW_VAT_ENABLED || "").trim().toLowerCase() === "true";
  const registered = String(env.VERIFYFLOW_VAT_REGISTERED || "").trim().toLowerCase() === "true";
  if (!enabled || !registered) {
    const error = new Error("VAT collection is not enabled for this registered merchant.");
    error.code = "VAT_NOT_CONFIGURED";
    throw error;
  }
  const rawRate = String(env.VERIFYFLOW_VAT_RATE || "7.5").trim();
  const rate = Number(rawRate);
  if (!/^(?:0|[1-9][0-9]?)(?:\.[0-9]{1,4})?$/.test(rawRate) || !Number.isFinite(rate) || rate <= 0 || rate > 100) {
    const error = new Error("The VAT rate configuration is invalid.");
    error.code = "VAT_RATE_INVALID";
    throw error;
  }
  const vatMinor = Math.round(subtotalMinor * rate / 100);
  const totalUsdMinor = subtotalMinor + vatMinor;
  if (!Number.isSafeInteger(totalUsdMinor) || totalUsdMinor <= subtotalMinor) {
    const error = new Error("The VAT-inclusive checkout amount is invalid.");
    error.code = "VAT_TOTAL_INVALID";
    throw error;
  }
  return { subtotalMinor, rate, vatMinor, totalUsdMinor, currency: "USD" };
}

module.exports = { calculateVat };
