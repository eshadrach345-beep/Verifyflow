const { getPool, getSessionUser, sendJson, readJson, sameOrigin } = require("../../lib/auth");

function validTimezone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "PATCH") {
    res.setHeader("Allow", "GET, PATCH");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }
  if (req.method === "PATCH" && !sameOrigin(req)) {
    return sendJson(res, 403, { ok: false, error: "Request could not be verified." });
  }

  try {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { ok: false, error: "Please sign in to access your account." });

    if (req.method === "GET") {
      const result = await getPool().query(
        `SELECT u.id, u.email, u.full_name, u.created_at,
                p.display_name, p.country_code, p.preferred_currency, p.timezone
           FROM vf_users u
           LEFT JOIN vf_customer_profiles p ON p.user_id = u.id
          WHERE u.id = $1
          LIMIT 1`,
        [user.id]
      );
      const row = result.rows[0];
      if (!row) return sendJson(res, 404, { ok: false, error: "Your account could not be found." });
      return sendJson(res, 200, {
        ok: true,
        profile: {
          id: row.id,
          email: row.email,
          fullName: row.full_name,
          displayName: row.display_name || row.full_name,
          countryCode: row.country_code || "",
          preferredCurrency: row.preferred_currency || "USD",
          timezone: row.timezone || "Africa/Lagos",
          createdAt: row.created_at
        }
      });
    }

    let body;
    try { body = await readJson(req); }
    catch { return sendJson(res, 400, { ok: false, error: "Please submit a valid profile." }); }

    const fullName = String(body.fullName || "").trim().replace(/\\s+/g, " ");
    const countryCode = String(body.countryCode || "").trim().toUpperCase();
    const currency = String(body.preferredCurrency || "USD").trim().toUpperCase();
    const timezone = String(body.timezone || "Africa/Lagos").trim();

    if (fullName.length < 2 || fullName.length > 80) {
      return sendJson(res, 400, { ok: false, error: "Enter a name between 2 and 80 characters." });
    }
    if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
      return sendJson(res, 400, { ok: false, error: "Use a valid two-letter country code, such as NG or US." });
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      return sendJson(res, 400, { ok: false, error: "Choose a valid three-letter currency code." });
    }
    if (timezone.length > 80 || !validTimezone(timezone)) {
      return sendJson(res, 400, { ok: false, error: "Enter a valid time zone, such as Africa/Lagos or Europe/London." });
    }

    const db = getPool();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE vf_users SET full_name = $1, updated_at = NOW() WHERE id = $2",
        [fullName, user.id]
      );
      await client.query(
        `INSERT INTO vf_customer_profiles
           (user_id, display_name, country_code, preferred_currency, timezone)
         VALUES ($1, $2, NULLIF($3, ''), $4, $5)
         ON CONFLICT (user_id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           country_code = EXCLUDED.country_code,
           preferred_currency = EXCLUDED.preferred_currency,
           timezone = EXCLUDED.timezone,
           updated_at = NOW()`,
        [user.id, fullName, countryCode, currency, timezone]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    return sendJson(res, 200, {
      ok: true,
      profile: {
        id: user.id,
        email: user.email,
        fullName,
        displayName: fullName,
        countryCode,
        preferredCurrency: currency,
        timezone
      }
    });
  } catch (error) {
    console.error("[account/profile]", error.code || error.message);
    return sendJson(res, 503, { ok: false, error: "Your account details are temporarily unavailable. Please try again." });
  }
};
