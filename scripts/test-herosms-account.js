"use strict";
const assert = require("node:assert/strict");
const { readAccount } = require("../lib/herosms-account");

async function main() {
  const oldFetch = global.fetch;
  const oldKey = process.env.HEROSMS_API_KEY;
  const oldAccountKey = process.env.HEROSMS_ACCOUNT_API_KEY;
  const oldRetailKey = process.env.HEROSMS_RETAIL_API_KEY;
  try {
    delete process.env.HEROSMS_API_KEY;
    delete process.env.HEROSMS_ACCOUNT_API_KEY;
    delete process.env.HEROSMS_RETAIL_API_KEY;
    const missing = await readAccount();
    assert.equal(missing.configured, false);
    process.env.HEROSMS_API_KEY = "legacy-retail-key";
    process.env.HEROSMS_ACCOUNT_API_KEY = "account-test-key";
    process.env.HEROSMS_RETAIL_API_KEY = "retail-test-key";
    global.fetch = async (input, options) => {
      assert.equal(String(input), "https://partners-api.hero-sms.com/api/v1/balance");
      assert.equal(options.headers.apikey, "account-test-key");
      return new Response(JSON.stringify({ data: { usd: 12.75, rub: 1000 } }), { status: 200 });
    };
    const ok = await readAccount();
    assert.equal(ok.connected, true);
    assert.equal(ok.balance, 12.75);
    assert.equal(ok.rubBalance, 1000);
    assert.equal(ok.mode, "account_api");
    assert.equal(ok.accountKeyConfigured, true);
    assert.equal(ok.retailApiConfigured, true);
    global.fetch = async (input) => {
      if (String(input).includes("partners-api.hero-sms.com")) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
      }
      assert.match(String(input), /hero-sms\.com\\/stubs\\/handler_api\.php/);
      assert.match(String(input), /action=getBalance/);
      assert.match(String(input), /api_key=retail-test-key/);
      return new Response("ACCESS_BALANCE:8.42", { status: 200 });
    };
    const fallback = await readAccount();
    assert.equal(fallback.connected, true);
    assert.equal(fallback.balance, 8.42);
    assert.equal(fallback.mode, "retail_compatibility_api");
    assert.equal(fallback.accountKeyConfigured, false);
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.HEROSMS_API_KEY;
    else process.env.HEROSMS_API_KEY = oldKey;
    if (oldAccountKey === undefined) delete process.env.HEROSMS_ACCOUNT_API_KEY;
    else process.env.HEROSMS_ACCOUNT_API_KEY = oldAccountKey;
    if (oldRetailKey === undefined) delete process.env.HEROSMS_RETAIL_API_KEY;
    else process.env.HEROSMS_RETAIL_API_KEY = oldRetailKey;
  }
  console.log("HeroSMS Account API tests passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
