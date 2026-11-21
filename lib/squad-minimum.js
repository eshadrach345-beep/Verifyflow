"use strict";

const SQUAD_USD_MINIMUM_MINOR = 1000;

function applySquadMinimum(amountMinor, currency) {
  const amount = Number(amountMinor);
  const code = String(currency || "").trim().toUpperCase();
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    const error = new Error("A valid Squad payment amount is required.");
    error.code = "SQUAD_AMOUNT_INVALID";
    throw error;
  }
  if (code !== "USD") return { amountMinor: amount, walletSurplusMinor: 0 };
  const charged = Math.max(amount, SQUAD_USD_MINIMUM_MINOR);
  return { amountMinor: charged, walletSurplusMinor: charged - amount };
}

module.exports = { SQUAD_USD_MINIMUM_MINOR, applySquadMinimum };
