"use strict";
const assert = require("node:assert/strict");
const authPath = require.resolve("../lib/auth");
const originalAuth = require.cache[authPath];
const rows = [{
  id: "9e8d0ed1-1d2a-4e31-a211-b5486df4fe0d",
  platform: "TikTok",
  subcategory: "Likes",
  classification_status: "high",
  product_name: "Likes",
  description: "TikTok post likes",
  min_quantity: 50,
  max_quantity: 50000,
  retail_rate_minor_per_1000: 500
}];
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: { getPool: () => ({ query: async () => ({ rows }) }) }
};
const handler = require("../api-handlers/marketing-catalog");
function response() {
  return { statusCode: 0, headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(body) { this.body = body; } };
}
async function main() {
  const res = response();
  await handler({ method: "GET" }, res);
  const data = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(data.ok, true);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].platform, "TikTok");
  assert.equal(data.items[0].category, "TikTok");
  assert.equal(data.items[0].subcategory, "Likes");
  assert.equal(data.items[0].classificationStatus, "high");
  assert.equal(data.items[0].name, "Likes");
  assert.equal(data.items[0].min, 50);
  assert.equal(data.items[0].max, 50000);
  assert.equal(data.items[0].pricePer1000Minor, 500);
  assert.equal(Object.hasOwn(data.items[0], "provider"), false);
  assert.equal(JSON.stringify(data).includes("supplierRate"), false);
  console.log("Public SMM catalogue tests passed (only saved active products and retail prices are returned).");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (originalAuth) require.cache[authPath] = originalAuth; else delete require.cache[authPath];
});
