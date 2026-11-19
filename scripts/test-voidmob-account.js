"use strict";
const assert = require("node:assert/strict");
const { readAccount } = require("../lib/voidmob-account");
async function main() {
  const oldFetch = global.fetch, oldKey = process.env.VOIDMOB_API_KEY;
  try {
    delete process.env.VOIDMOB_API_KEY;
    assert.equal((await readAccount()).configured, false);
    process.env.VOIDMOB_API_KEY = "mock-key";
    global.fetch = async (url, options) => {
      assert.equal(String(url), "https://dashboard.voidmob.com/api/v1/me");
      assert.equal(options.headers.Authorization, "Bearer mock-key");
      return new Response(JSON.stringify({ success: true, data: {
        id: "acct_test", balance: { amount_cents: 12345, currency: "USD", formatted: "$123.45" }
      } }), { status: 200 });
    };
    const ok = await readAccount();
    assert.equal(ok.connected, true);
    assert.equal(ok.balanceCents, 12345);
    assert.equal(ok.currency, "USD");
    global.fetch = async () => new Response(JSON.stringify({ success: false, error: { code: "UNAUTHORIZED" } }), { status: 401 });
    const bad = await readAccount();
    assert.equal(bad.connected, false);
    assert.match(bad.message, /rejected/i);
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.VOIDMOB_API_KEY;
    else process.env.VOIDMOB_API_KEY = oldKey;
  }
  console.log("VoidMob account tests passed (read-only API key and balance check).");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
