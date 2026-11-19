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
    global.fetch = async input => {
      const url = new URL(String(input));
      assert.equal(url.origin + url.pathname, "https://hero-sms.com/stubs/handler_api.php");
      assert.equal(url.searchParams.get("api_key"), "mock-key");
      assert.equal(url.searchParams.get("action"), "getBalance");
      return new Response("ACCESS_BALANCE:180.11", { status: 200 });
    };
    const ok = await readAccount();
    assert.equal(ok.connected, true);
    assert.equal(ok.balance, 180.11);
    assert.equal(ok.mode, "retail_api");
    global.fetch = async () => new Response("BAD_KEY", { status: 200 });
    const bad = await readAccount();
    assert.equal(bad.connected, false);
    assert.match(bad.message, /rejected/i);
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.HEROSMS_API_KEY;
    else process.env.HEROSMS_API_KEY = oldKey;
  }
  console.log("HeroSMS retail API account tests passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
