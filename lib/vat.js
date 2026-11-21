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
    return { subtotalMinor, rate: 0, vatMinor: 0, totalUsdMinor: subtotalMinor, currency: "USD", taxStatus: "not_assessed" };
  }
  const error = new Error("VAT requires a verified customer tax jurisdiction and product tax classification.");
  error.code = "VAT_JURISDICTION_REQUIRED";
  throw error;
}

module.exports = { calculateVat };
