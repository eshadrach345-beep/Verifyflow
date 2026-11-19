const {
  getPool, sendJson, readJson, sameOrigin, hashPassword,
  issueSession, publicUser, hashToken
} = require("../../lib/auth");
const { enforceAuthRateLimit, pruneExpiredRateLimits } = require("../../lib/rate-limit");
const { sendVerificationEmail, isEmailConfigured } = require("../../lib/email");
const { randomBytes } = require("node:crypto");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }
  if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: "Request could not be verified." });

  let body;
  try { body = await readJson(req); }
  catch { return sendJson(res, 400, { ok: false, error: "Please submit a valid form." }); }

  const fullName = String(body.fullName || "").trim().replace(/\s+/g, " ");
  const email = String(body.email || "").trim().toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  if (fullName.length < 2 || fullName.length > 80) {
    return sendJson(res, 400, { ok: false, error: "Enter your name (2–80 characters)." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return sendJson(res, 400, { ok: false, error: "Enter a valid email address." });
  }
  if (password.length < 10 || password.length > 128) {
    return sendJson(res, 400, { ok: false, error: "Use a password with at least 10 characters." });
  }

  if (!isEmailConfigured()) return sendJson(res, 503, { ok: false, error: "Account registration is temporarily unavailable while email verification is configured." });

  let client;
  try {
    if (await enforceAuthRateLimit(req, res, {
      scope: "register",
      identifier: email,
      ipLimit: 20,
      identityLimit: 3,
      windowSeconds: 3600
    })) return;
    await pruneExpiredRateLimits();
    const passwordHash = await hashPassword(password);
    const verificationToken = randomBytes(32).toString("hex");
    client = await getPool().connect();
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO vf_users (email, password_hash, full_name, status)
       VALUES ($1, $2, $3, 'pending_verification')
       RETURNING id, email, full_name, created_at`,
      [email, passwordHash, fullName]
    );
    const user = inserted.rows[0];
    await client.query("INSERT INTO vf_customer_profiles (user_id, display_name) VALUES ($1, $2)", [user.id, fullName]);
    await client.query(
      "INSERT INTO vf_email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '24 hours')",
      [user.id, hashToken(verificationToken)]
    );
    await client.query("COMMIT");
    try { await sendVerificationEmail({ email: user.email, name: user.full_name, token: verificationToken }); }
    catch (emailError) { console.error("[auth/register-email]", emailError.code || "EMAIL_SEND_FAILED"); }
    return sendJson(res, 201, {
      ok: true, verificationRequired: true,
      message: "Your account has been created. Check your email for a verification link. You must verify your email before signing in."
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") {
      return sendJson(res, 409, { ok: false, error: "An account with this email already exists. Sign in instead." });
    }
    console.error("[auth/register]", error.code || error.message);
    return sendJson(res, 503, { ok: false, error: "Account creation is temporarily unavailable. Please try again shortly." });
  } finally {
    client?.release();
  }
};
