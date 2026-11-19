"use strict";

const { getPool, getSessionUser, sendJson, readJson, sameOrigin } = require("../../lib/auth");
const { processFulfilmentForOrder } = require("../../lib/fulfilment");

function adminEmails() {
  return String(process.env.VERIFYFLOW_ADMIN_EMAILS || "")
    .split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
}

async function requireAdmin(req, res) {
  const user = await getSessionUser(req);
  if (!user) {
    sendJson(res, 401, { ok: false, error: "Please sign in." });
    return false;
  }
  const allowed = adminEmails();
  if (!allowed.length) {
    sendJson(res, 503, { ok: false, error: "Admin access has not been configured." });
    return false;
  }
  if (!allowed.includes(String(user.email || "").toLowerCase())) {
    sendJson(res, 403, { ok: false, error: "You do not have admin access." });
    return false;
  }
  return true;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }
  if (req.method === "POST" && !sameOrigin(req)) {
    return sendJson(res, 403, { ok: false, error: "Request could not be verified." });
  }
  try {
    if (!await requireAdmin(req, res)) return;
    if (req.method === "GET") {
      const result = await getPool().query(
        "SELECT o.id AS order_id, o.order_number, o.product_name, o.product_type, o.status AS order_status, " +
        "j.status AS fulfilment_status, j.supplier_order_id, j.supplier_cost_minor, j.supplier_currency, " +
        "j.supplier_status, j.attempts, j.last_error_code, j.last_error_message, j.updated_at " +
        "FROM vf_fulfilment_jobs j JOIN vf_orders o ON o.id = j.order_id " +
        "ORDER BY CASE j.status WHEN 'unknown' THEN 0 WHEN 'failed' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END, j.created_at DESC LIMIT 200"
      );
      return sendJson(res, 200, { ok: true, jobs: result.rows });
    }

    let body;
    try { body = await readJson(req); }
    catch { return sendJson(res, 400, { ok: false, error: "Please submit a valid order." }); }
    const orderId = String(body.orderId || "");
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
      return sendJson(res, 400, { ok: false, error: "The order reference is invalid." });
    }
    const job = await getPool().query(
      "SELECT j.status, o.status AS order_status, o.provider FROM vf_fulfilment_jobs j JOIN vf_orders o ON o.id = j.order_id WHERE j.order_id = $1 LIMIT 1",
      [orderId]
    );
    if (!job.rowCount) return sendJson(res, 404, { ok: false, error: "No fulfilment job exists for this order." });
    const retryUnknown = job.rows[0].status === "unknown" && String(body.action || "") === "retry_unknown" && job.rows[0].provider === "voidmob";
    if (job.rows[0].status === "unknown" && ["herosms", "peakerr", "justanotherpanel"].includes(job.rows[0].provider)) {
      return sendJson(res, 409, { ok: false, error: "This supplier has not confirmed the original request. Reconcile the order in the supplier dashboard before attempting any new purchase; automatic retry is disabled to prevent duplicate charges." });
    }
    if ((job.rows[0].status !== "pending" && !retryUnknown) || !["paid", "processing"].includes(job.rows[0].order_status)) {
      return sendJson(res, 409, { ok: false, error: "Only pending jobs or explicitly reconciled unknown jobs can be submitted." });
    }
    const result = await processFulfilmentForOrder(orderId, { retryUnknown });
    return sendJson(res, 200, { ok: true, result });
  } catch (error) {
    console.error("[admin/fulfilment]", error.code || error.message);
    return sendJson(res, 503, { ok: false, error: "The fulfilment queue is temporarily unavailable." });
  }
};
