"use strict";
const assert = require("node:assert/strict");
const { readAccount } = require("../lib/herosms-account");

async function main() {
  const oldFetch = global.fetch;
  const oldKey = process.env.HEROSMS_API_KEY;
  try {
    delete process.env.HEROSMS_API_KEY;
    const missing = await readAccount();
    assert.equal(missing.configured, false);
    process.env.HEROSMS_API_KEY = "mock-key";
    global.fetch = async (url, options) => {
      assert.equal(String(url), "https://partners-api.hero-sms.com/api/v1/balance");
      assert.equal(options.headers.apikey, "mock-key");
      return new Response(JSON.stringify({ status: "success", data: { rub: 1200.29, usd: 180.11 } }), { status: 200 });
    };
    const ok = await readAccount();
    assert.equal(ok.connected, true);
    assert.equal(ok.rub, 1200.29);
    assert.equal(ok.usd, 180.11);
    assert.equal(ok.mode, "account_balance_only");
    global.fetch = async () => new Response(JSON.stringify({ status: "error", error: "unauthorized" }), { status: 401 });
    const bad = await readAccount();
    assert.equal(bad.connected, false);
    assert.match(bad.message, /rejected/i);
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.HEROSMS_API_KEY;
    else process.env.HEROSMS_API_KEY = oldKey;
  }
  console.log("HeroSMS Account API tests passed (read-only balance check; no number purchases).");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
