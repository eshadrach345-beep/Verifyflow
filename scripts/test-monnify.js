const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { parseMinorUnits, verifyWebhookSignature } = require("../lib/monnify");

assert.equal(parseMinorUnits("100"), 10000);
assert.equal(parseMinorUnits("100.00"), 10000);
assert.equal(parseMinorUnits("99.5"), 9950);
assert.equal(parseMinorUnits(0.01), 1);
assert.equal(parseMinorUnits("0"), 0);
assert.equal(parseMinorUnits("-1.00"), null);
assert.equal(parseMinorUnits("1.234"), null);
assert.equal(parseMinorUnits("not-money"), null);

const raw = JSON.stringify({ eventType: "SUCCESSFUL_TRANSACTION", eventData: { paymentReference: "VFTEST_ABC" } });
const secret = "verifyflow-test-secret";
const signature = createHmac("sha512", secret).update(raw).digest("hex");
assert.equal(verifyWebhookSignature(raw, signature, secret), true);
assert.equal(verifyWebhookSignature(raw, signature.toUpperCase(), secret), true);
assert.equal(verifyWebhookSignature(raw, "0".repeat(128), secret), false);
assert.equal(verifyWebhookSignature(raw + " ", signature, secret), false);
assert.equal(verifyWebhookSignature(raw, "", secret), false);

console.log("Monnify helper tests passed (amount parsing and webhook HMAC validation).");
