"use strict";

/**
 * Squad checkout supports NGN and USD only.
 * Nigerian billing addresses are charged in NGN using the configured rate.
 * Non-Nigerian billing addresses are charged in USD, but only after the
 * merchant explicitly enables/obtains Squad international USD approval.
 */
function getCheckoutAmount(usdAmountMinor, billingCountry, env = process.env) {
  if (!Number.isSafeInteger(usdAmountMinor) || usdAmountMinor <= 0) {
    const error = new Error("A valid USD selling price is required.");
    error.code = "CHECKOUT_AMOUNT_INVALID";
    throw error;
  }

  const country = String(billingCountry || "").trim().toLowerCase();
  if (!country) {
    const error = new Error("A billing country is required to select checkout currency.");
    error.code = "CHECKOUT_BILLING_COUNTRY_REQUIRED";
    throw error;
  }

  if (country !== "nigeria") {
    if (String(env.SQUAD_INTERNATIONAL_ENABLED || "").trim().toLowerCase() !== "true") {
      const error = new Error("International USD checkout is not enabled for this merchant account yet.");
      error.code = "CHECKOUT_INTERNATIONAL_CURRENCY_DISABLED";
      throw error;
    }
    return { currency: "USD", amountMinor: usdAmountMinor, usdAmountMinor, usdNgnRate: null };
  }

  const rawRate = String(env.VERIFYFLOW_USD_NGN_RATE || "").trim();
  const rate = Number(rawRate);
  if (!/^[0-9]+(?:\\.[0-9]{1,4})?$/.test(rawRate) || !Number.isFinite(rate) || rate < 1 || rate > 100000) {
    const error = new Error(rawRate ? "The USD/NGN checkout rate is invalid." : "The USD/NGN checkout rate is not configured.");
    error.code = rawRate ? "CHECKOUT_EXCHANGE_RATE_INVALID" : "CHECKOUT_EXCHANGE_RATE_MISSING";
    throw error;
  }

  const amountMinor = Math.ceil(usdAmountMinor * rate);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    const error = new Error("The converted checkout amount is invalid.");
    error.code = "CHECKOUT_AMOUNT_INVALID";
    throw error;
  }

  return { currency: "NGN", amountMinor, usdAmountMinor, usdNgnRate: rate };
}

module.exports = { getCheckoutAmount };
