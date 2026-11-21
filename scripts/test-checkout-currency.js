"use strict";

const assert = require("node:assert/strict");
const { getCheckoutAmount } = require("../lib/checkout-currency");

assert.deepEqual(
  getCheckoutAmount(100, { SQUAD_INTERNATIONAL_ENABLED: "false", VERIFYFLOW_USD_NGN_RATE: "1400" }),
  { currency: "NGN", amountMinor: 140000, usdAmountMinor: 100, usdNgnRate: 1400 }
);
assert.equal(
  getCheckoutAmount(101, { MONNIFY_INTERNATIONAL_ENABLED: "false", VERIFYFLOW_USD_NGN_RATE: "1400" }).amountMinor,
  141400
);
assert.deepEqual(
  getCheckoutAmount(1234, { MONNIFY_INTERNATIONAL_ENABLED: "true" }),
  { currency: "USD", amountMinor: 1234, usdAmountMinor: 1234, usdNgnRate: null }
);
assert.throws(
  () => getCheckoutAmount(100, { MONNIFY_INTERNATIONAL_ENABLED: "false" }),
  error => error.code === "CHECKOUT_EXCHANGE_RATE_MISSING"
);
assert.throws(
  () => getCheckoutAmount(100, { MONNIFY_INTERNATIONAL_ENABLED: "false", VERIFYFLOW_USD_NGN_RATE: "0" }),
  error => error.code === "CHECKOUT_EXCHANGE_RATE_INVALID"
);
assert.throws(
  () => getCheckoutAmount(0, { MONNIFY_INTERNATIONAL_ENABLED: "true" }),
  error => error.code === "CHECKOUT_AMOUNT_INVALID"
);

console.log("Checkout currency tests passed (USD activation gate, NGN conversion, and validation).");
