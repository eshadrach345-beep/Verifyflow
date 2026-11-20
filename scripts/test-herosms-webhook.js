"use strict";
const assert = require("node:assert/strict");
const { normalizeWebhookPayload } = require("../api-handlers/herosms-webhook");

const event = normalizeWebhookPayload({
  activationId: 12345,
  service: "tg",
  text: "Your Telegram login code is 001234",
  code: "001234",
  country: 187,
  receivedAt: "2026-11-20T12:30:00Z"
});
assert.deepEqual(event, {
  activationId: "12345",
  service: "tg",
  text: "Your Telegram login code is 001234",
  code: "001234",
  country: 187,
  receivedAt: "2026-11-20T12:30:00.000Z"
});
assert.equal(normalizeWebhookPayload({ activationId: "../../other" }), null);
assert.equal(normalizeWebhookPayload(null), null);
console.log("HeroSMS webhook payload tests passed.");
