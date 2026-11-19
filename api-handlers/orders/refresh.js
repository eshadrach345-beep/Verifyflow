"use strict";

const { getSessionUser, sendJson, readJson, sameOrigin } = require("../../lib/auth");
const { refreshOrderFromSupplier } = require("../../lib/fulfilment");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }
  if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: "Request could not be verified." });
  let body;
  try { body = await readJson(req); }
  catch { return sendJson(res, 400, { ok: false, error: "Please submit a valid order reference." }); }

  try {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { ok: false, error: "Please sign in to refresh this order." });
    const orderId = String(body.orderId || "");
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
      return sendJson(res, 400, { ok: false, error: "The order reference is invalid." });
    }
    const result = await refreshOrderFromSupplier(orderId, user.id);
    return sendJson(res, 200, { ok: true, order: result });
  } catch (error) {
    if (error.code === "ORDER_NOT_FOUND") return sendJson(res, 404, { ok: false, error: "That order could not be found in your account." });
    console.error("[orders/refresh]", error.code || error.message);
    return sendJson(res, 503, { ok: false, error: "Your supplier status could not be refreshed right now." });
  }
};
