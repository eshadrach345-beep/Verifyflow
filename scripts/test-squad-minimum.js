"use strict";
const assert = require("node:assert/strict");
const { applySquadMinimum, SQUAD_USD_MINIMUM_MINOR } = require("../lib/squad-minimum");

assert.equal(SQUAD_USD_MINIMUM_MINOR, 1000);
assert.deepEqual(applySquadMinimum(341, "USD"), { amountMinor: 1000, walletSurplusMinor: 659 });
assert.deepEqual(applySquadMinimum(1000, "USD"), { amountMinor: 1000, walletSurplusMinor: 0 });
assert.deepEqual(applySquadMinimum(1234, "USD"), { amountMinor: 1234, walletSurplusMinor: 0 });
assert.deepEqual(applySquadMinimum(341000, "NGN"), { amountMinor: 341000, walletSurplusMinor: 0 });
assert.throws(() => applySquadMinimum(0, "USD"), { code: "SQUAD_AMOUNT_INVALID" });
console.log("Squad USD minimum tests passed.");
