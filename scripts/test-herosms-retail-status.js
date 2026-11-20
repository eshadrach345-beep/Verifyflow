"use strict";
const assert = require("node:assert/strict");
const herosms = require("../lib/herosms");
const { readRetailStatus } = require("../lib/herosms-retail-status");

async function main() {
  const oldLegacy = process.env.HEROSMS_API_KEY;
  const oldRetail = process.env.HEROSMS_RETAIL_API_KEY;
  const oldRequest = herosms.request;
  try {
    delete process.env.HEROSMS_API_KEY;
    delete process.env.HEROSMS_RETAIL_API_KEY;
    const missing = await readRetailStatus();
    assert.equal(missing.configured, false);
    assert.equal(missing.connected, false);

    process.env.HEROSMS_API_KEY = "legacy-retail-test-key";
    herosms.request = async action => {
      assert.equal(action, "getCountries");
      return { US: { id: 1 }, GB: { id: 44 }, NG: { id: 100 } };
    };
    const connected = await readRetailStatus();
    assert.equal(connected.configured, true);
    assert.equal(connected.connected, true);
    assert.equal(connected.countryCount, 3);

    herosms.request = async () => {
      const error = new Error("bad key");
      error.code = "BAD_KEY";
      error.status = 401;
      throw error;
    };
    const rejected = await readRetailStatus();
    assert.equal(rejected.configured, true);
    assert.equal(rejected.connected, false);
    assert.match(rejected.message, /rejected/i);
  } finally {
    herosms.request = oldRequest;
    if (oldLegacy === undefined) delete process.env.HEROSMS_API_KEY;
    else process.env.HEROSMS_API_KEY = oldLegacy;
    if (oldRetail === undefined) delete process.env.HEROSMS_RETAIL_API_KEY;
    else process.env.HEROSMS_RETAIL_API_KEY = oldRetail;
  }
  console.log("HeroSMS retail API status tests passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
