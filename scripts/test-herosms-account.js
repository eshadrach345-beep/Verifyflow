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
    process.env.HEROSMS_API_KEY = "account-test-key";
    global.fetch = async input => {
      assert.equal(String(input), "https://partners-api.hero-sms.com/api/v1/balance");
      return new Response(JSON.stringify({ data: { usd: 12.75, rub: 1000 } }), { status: 200 });
    };
    const ok = await readAccount();
    assert.equal(ok.connected, true);
    assert.equal(ok.balance, 12.75);
    assert.equal(ok.rubBalance, 1000);
    assert.equal(ok.mode, "account_api");
    global.fetch = async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    const bad = await readAccount();
    assert.equal(bad.connected, false);
    assert.match(bad.message, /rejected/i);
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.HEROSMS_API_KEY;
    else process.env.HEROSMS_API_KEY = oldKey;
  }
  console.log("HeroSMS Account API tests passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
