"use strict";
const assert = require("node:assert/strict");
const { getCatalog, buyNumber, buyRentalNumber, getActivation, getRentalStatus, setActivationStatus, quoteProduct } = require("../lib/herosms");

async function main() {
  const oldFetch = global.fetch;
  const oldKey = process.env.HEROSMS_RETAIL_API_KEY;
  const calls = [];
  process.env.HEROSMS_RETAIL_API_KEY = "retail-test-key";
  global.fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "hero-sms.com");
    assert.equal(url.pathname, "/stubs/handler_api.php");
    assert.equal(url.searchParams.get("api_key"), "retail-test-key");
    const action = url.searchParams.get("action");
    calls.push({ action, country: url.searchParams.get("country"), service: url.searchParams.get("service") });
    let payload;
    if (action === "getCountries") {
      payload = { "1": { id: 1, eng: "United States", visible: 1 }, "2": { id: 2, eng: "United Kingdom", visible: 1 } };
    } else if (action === "getServicesList") {
      payload = { status: "success", services: [{ code: "tg", name: "Telegram" }, { code: "wa", name: "WhatsApp" }] };
    } else if (action === "getPrices") {
      payload = { "1": { tg: { cost: 0.25, count: 18, physicalCount: 12 }, wa: { cost: 0.4, count: 0, physicalCount: 0 } } };
    } else if (action === "getRentServicesAndCountries") {
      payload = { status: "success", services: { tg: { price: 1.5, quantity: 4 } } };
    } else if (action === "getNumberV2") {
      payload = { activationId: 42, phoneNumber: "+12025550123", activationCost: 0.25, countryCode: "US", canGetAnotherSms: true };
    } else if (action === "getRentNumber") {
      payload = { status: "success", phone: { id: 99, number: "+12025550124", cost: "1.50", endDate: "2026-12-01T12:00:00Z" } };
    } else if (action === "getRentStatus") {
      payload = { status: "success", values: { "0": { phoneFrom: "Verify", text: "Login code: 123456", date: "2026-11-20T12:00:00Z" } } };
    } else if (action === "getStatusV2") {
      payload = { status: "STATUS_OK", sms: { code: "012345" } };
    } else if (action === "setStatus") {
      return new Response("ACCESS_ACTIVATION", { status: 200 });
    } else {
      return new Response("BAD_ACTION", { status: 200 });
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const catalog = await getCatalog("us");
    assert.equal(catalog.countryName, "United States");
    assert.equal(catalog.items.length, 1);
    assert.equal(catalog.items[0].id, "tg");
    assert.equal(catalog.items[0].availableCount, 18);
    assert.equal(catalog.items[0].supplierPriceCents, 25);
    assert.equal(catalog.rentals.length, 1);
    const purchase = await buyNumber("tg", 1, "vf-order-test");
    assert.equal(purchase.supplierOrderId, "42");
    assert.equal(purchase.supplierData.phoneNumber, "+12025550123");
    const status = await getActivation("42");
    assert.equal(status.status, "code_received");
    assert.equal(status.code, "012345");
    const rentalQuote = await quoteProduct("long_term_number", { productId: "tg", country: "us", durationDays: 3 });
    assert.equal(rentalQuote.provider, "herosms");
    assert.equal(rentalQuote.supplierPriceCents, 150);
    assert.equal(rentalQuote.salePriceCents, 250);
    assert.equal(rentalQuote.supplierInput.durationHours, 72);
    const rental = await buyRentalNumber("tg", 1, 72, 150);
    assert.equal(rental.supplierOrderId, "99");
    assert.equal(rental.supplierData.phoneNumber, "+12025550124");
    assert.equal(rental.status, "active");
    const rentalStatus = await getRentalStatus("99");
    assert.equal(rentalStatus.status, "active");
    assert.equal(rentalStatus.code, "123456");
    const completed = await setActivationStatus("42", 6);
    assert.equal(completed.result, "ACCESS_ACTIVATION");
    assert(calls.some(call => call.action === "getNumberV2" && call.service === "tg"));
    assert(calls.some(call => call.action === "getStatusV2"));
    assert(calls.some(call => call.action === "getRentNumber" && call.service === "tg"));
    assert(calls.some(call => call.action === "getRentStatus"));
    assert(calls.some(call => call.action === "setStatus"));
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.HEROSMS_RETAIL_API_KEY;
    else process.env.HEROSMS_RETAIL_API_KEY = oldKey;
  }
  console.log("HeroSMS retail API tests passed (catalogue, OTP and long-term rental purchase/status).");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
