"use strict";
const assert = require("node:assert/strict");
const { placeSmmOrder, getSmmOrderStatus } = require("../lib/smm-service");

async function main() {
  const oldFetch = global.fetch, oldKey = process.env.PEAKERR_API_KEY;
  process.env.PEAKERR_API_KEY = "test-smm-key";
  const calls = [];
  global.fetch = async (url, options) => {
    const values = new URLSearchParams(options.body);
    calls.push({ url: String(url), values });
    const payload = values.get("action") === "add"
      ? { order: 876543 }
      : { status: "In progress", remains: "450", start_count: "550" };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const created = await placeSmmOrder("peakerr", {
      serviceId: "1234", link: "https://www.tiktok.com/@verifyflow/video/1", quantity: 1000
    });
    assert.equal(created.supplierOrderId, "876543");
    assert.equal(created.status, "Pending");
    assert.equal(calls[0].values.get("action"), "add");
    assert.equal(calls[0].values.get("service"), "1234");
    assert.equal(calls[0].values.get("quantity"), "1000");
    const status = await getSmmOrderStatus("peakerr", "876543");
    assert.equal(status.status, "In progress");
    assert.equal(status.remains, "450");
    assert.equal(calls[1].values.get("action"), "status");
    assert.equal(calls.every(call => call.url === "https://peakerr.com/api/v2"), true);
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.PEAKERR_API_KEY; else process.env.PEAKERR_API_KEY = oldKey;
  }
  console.log("SMM order and supplier status tests passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
