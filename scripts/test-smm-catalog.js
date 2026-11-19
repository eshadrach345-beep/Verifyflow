"use strict";
const assert = require("node:assert/strict");
const { readProvider, serviceIsEligible, currencyCode, numericValue } = require("../lib/smm-catalog");

async function main() {
  assert.equal(serviceIsEligible({ service: 1, name: "Professional video editing" }), true);
  assert.equal(serviceIsEligible({ service: 2, name: "TikTok Likes" }), true);
  assert.equal(serviceIsEligible({ service: 3, name: "Instagram followers" }), true);
  assert.equal(serviceIsEligible({ name: "Missing service ID" }), false);
  assert.equal(currencyCode("usd"), "USD");
  assert.equal(currencyCode("US"), null);
  assert.equal(numericValue("12.5"), 12.5);
  assert.equal(numericValue("not-a-number"), null);

  const old = { fetch: global.fetch, peak: process.env.PEAKERR_API_KEY, jap: process.env.JUSTANOTHERPANEL_API_KEY };
  process.env.PEAKERR_API_KEY = "test-peakerr";
  process.env.JUSTANOTHERPANEL_API_KEY = "test-jap";
  const requests = [];
  global.fetch = async (url, options) => {
    const form = new URLSearchParams(options.body), action = form.get("action");
    requests.push({ url: String(url), action });
    const payload = action === "balance" ? { balance: "123.45", currency: "NGN" } : [
      { service: 10, name: "Professional video editing", category: "Creative", rate: "25.50", min: "1", max: "10", type: "Default" },
      { service: 11, name: "TikTok Likes", category: "TikTok", rate: "0.80", min: "50", max: "50000", type: "Default" },
      { service: 12, name: "Instagram followers", category: "Instagram", rate: "1.15", min: "50", max: "50000", type: "Default" }
    ];
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const provider = await readProvider("peakerr");
    assert.equal(provider.connected, true);
    assert.equal(provider.balance, 123.45);
    assert.equal(provider.currency, "NGN");
    assert.equal(provider.totalServices, 3);
    assert.equal(provider.eligibleCount, 3);
    assert.equal(provider.eligibleServices.length, 3);
    assert.equal(provider.eligibleServices[1].name, "TikTok Likes");
    assert.equal(provider.eligibleServices[1].supplierRateReported, "0.80");
    assert.equal(provider.eligibleServices[1].rateUnit, "per_1000");
    assert.equal(provider.eligibleServices[1].supplierCurrency, "NGN");
    assert(requests.every(item => item.url === "https://peakerr.com/api/v2"));
    assert(requests.some(item => item.action === "services"));
  } finally {
    global.fetch = old.fetch;
    if (old.peak === undefined) delete process.env.PEAKERR_API_KEY; else process.env.PEAKERR_API_KEY = old.peak;
    if (old.jap === undefined) delete process.env.JUSTANOTHERPANEL_API_KEY; else process.env.JUSTANOTHERPANEL_API_KEY = old.jap;
  }
  console.log("SMM supplier catalogue tests passed (all supplier services are available for owner selection).");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
