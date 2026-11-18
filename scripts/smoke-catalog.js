const assert = require("node:assert/strict");
const handler = require("../api/catalog");

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
  process.env.VOIDMOB_API_KEY = "test-key";

  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), authorization: options.headers.Authorization });
    let data;
    if (String(url).includes("/services?")) {
      data = { country: "us", services: [{
        id: "svc_telegram", name: "Telegram", available: true,
        ltr_3d_price_cents: 1500, ltr_7d_price_cents: 0,
        ltr_14d_price_cents: 4200, ltr_30d_price_cents: 0
      }] };
    } else if (String(url).includes("/esim_products")) {
      data = { products: [{
        id: "prod_europe", full_title: "Europe 5 GB · 30 Days",
        countries: ["GB", "FR"], data_limit_gb: 5,
        data_unlimited: false, validity_days: 30, network_type: "4G"
      }], next_cursor: null };
    } else if (String(url).includes("/proxy_plans")) {
      data = { plans: [{
        id: "plan_mobile", name: "UK Mobile", type: "mobile",
        country_name: "United Kingdom", data_gb: 10,
        duration_days: 30, available: true
      }], next_cursor: null };
    } else if (String(url).includes("/dedicated/countries")) {
      data = [{ country: "gb", name: "United Kingdom", in_stock: true }];
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
    await handler({ method: "GET" }, res);
    const body = JSON.parse(res.body);

    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.summary.rentals, 1);
    assert.equal(body.summary.esim, 1);
    assert.equal(body.summary.proxies, 1);
    assert.equal(body.summary.dedicated, 1);
    assert.deepEqual(body.sections.rentals.items[0].durations, [3, 14]);
    assert.equal(body.sections.esim.items[0].title, "Europe 5 GB · 30 Days");
    assert.equal(body.sections.proxies.items[0].country, "United Kingdom");
    assert.equal(body.sections.dedicated.items[0].inStock, true);
    assert.equal(Object.hasOwn(body, "providers"), false);
    assert.equal(calls.length, 4);
    assert(calls.every(call => call.authorization === "Bearer test-key"));
    assert(calls.every(call => call.url.startsWith("https://dashboard.voidmob.com/api/v1/")));
    
    const failureRes = response();
    global.fetch = async () => new Response(JSON.stringify({
      success: false, error: { code: "PRIVATE_SUPPLIER_DETAIL", message: "internal detail" }
    }), { status: 503 });
    await handler({ method: "GET" }, failureRes);
    const failure = JSON.parse(failureRes.body);
    assert.equal(failure.sections.esim.ok, false);
    assert(!JSON.stringify(failure).includes("PRIVATE_SUPPLIER_DETAIL"));
    assert(!JSON.stringify(failure).includes("internal detail"));

    delete process.env.VOIDMOB_API_KEY;
    const noKeyRes = response();
    await handler({ method: "GET" }, noKeyRes);
    const noKey = JSON.parse(noKeyRes.body);
    assert.equal(noKey.sections.rentals.ok, false);
    assert.equal(noKey.sections.esim.ok, false);
    assert.equal(Object.hasOwn(noKey, "providers"), false);

    console.log("Catalogue smoke tests passed (live mapping, safe errors, no-key fallback).");
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.VOIDMOB_API_KEY;
    else process.env.VOIDMOB_API_KEY = originalKey;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
