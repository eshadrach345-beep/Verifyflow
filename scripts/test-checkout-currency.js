"use strict";

const assert = require("node:assert/strict");
const { getCheckoutAmount } = require("../lib/checkout-currency");

const ngn = { SQUAD_INTERNATIONAL_ENABLED: "false", VERIFYFLOW_USD_NGN_RATE: "1400" };
assert.deepEqual(
  getCheckoutAmount(100, "Nigeria", ngn),
  { currency: "NGN", amountMinor: 140000, usdAmountMinor: 100, usdNgnRate: 1400 }
);
assert.equal(getCheckoutAmount(101, "Nigeria", ngn).amountMinor, 141400);

const usd = { SQUAD_INTERNATIONAL_ENABLED: "true" };
assert.deepEqual(
  getCheckoutAmount(1234, "United Kingdom", usd),
  { currency: "USD", amountMinor: 1234, usdAmountMinor: 1234, usdNgnRate: null }
);
assert.throws(
  () => getCheckoutAmount(100, "Ghana", { SQUAD_INTERNATIONAL_ENABLED: "false" }),
  error => error.code === "CHECKOUT_INTERNATIONAL_CURRENCY_DISABLED"
);
assert.throws(
  () => getCheckoutAmount(100, "Nigeria", { SQUAD_INTERNATIONAL_ENABLED: "false" }),
  error => error.code === "CHECKOUT_EXCHANGE_RATE_MISSING"
);
assert.throws(
  () => getCheckoutAmount(100, "Nigeria", { SQUAD_INTERNATIONAL_ENABLED: "false", VERIFYFLOW_USD_NGN_RATE: "0" }),
  error => error.code === "CHECKOUT_EXCHANGE_RATE_INVALID"
);
assert.throws(
  () => getCheckoutAmount(100, "", usd),
  error => error.code === "CHECKOUT_BILLING_COUNTRY_REQUIRED"
);
assert.throws(
  () => getCheckoutAmount(0, "Nigeria", usd),
  error => error.code === "CHECKOUT_AMOUNT_INVALID"
);

console.log("Checkout currency tests passed (Nigeria NGN, international USD approval gate, and validation).");
