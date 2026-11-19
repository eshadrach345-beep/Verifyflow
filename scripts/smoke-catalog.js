const assert = require("node:assert/strict");
const handler = require("../api-handlers/catalog");

function response() {
  return {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = body; }
  };
}

async function main() {
  const originalFetch = global.fetch;
  const originalKey = process.env.VOIDMOB_API_KEY;
  const originalHeroKey = process.env.HEROSMS_RETAIL_API_KEY;
  delete process.env.HEROSMS_RETAIL_API_KEY;
  process.env.VOIDMOB_API_KEY = "test-key";

  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), authorization: options.headers.Authorization });
    let data;
    if (String(url).endsWith("/services")) {
      data = { country: "us", services: [{
        id: "svc_telegram", name: "Telegram", available: true,
        quoted_price_cents: 35, base_price_cents: 40, price_ceiling_cents: 50,
        ltr_3d_price_cents: 1500, ltr_7d_price_cents: 0,
        ltr_14d_price_cents: 4200, ltr_30d_price_cents: 0
      }] };
    } else if (String(url).includes("/esim_products")) {
      data = { products: [{
        id: "prod_europe", full_title: "Europe 5 GB · 30 Days",
        countries: ["GB", "FR"], data_limit_gb: 5,
        data_unlimited: false, validity_days: 30, network_type: "4G",
        price_cents: 1500, currency: "USD"
      }], next_cursor: null };
    } else if (String(url).includes("/proxy_plans")) {
      data = { plans: [{
        id: "plan_mobile", name: "UK Mobile", type: "shared",
        country_name: "United Kingdom", data_gb: 10,
        duration_days: 30, period: "monthly", quoted_price_cents: 3000,
        available: true
      }], next_cursor: null };
    } else if (String(url).includes("/dedicated/countries")) {
      data = [{ country: "gb", name: "United Kingdom", quoted_price_cents: 3499, in_stock: true }];
    } else {
      return new Response(JSON.stringify({ success: false, error: { code: "NOT_FOUND" } }), { status: 404 });
    }
    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const res = response();
    await handler({ method: "GET", query: { country: "us" } }, res);
    const body = JSON.parse(res.body);

    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.country, "us");
    assert.equal(body.summary.sms, 1);
    assert.equal(body.summary.rentals, 1);
    assert.equal(body.summary.esim, 1);
    assert.equal(body.summary.proxies, 1);
    assert.equal(body.summary.dedicated, 1);
    assert.equal(body.sections.sms.items[0].priceCents, 55);
    assert.equal(body.sections.rentals.items[0].durations[0].priceCents, 2100);
    assert.equal(body.sections.rentals.items[0].durations[1].priceCents, 5880);
    assert.equal(body.sections.esim.items[0].priceCents, 2025);
    assert.equal(body.sections.proxies.items[0].priceCents, 4050);
    assert.equal(body.sections.dedicated.items[0].priceCents, 4724);
    assert.equal(body.sections.sms.items[0].name, "Telegram");
    assert.equal(body.sections.esim.items[0].title, "Europe 5 GB · 30 Days");
    assert.equal(body.sections.proxies.items[0].country, "United Kingdom");
    assert.equal(body.sections.dedicated.items[0].inStock, true);
    assert.equal(JSON.stringify(body).includes("base_price_cents"), false);
    assert.equal(JSON.stringify(body).includes("quoted_price_cents"), false);
    assert.equal(Object.hasOwn(body, "providers"), false);
    assert.equal(calls.length, 4);
    assert(calls.some(call => call.url.endsWith("/services")));
    assert(calls.every(call => call.authorization === "Bearer test-key"));
    assert(calls.every(call => call.url.startsWith("https://dashboard.voidmob.com/api/v1/")));

    const invalidRes = response();
    await handler({ method: "GET", query: { country: "United States" } }, invalidRes);
    assert.equal(invalidRes.statusCode, 400);

    const gbRes = response();
    await handler({ method: "GET", query: { country: "gb" } }, gbRes);
    const gbBody = JSON.parse(gbRes.body);
    assert.equal(gbBody.sections.sms.ok, true);
    assert.equal(gbBody.sections.sms.items.length, 0);
    assert.match(gbBody.sections.sms.message, /US numbers only/i);
    assert.equal(gbBody.sections.rentals.items.length, 0);

    const failureRes = response();
    global.fetch = async () => new Response(JSON.stringify({
      success: false, error: { code: "PRIVATE_SUPPLIER_DETAIL", message: "internal detail" }
    }), { status: 503 });
    await handler({ method: "GET", query: { country: "us" } }, failureRes);
    const failure = JSON.parse(failureRes.body);
    assert.equal(failure.sections.esim.ok, false);
    assert(!JSON.stringify(failure).includes("PRIVATE_SUPPLIER_DETAIL"));
    assert(!JSON.stringify(failure).includes("internal detail"));

    delete process.env.VOIDMOB_API_KEY;
    const noKeyRes = response();
    await handler({ method: "GET", query: { country: "us" } }, noKeyRes);
    const noKey = JSON.parse(noKeyRes.body);
    assert.equal(noKey.sections.rentals.ok, false);
    assert.equal(noKey.sections.esim.ok, false);
    assert.equal(Object.hasOwn(noKey, "providers"), false);

    console.log("Catalogue smoke tests passed (live supplier pricing, markup, country selection, safe errors, no-key fallback).");
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.VOIDMOB_API_KEY;
    else process.env.VOIDMOB_API_KEY = originalKey;
    if (originalHeroKey === undefined) delete process.env.HEROSMS_RETAIL_API_KEY;
    else process.env.HEROSMS_RETAIL_API_KEY = originalHeroKey;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
