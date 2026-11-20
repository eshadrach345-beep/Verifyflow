"use strict";
const assert = require("node:assert/strict");

process.env.HEROSMS_API_KEY = "test-api-key";
const calls = [];
global.fetch = async (url, init = {}) => {
  const parsed = new URL(url);
  calls.push({ url: parsed, init });
  if (parsed.pathname.endsWith("/activations") && init.method === "POST") {
    return new Response(JSON.stringify({ data: [{
      id: 123456, status: 4, phone: 79991234567, price: 0.4321,
      verificationType: "voice", expiredAt: "2026-11-20T12:00:00Z"
    }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (parsed.pathname.endsWith("/activations/123456/otp/last")) {
    return new Response(JSON.stringify({ data: [{
      id: 123456, status: 4, phone: 79991234567, verificationType: "voice",
      otpLast: { smsCode: "001234", smsText: "Your code is 001234", receivedAt: "2026-11-20T11:00:00Z" }
    }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (parsed.pathname.endsWith("/activations/offers/sms")) return new Response(JSON.stringify({ data: { tg: { "2": { counts: { total: 5 }, prices: { default: 0.5 } } } } }), { status: 200, headers: { "Content-Type": "application/json" } });
  return new Response(null, { status: 204 });
};

(async () => {
  const { buyNumber, getActivation, setActivationStatus, getVerificationOffer } = require("../lib/herosms");
  const bought = await buyNumber("tg", 2, "verifyflow-test", 100, "voice");
  assert.equal(bought.supplierOrderId, "123456");
  assert.equal(bought.supplierData.verificationType, "voice");
  assert.equal(bought.chargedPriceCents, 43);
  const purchase = calls[0];
  assert.equal(purchase.url.pathname, "/api/v1/activations");
  assert.equal(purchase.init.headers.Authorization, "ApiKey test-api-key");
  const body = JSON.parse(purchase.init.body);
  assert.equal(body.verificationType, "voice");
  assert.equal(body.amount, 1);
  assert.equal(body.fixedPrice, true);
  const current = await getActivation("123456", "voice");
  assert.equal(current.code, "001234");
  assert.equal(current.verificationType, "voice");
  assert.equal(calls[1].url.pathname, "/api/v1/activations/123456/otp/last");
  const offer = await getVerificationOffer("tg", 2, "sms");
  assert.equal(offer.supplierPriceCents, 50);
  await setActivationStatus("123456", 6);
  assert.equal(calls[2].url.pathname, "/api/v1/activations/123456/finish");
  assert.equal(calls[2].init.method, "POST");
  await setActivationStatus("123456", 8);
  assert.equal(calls[3].url.pathname, "/api/v1/activations/123456");
  assert.equal(calls[3].init.method, "DELETE");
  await assert.rejects(() => buyNumber("tg", 2, "ref", 100, "carrier-pigeon"), /HeroSMS API request failed/);
  console.log("HeroSMS retail v1 activation tests passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
