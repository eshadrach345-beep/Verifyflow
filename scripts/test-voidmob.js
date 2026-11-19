"use strict";
const assert = require("node:assert/strict");
const { buildPurchase, purchase, getOrder } = require("../lib/voidmob");

async function main() {
  const sms = buildPurchase("sms_otp", { serviceId: "svc_test", maxPriceCents: 50 });
  assert.equal(sms.path, "/verifications");
  assert.deepEqual(sms.body, { service_id: "svc_test", country: "us", max_price_cents: 50 });

  const rental = buildPurchase("long_term_number", { serviceId: "svc_test", durationDays: 14, maxPriceCents: 1000 });
  assert.equal(rental.body.duration, "14D");
  const dedicated = buildPurchase("dedicated_number", { country: "GB", maxPriceCents: 2000 });
  assert.equal(dedicated.body.auto_renew, false);
  assert.equal(dedicated.body.country, "gb");
  assert.equal(buildPurchase("esim", { productId: "prod_test", maxPriceCents: 1500 }).path, "/esims");
  assert.equal(buildPurchase("mobile_proxy", { planId: "plan_test", maxPriceCents: 2000 }).path, "/proxies");
  assert.throws(() => buildPurchase("long_term_number", { serviceId: "x", durationDays: 5, maxPriceCents: 1 }), { code: "INVALID_DURATION" });
  assert.throws(() => buildPurchase("sms_otp", { serviceId: "x", maxPriceCents: 0 }), { code: "INVALID_PRICE_CAP" });
  assert.throws(() => buildPurchase("social_followers", { maxPriceCents: 10 }), { code: "UNSUPPORTED_PRODUCT" });

  const originalFetch = global.fetch;
  const originalKey = process.env.VOIDMOB_API_KEY;
  const originalEnabled = process.env.VOIDMOB_FULFILMENT_ENABLED;
  const calls = [];
  process.env.VOIDMOB_API_KEY = "mock-only-key";
  process.env.VOIDMOB_FULFILMENT_ENABLED = "true";
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({
      success: true,
      data: { verification: { id: "ver_mock_123", status: "waiting_for_code", charged_price_cents: 50 } }
    }), { status: 201, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await purchase("sms_otp", { serviceId: "svc_test", maxPriceCents: 50 }, "vf-order-test-0001");
    assert.equal(result.supplierOrderId, "ver_mock_123");
    assert.equal(result.chargedPriceCents, 50);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers["Idempotency-Key"], "vf-order-test-0001");
    assert.equal(calls[0].options.headers.Authorization, "Bearer mock-only-key");

    await assert.rejects(() => purchase("sms_otp", { serviceId: "svc_test", maxPriceCents: 50 }, "bad"), { code: "INVALID_IDEMPOTENCY_KEY" });
    global.fetch = async () => new Response(JSON.stringify({ success: true, data: { status: "active", id: "ren_mock_123" } }), { status: 200 });
    const rentalStatus = await getOrder("long_term_number", "ren_mock_123");
    assert.equal(rentalStatus.id, "ren_mock_123");
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.VOIDMOB_API_KEY; else process.env.VOIDMOB_API_KEY = originalKey;
    if (originalEnabled === undefined) delete process.env.VOIDMOB_FULFILMENT_ENABLED; else process.env.VOIDMOB_FULFILMENT_ENABLED = originalEnabled;
  }
  console.log("VoidMob adapter tests passed (mock supplier only; no live purchase).");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
