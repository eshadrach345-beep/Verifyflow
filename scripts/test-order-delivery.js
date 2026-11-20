"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { customerOtpDelivery, extractOtpCode, mapSupplierState } = require("../lib/fulfilment");

assert.equal(extractOtpCode("Use OTP code: 001234 to continue"), "001234");
assert.equal(extractOtpCode("Your confirmation code is 987654"), "987654");
assert.equal(extractOtpCode("No code has arrived"), null);

const heroSms = customerOtpDelivery({
  phoneNumber: "+12025550123",
  status: "STATUS_OK",
  sms: { code: "001234", text: "VerifyFlow test code: 001234" }
});
assert.deepEqual(heroSms, {
  phoneNumber: "+12025550123",
  code: "001234",
  message: "VerifyFlow test code: 001234",
  received: true,
  status: "received"
});

const voidMob = customerOtpDelivery({
  phone: "+447700900123",
  status: "waiting_for_code",
  sms_messages: [{ body: "Your one-time password is 654321" }]
});
assert.equal(voidMob.phoneNumber, "+447700900123");
assert.equal(voidMob.code, "654321");
assert.equal(voidMob.message, "Your one-time password is 654321");
assert.equal(voidMob.received, true);

const rental = customerOtpDelivery({
  phoneNumber: "+447700900321",
  status: "active",
  messages: [{ text: "Login code 112233" }]
});
assert.equal(rental.phoneNumber, "+447700900321");
assert.equal(rental.code, "112233");
assert.equal(rental.received, true);

assert.equal(mapSupplierState("sms_otp", "code_received"), "completed");
assert.equal(mapSupplierState("long_term_number", "active"), "completed");

const orderApi = fs.readFileSync("api-handlers/orders.js", "utf8");
const dashboard = fs.readFileSync("dashboard.html", "utf8");
const account = fs.readFileSync("account.html", "utf8");
assert.ok(orderApi.includes("AS customer_delivery"));
assert.ok(orderApi.includes("AS customer_service"));
assert.ok(!orderApi.includes("o.metadata AS"), "Raw order metadata must not be returned to customers");
assert.ok(dashboard.includes("Verification code"));
assert.ok(dashboard.includes("Check for SMS"));
assert.ok(account.includes("Latest code"));
console.log("Customer order delivery tests passed (OTP parsing, customer-safe fields and dashboard rendering).");
