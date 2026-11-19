const assert = require("node:assert/strict");
const handler = require("../api/index.js");

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
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

  const unknown = await request("not-a-real-route");
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, "API route not found.");

  console.log("API router tests passed (health, nested auth, profile, orders and 404 handling).");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
