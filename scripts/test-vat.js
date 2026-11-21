"use strict";
const assert = require("node:assert/strict");
const { calculateVat } = require("../lib/vat");
const disabled = { VERIFYFLOW_VAT_ENABLED: "false", VERIFYFLOW_VAT_REGISTERED: "true" };
assert.deepEqual(calculateVat(10000, disabled), {
  subtotalMinor: 10000, rate: 0, vatMinor: 0, totalUsdMinor: 10000,
  currency: "USD", taxStatus: "not_assessed"
});
assert.throws(() => calculateVat(10000, {
  VERIFYFLOW_VAT_ENABLED: "true", VERIFYFLOW_VAT_REGISTERED: "true"
}), error => error.code === "VAT_JURISDICTION_REQUIRED");
assert.throws(() => calculateVat(0, disabled), error => error.code === "VAT_SUBTOTAL_INVALID");
console.log("VAT safety tests passed.");
