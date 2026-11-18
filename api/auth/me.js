const { getSessionUser, sendJson, publicUser } = require("../../lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }
  try {
    const user = await getSessionUser(req);
    return sendJson(res, 200, { ok: true, user: user ? publicUser(user) : null });
  } catch (error) {
    console.error("[auth/me]", error.code || error.message);
    return sendJson(res, 503, { ok: false, error: "Your account is temporarily unavailable." });
  }
};
