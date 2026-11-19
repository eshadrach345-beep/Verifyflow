"use strict";
const assert = require("node:assert/strict");
const { getCatalog, getBalance } = require("../lib/herosms");

async function main() {
  const oldFetch = global.fetch;
  const oldKey = process.env.HEROSMS_API_KEY;
  const calls = [];
  process.env.HEROSMS_API_KEY = "test-key";
  global.fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "hero-sms.com");
    assert.equal(url.pathname, "/stubs/handler_api.php");
    assert.equal(url.searchParams.get("api_key"), "test-key");
    const action = url.searchParams.get("action");
    calls.push({ action, country: url.searchParams.get("country") });
    let payload;
    if (action === "getCountries") {
      payload = {
        "1": { id: 1, eng: "United States", visible: 1 },
        "2": { id: 2, eng: "United Kingdom", visible: 1 }
      };
    } else if (action === "getServicesList") {
      payload = { status: "success", services: [{ code: "tg", name: "Telegram" }, { code: "wa", name: "WhatsApp" }] };
    } else if (action === "getPrices") {
      payload = { "1": {
        tg: { cost: 0.25, count: 18, physicalCount: 12 },
        wa: { cost: 0.4, count: 0, physicalCount: 0 }
      } };
    } else if (action === "getRentServicesAndCountries") {
      payload = { status: "success", services: { tg: { price: 1.5, quantity: 4 }, wa: { price: 2, quantity: 0 } } };
    } else if (action === "getBalance") {
      return new Response("ACCESS_BALANCE:12.75", { status: 200 });
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
    assert.equal(catalog.items[0].provider, "herosms");
    assert.equal(catalog.items[0].availableCount, 18);
    assert.equal(catalog.items[0].physicalCount, 12);
    assert.equal(catalog.items[0].supplierPriceCents, 25);
    assert.equal(catalog.items[0].priceCents, 39);
    assert.equal(catalog.rentals.length, 1);
    assert.equal(catalog.rentals[0].id, "tg");
    assert.equal(catalog.rentals[0].durations[0].hours, 24);
    assert.equal(catalog.rentals[0].availableCount, 4);
    assert(calls.some(call => call.action === "getCountries"));
    assert(calls.some(call => call.action === "getServicesList" && call.country === "1"));
    assert(calls.some(call => call.action === "getPrices" && call.country === "1"));
    assert(calls.some(call => call.action === "getRentServicesAndCountries" && call.country === "1"));
    const balance = await getBalance();
    assert.equal(balance.balance, 12.75);
    assert.equal(balance.currency, "USD");
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.HEROSMS_API_KEY;
    else process.env.HEROSMS_API_KEY = oldKey;
  }
  console.log("HeroSMS retail API tests passed (countries, services, prices, inventory, rentals and balance).");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
