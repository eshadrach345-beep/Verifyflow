"use strict";
const assert = require("node:assert/strict");
const { fulfilmentEnabledForOrder } = require("../lib/fulfilment");

const liveApproved = {
  SQUAD_ENVIRONMENT: "LIVE",
  VERIFYFLOW_LIVE_ORDERS_ENABLED: "true",
  VOIDMOB_FULFILMENT_ENABLED: "true",
  VOIDMOB_AUTOBUY_CONFIRMED: "true",
  HEROSMS_FULFILMENT_ENABLED: "true",
  HEROSMS_AUTOBUY_CONFIRMED: "true",
  PEAKERR_FULFILMENT_ENABLED: "true",
  PEAKERR_AUTOBUY_CONFIRMED: "true",
  JUSTANOTHERPANEL_FULFILMENT_ENABLED: "true",
  JUSTANOTHERPANEL_AUTOBUY_CONFIRMED: "true"
};

assert.equal(fulfilmentEnabledForOrder("voidmob", {}, liveApproved), true);
assert.equal(fulfilmentEnabledForOrder("herosms", {}, liveApproved), true);
assert.equal(fulfilmentEnabledForOrder("peakerr", {}, liveApproved), true);
assert.equal(fulfilmentEnabledForOrder("justanotherpanel", {}, liveApproved), true);
assert.equal(fulfilmentEnabledForOrder("voidmob", {}, { ...liveApproved, SQUAD_ENVIRONMENT: "SANDBOX" }), false);
assert.equal(fulfilmentEnabledForOrder("herosms", {}, { ...liveApproved, SQUAD_ENVIRONMENT: "SANDBOX" }), false);
assert.equal(fulfilmentEnabledForOrder("peakerr", {}, { ...liveApproved, SQUAD_ENVIRONMENT: "SANDBOX" }), false);
assert.equal(fulfilmentEnabledForOrder("voidmob", { sandboxTest: true }, liveApproved), false);
assert.equal(fulfilmentEnabledForOrder("herosms", { noFulfilment: true }, liveApproved), false);
assert.equal(fulfilmentEnabledForOrder("voidmob", {}, { ...liveApproved, VERIFYFLOW_LIVE_ORDERS_ENABLED: "false" }), false);
assert.equal(fulfilmentEnabledForOrder("herosms", {}, { ...liveApproved, HEROSMS_AUTOBUY_CONFIRMED: "false" }), false);
assert.equal(fulfilmentEnabledForOrder("voidmob", {}, { ...liveApproved, VOIDMOB_FULFILMENT_ENABLED: "false" }), false);
assert.equal(fulfilmentEnabledForOrder("peakerr", {}, { ...liveApproved, PEAKERR_AUTOBUY_CONFIRMED: "false" }), false);
assert.equal(fulfilmentEnabledForOrder("justanotherpanel", {}, { ...liveApproved, JUSTANOTHERPANEL_FULFILMENT_ENABLED: "false" }), false);

console.log("Fulfilment safety tests passed (sandbox hard stop, persisted test orders and live approval gates).");
