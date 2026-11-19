"use strict";
const assert = require("node:assert/strict");
const handler = require("../api-handlers/catalog");

function response() {
  return { statusCode: 0, headers: {}, setHeader(k,v){this.headers[k]=v;}, end(body){this.body=body;} };
}

async function main() {
  const oldFetch = global.fetch;
  const oldVoid = process.env.VOIDMOB_API_KEY;
  const oldHero = process.env.HEROSMS_API_KEY;
  process.env.VOIDMOB_API_KEY = "void-test";
  process.env.HEROSMS_API_KEY = "hero-test";
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "dashboard.voidmob.com") {
      const path = url.pathname;
      let data = {};
      if (path.endsWith("/services")) data = { services: [{ id: "void-telegram", name: "Telegram", available: true, quoted_price_cents: 20 }] };
      else if (path.endsWith("/esim_products")) data = { products: [] };
      else if (path.endsWith("/proxy_plans")) data = { plans: [] };
      else if (path.endsWith("/dedicated/countries")) data = [];
      return new Response(JSON.stringify({ success: true, data }), { status: 200 });
    }
    assert.equal(url.hostname, "hero-sms.com");
    const action = url.searchParams.get("action");
    if (action === "getCountries") return new Response(JSON.stringify({ "1": { id: 1, eng: "United States" } }), { status: 200 });
    if (action === "getServicesList") return new Response(JSON.stringify({ services: [{ code: "wa", name: "WhatsApp" }] }), { status: 200 });
    if (action === "getPrices") return new Response(JSON.stringify({ "1": { wa: { cost: 0.3, count: 15, physicalCount: 10 } } }), { status: 200 });
    if (action === "getRentServicesAndCountries") return new Response(JSON.stringify({ services: { wa: { price: 2.5, quantity: 3 } } }), { status: 200 });
    return new Response("BAD_ACTION", { status: 200 });
  };
  try {
    const res = response();
    await handler({ method: "GET", query: { country: "us" } }, res);
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.sections.sms.items.length, 2);
    assert.deepEqual(body.sections.sms.items.map(x => x.provider).sort(), ["herosms", "voidmob"]);
    assert.equal(body.sections.sms.items.find(x => x.provider === "herosms").availableCount, 15);
    assert.equal(body.sections.rentals.items.length, 1);
    assert.equal(body.sections.rentals.items[0].provider, "herosms");
    assert.equal(body.supplierCoverage.heroSms.connected, true);
    assert.equal(body.supplierCoverage.heroSms.countries[0].code, "us");
  } finally {
    global.fetch = oldFetch;
    if (oldVoid === undefined) delete process.env.VOIDMOB_API_KEY; else process.env.VOIDMOB_API_KEY = oldVoid;
    if (oldHero === undefined) delete process.env.HEROSMS_API_KEY; else process.env.HEROSMS_API_KEY = oldHero;
  }
  console.log("Multi-supplier catalogue tests passed (HeroSMS and VoidMob inventory merged).");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
