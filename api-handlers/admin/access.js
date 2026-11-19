"use strict";
const { getSessionUser, sendJson } = require("../../lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }
  try {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { ok: false, error: "Please sign in." });
    const allowed = String(process.env.VERIFYFLOW_ADMIN_EMAILS || "")
      .split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
    if (!allowed.length) return sendJson(res, 503, { ok: false, error: "Admin access is not configured." });
    if (!allowed.includes(String(user.email || "").toLowerCase())) {
      return sendJson(res, 403, { ok: false, error: "Not authorized." });
    }
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error("[admin/access]", error.code || error.message);
    return sendJson(res, 503, { ok: false, error: "Admin access could not be checked." });
  }
};
