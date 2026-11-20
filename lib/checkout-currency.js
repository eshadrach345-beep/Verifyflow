"use strict";

/**
 * Convert the catalogue's USD minor-unit price into the currency Monnify
 * is permitted to collect. USD remains available only after contract activation.
 *
 * VERIFYFLOW_USD_NGN_RATE is the merchant's configured NGN per USD rate.
 */
function getCheckoutAmount(usdAmountMinor, env = process.env) {
  if (!Number.isSafeInteger(usdAmountMinor) || usdAmountMinor <= 0) {
    const error = new Error("A valid USD selling price is required.");
    error.code = "CHECKOUT_AMOUNT_INVALID";
    throw error;
  }

  if (String(env.MONNIFY_INTERNATIONAL_ENABLED || "").trim().toLowerCase() === "true") {
    return {
      currency: "USD",
      amountMinor: usdAmountMinor,
      usdAmountMinor,
      usdNgnRate: null
    };
  }

  const rawRate = String(env.VERIFYFLOW_USD_NGN_RATE || "").trim();
  const rate = Number(rawRate);
  if (!/^[0-9]+(?:\.[0-9]{1,4})?$/.test(rawRate) || !Number.isFinite(rate) || rate < 1 || rate > 100000) {
    const error = new Error(rawRate ? "The USD/NGN checkout rate is invalid." : "The USD/NGN checkout rate is not configured.");
    error.code = rawRate ? "CHECKOUT_EXCHANGE_RATE_INVALID" : "CHECKOUT_EXCHANGE_RATE_MISSING";
    throw error;
  }

  // USD cents × NGN per USD = NGN kobo. Round up so conversion never
  // reduces the USD-listed retail amount because of fractional kobo.
  const amountMinor = Math.ceil(usdAmountMinor * rate);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    const error = new Error("The converted checkout amount is invalid.");
    error.code = "CHECKOUT_AMOUNT_INVALID";
    throw error;
  }

  return {
    currency: "NGN",
    amountMinor,
    usdAmountMinor,
    usdNgnRate: rate
  };
}

module.exports = { getCheckoutAmount };
