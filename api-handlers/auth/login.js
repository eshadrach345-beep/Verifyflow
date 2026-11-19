const {
  getPool, sendJson, readJson, sameOrigin, verifyPassword,
  issueSession, publicUser
} = require("../../lib/auth");
const { enforceAuthRateLimit, pruneExpiredRateLimits } = require("../../lib/rate-limit");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }
  if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: "Request could not be verified." });

  let body;
  try { body = await readJson(req); }
  catch { return sendJson(res, 400, { ok: false, error: "Please submit a valid form." }); }
  const email = String(body.email || "").trim().toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password || email.length > 254 || password.length > 128) {
    return sendJson(res, 400, { ok: false, error: "Enter your email and password." });
  }

  let client;
  try {
    if (await enforceAuthRateLimit(req, res, {
      scope: "login",
      identifier: email,
      ipLimit: 40,
      identityLimit: 8,
      windowSeconds: 900
    })) return;
    await pruneExpiredRateLimits();
    const db = getPool();
    const found = await db.query(
      "SELECT id, email, full_name, password_hash, status, created_at FROM vf_users WHERE LOWER(email) = $1 LIMIT 1",
      [email]
    );
    const user = found.rows[0];
    const validPassword = user && await verifyPassword(password, user.password_hash);
    if (!validPassword || !["active", "pending_verification"].includes(user.status)) {
      return sendJson(res, 401, { ok: false, error: "Email or password is incorrect." });
    }
    if (user.status === "pending_verification") {
      return sendJson(res, 403, { ok: false, verificationRequired: true,
        error: "Please verify your email before signing in. You can request a new verification link below." });
    }

    client = await db.connect();
    await issueSession(client, user.id, res);
    return sendJson(res, 200, { ok: true, user: publicUser(user) });
  } catch (error) {
    console.error("[auth/login]", error.code || error.message);
    return sendJson(res, 503, { ok: false, error: "Sign-in is temporarily unavailable. Please try again shortly." });
  } finally {
    client?.release();
  }
};
