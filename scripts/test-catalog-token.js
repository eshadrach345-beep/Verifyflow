"use strict";

const assert = require("node:assert/strict");

process.env.DATABASE_URL = "postgres://verifyflow-test:secret@example.invalid/verifyflow";
const { sealCatalogProductToken, openCatalogProductToken } = require("../lib/catalog-token");

const source = {
  provider: "voidmob",
  productType: "mobile_proxy",
  productId: "plan_supplier_internal_987",
  country: "gb"
};
const token = sealCatalogProductToken(source);
assert.match(token, /^vf1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
assert.equal(token.includes(source.productId), false);
assert.equal(token.toLowerCase().includes(source.provider), false);
assert.deepEqual(openCatalogProductToken(token), source);

const other = sealCatalogProductToken({ ...source, provider: "herosms", productType: "sms_otp", productId: "telegram" });
assert.deepEqual(openCatalogProductToken(other), {
  provider: "herosms", productType: "sms_otp", productId: "telegram", country: "gb"
});
assert.notEqual(token, sealCatalogProductToken(source), "Tokens should use fresh IVs");

for (const invalid of [
  token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"),
  "plan_supplier_internal_987",
  "vf2.bad.bad.bad",
  "vf1.bad.bad.bad"
]) {
  assert.throws(() => openCatalogProductToken(invalid), error => error.code === "INVALID_CATALOG_SELECTION");
}
assert.throws(
  () => sealCatalogProductToken({ ...source, provider: "unknown" }),
  error => error.code === "INVALID_CATALOG_SELECTION"
);
console.log("Catalogue token tests passed (authenticated encryption, tamper rejection and provider/type validation).");
