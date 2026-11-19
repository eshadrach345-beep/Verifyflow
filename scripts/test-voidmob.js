"use strict";
const assert = require("node:assert/strict");
const { buildPurchase, purchase, getOrder, getProxyCredentials } = require("../lib/voidmob");
const { mapSupplierState } = require("../lib/fulfilment");

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
  assert.equal(mapSupplierState("sms_otp", "waiting_for_code"), "submitted");
  assert.equal(mapSupplierState("sms_otp", "code_received"), "completed");
  assert.equal(mapSupplierState("long_term_number", "active"), "completed");
  assert.equal(mapSupplierState("esim", "processing"), "submitted");
  assert.equal(mapSupplierState("mobile_proxy", "active"), "completed");

  const originalFetch = global.fetch;
  const originalKey = process.env.VOIDMOB_API_KEY;
  const originalEnabled = process.env.VOIDMOB_FULFILMENT_ENABLED;
  const originalAutoBuy = process.env.VOIDMOB_AUTOBUY_CONFIRMED;
  const calls = [];
  process.env.VOIDMOB_API_KEY = "mock-only-key";
  process.env.VOIDMOB_FULFILMENT_ENABLED = "false";
  process.env.VOIDMOB_AUTOBUY_CONFIRMED = "false";
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/services?")) {
      return new Response(JSON.stringify({ success: true, data: { services: [{
        id: "svc_mock", name: "Mock Service", available: true, quoted_price_cents: 35,
        ltr_3d_price_cents: 1500, ltr_7d_price_cents: 2600, ltr_14d_price_cents: 4200, ltr_30d_price_cents: 7500
      }] } }), { status: 200 });
    }
    if (String(url).includes("/dedicated/countries")) {
      return new Response(JSON.stringify({ success: true, data: [{ country: "gb", name: "United Kingdom", in_stock: true, quoted_price_cents: 1699 }] }), { status: 200 });
    }
    if (String(url).includes("/esim_products/prod_mock")) {
      return new Response(JSON.stringify({ success: true, data: { product: { id: "prod_mock", title: "Mock eSIM", price_cents: 1500 } } }), { status: 200 });
    }
    if (String(url).includes("/proxy_plans/plan_mock")) {
      return new Response(JSON.stringify({ success: true, data: { plan: { id: "plan_mock", name: "Mock Proxy", available: true, quoted_price_cents: 3000 } } }), { status: 200 });
    }
    return new Response(JSON.stringify({
      success: true,
      data: { verification: { id: "ver_mock_123", status: "waiting_for_code", charged_price_cents: 50 } }
    }), { status: 201, headers: { "Content-Type": "application/json" } });
  };
  try {
    await assert.rejects(
      () => purchase("sms_otp", { serviceId: "svc_test", maxPriceCents: 50 }, "vf-order-test-0001"),
      { code: "FULFILMENT_DISABLED" }
    );
    assert.equal(calls.length, 0);
    process.env.VOIDMOB_FULFILMENT_ENABLED = "true";
    process.env.VOIDMOB_AUTOBUY_CONFIRMED = "true";

    const { quoteProduct } = require("../lib/voidmob");
    const smsQuote = await quoteProduct("sms_otp", { productId: "svc_mock", country: "us" });
    assert.equal(smsQuote.supplierPriceCents, 35);
    assert.equal(smsQuote.salePriceCents, 55);
    const rentalQuote = await quoteProduct("long_term_number", { productId: "svc_mock", country: "us", durationDays: 7 });
    assert.equal(rentalQuote.supplierPriceCents, 2600);
    assert.equal(rentalQuote.salePriceCents, 3640);
    const dedicatedQuote = await quoteProduct("dedicated_number", { country: "gb" });
    assert.equal(dedicatedQuote.salePriceCents, 2294);
    const esimQuote = await quoteProduct("esim", { productId: "prod_mock" });
    assert.equal(esimQuote.salePriceCents, 2025);
    const proxyQuote = await quoteProduct("mobile_proxy", { productId: "plan_mock" });
    assert.equal(proxyQuote.salePriceCents, 4050);

    const beforePurchaseCalls = calls.length;
    const result = await purchase("sms_otp", { serviceId: "svc_test", maxPriceCents: 50 }, "vf-order-test-0001");
    assert.equal(result.supplierOrderId, "ver_mock_123");
    assert.equal(result.chargedPriceCents, 50);
    assert.equal(calls.length, beforePurchaseCalls + 1);
    assert.equal(calls[beforePurchaseCalls].options.headers["Idempotency-Key"], "vf-order-test-0001");
    assert.equal(calls[beforePurchaseCalls].options.headers.Authorization, "Bearer mock-only-key");

    await assert.rejects(() => purchase("sms_otp", { serviceId: "svc_test", maxPriceCents: 50 }, "bad"), { code: "INVALID_IDEMPOTENCY_KEY" });
    global.fetch = async (url, options) => {
      assert(String(url).includes("/proxies/prx_mock/flex_credentials"));
      assert.equal(options.headers["Idempotency-Key"], "vf-proxy-credentials-test");
      return new Response(JSON.stringify({ success: true, data: { proxy: {
        gateway: { host: "proxy.example", port: 10092, username: "vf-user", password: "mock-password", protocol: "http" }
      } } }), { status: 200 });
    };
    const credentials = await getProxyCredentials("prx_mock", "vf-proxy-credentials-test");
    assert.equal(credentials.gateway.host, "proxy.example");
    global.fetch = async () => new Response(JSON.stringify({ success: true, data: { status: "active", id: "ren_mock_123" } }), { status: 200 });
    const rentalStatus = await getOrder("long_term_number", "ren_mock_123");
    assert.equal(rentalStatus.id, "ren_mock_123");
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.VOIDMOB_API_KEY; else process.env.VOIDMOB_API_KEY = originalKey;
    if (originalEnabled === undefined) delete process.env.VOIDMOB_FULFILMENT_ENABLED; else process.env.VOIDMOB_FULFILMENT_ENABLED = originalEnabled;
    if (originalAutoBuy === undefined) delete process.env.VOIDMOB_AUTOBUY_CONFIRMED; else process.env.VOIDMOB_AUTOBUY_CONFIRMED = originalAutoBuy;
  }
  console.log("VoidMob adapter tests passed (mock supplier only; no live purchase).");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
