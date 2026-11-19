"use strict";
const assert = require("node:assert/strict");
const handler = require("../api-handlers/marketing-catalog");

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
  const oldPeak = process.env.PEAKERR_API_KEY;
  const oldJap = process.env.JUSTANOTHERPANEL_API_KEY;
  process.env.PEAKERR_API_KEY = "test-peakerr";
  process.env.JUSTANOTHERPANEL_API_KEY = "test-jap";

  global.fetch = async (url, options) => {
    const action = new URLSearchParams(options.body).get("action");
    const body = action === "balance"
      ? { balance: "987.65", currency: "USD" }
      : [
          { service: 41, name: "Professional video editing", category: "Creative", rate: "25.50", min: "1", max: "10" },
          { service: 42, name: "Instagram followers", category: "Growth", rate: "0.80", min: "50", max: "50000" }
        ];
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const res = response();
    await handler({ method: "GET" }, res);
    const data = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(data.ok, true);
    assert.equal(data.items.length, 2);
    assert(data.items.every(item => item.name === "Professional video editing"));
    assert(data.items.every(item => !Object.hasOwn(item, "supplierRateReported")));
    assert(data.items.every(item => !Object.hasOwn(item, "balance")));
    assert(!JSON.stringify(data).includes("987.65"));
    assert(!JSON.stringify(data).includes("25.50"));
    assert(!JSON.stringify(data).includes("test-peakerr"));
    assert(!JSON.stringify(data).includes("test-jap"));
    console.log("Public marketing catalogue tests passed (safe allowlist and no private supplier pricing/balances/keys).");
  } finally {
    global.fetch = originalFetch;
    if (oldPeak === undefined) delete process.env.PEAKERR_API_KEY; else process.env.PEAKERR_API_KEY = oldPeak;
    if (oldJap === undefined) delete process.env.JUSTANOTHERPANEL_API_KEY; else process.env.JUSTANOTHERPANEL_API_KEY = oldJap;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
