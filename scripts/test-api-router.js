const assert = require("node:assert/strict");
const handler = require("../api/index.js");

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) {
      this.setHeader("Content-Type", "application/json; charset=utf-8");
      this.body = JSON.stringify(value);
      return this;
    },
    end(value) { this.body = String(value || ""); }
  };
}

async function request(path, method = "GET") {
  const res = response();
  const req = {
    method,
    url: "/api?path=" + encodeURIComponent(path),
    query: { path },
    headers: {}
  };
  await handler(req, res);
  return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body || "{}") };
}

async function main() {
  const health = await request("health");
  assert.equal(health.status, 200);
  assert.equal(health.body.service, "VerifyFlow");

  const me = await request("auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.ok, true);
  assert.equal(me.body.user, null);

  const profile = await request("account/profile");
  assert.equal(profile.status, 401);
  assert.equal(profile.body.ok, false);

  const orders = await request("orders");
  assert.equal(orders.status, 401);
  assert.equal(orders.body.ok, false);

  const smmAdmin = await request("admin/smm-products");
  assert.equal(smmAdmin.status, 401);
  assert.equal(smmAdmin.body.ok, false);

  const support = await request("support/chat");
  assert.equal(support.status, 200);
  assert.equal(support.body.ok, true);
  assert.equal(support.body.guest, true, "Guests can use the instant site-help assistant without signing in");

  const adminPayments = await request("admin/payments");
  assert.equal(adminPayments.status, 401);
  assert.equal(adminPayments.body.ok, false);

  const squadWebhook = await request("payments/squad-webhook");
  assert.equal(squadWebhook.status, 405);
  const removedMonnifyWebhook = await request("payments/webhook");
  assert.equal(removedMonnifyWebhook.status, 404);
  const removedMonnifyTest = await request("payments/create-test", "POST");
  assert.equal(removedMonnifyTest.status, 404);

  const adminSupport = await request("admin/support");
  assert.equal(adminSupport.status, 401);
  assert.equal(adminSupport.body.ok, false);

  const unknown = await request("not-a-real-route");
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, "API route not found.");

  console.log("API router tests passed (health, nested auth, profile, orders and 404 handling).");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
