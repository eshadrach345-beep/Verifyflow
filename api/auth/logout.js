const {
  getPool, sendJson, sameOrigin, readCookie, hashToken, clearSessionCookie
} = require("../../lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }
  if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: "Request could not be verified." });
  const token = readCookie(req, "vf_session");
  try {
    if (token) await getPool().query("DELETE FROM vf_sessions WHERE token_hash = $1", [hashToken(token)]);
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error("[auth/logout]", error.code || error.message);
    return sendJson(res, 503, { ok: false, error: "Sign-out is temporarily unavailable." });
  }
};
