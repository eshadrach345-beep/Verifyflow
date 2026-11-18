const {
  getPool, sendJson, readJson, sameOrigin, hashPassword,
  issueSession, publicUser
} = require("../../lib/auth");

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

  let client;
  try {
    const passwordHash = await hashPassword(password);
    client = await getPool().connect();
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO vf_users (email, password_hash, full_name, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING id, email, full_name, created_at`,
      [email, passwordHash, fullName]
    );
    const user = inserted.rows[0];
    await client.query(
      "INSERT INTO vf_customer_profiles (user_id, display_name) VALUES ($1, $2)",
      [user.id, fullName]
    );
    await issueSession(client, user.id, res);
    await client.query("COMMIT");
    return sendJson(res, 201, { ok: true, user: publicUser(user) });
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
