"use strict";

const { getPool, getSessionUser, sendJson } = require("../../lib/auth");
const { REQUIRED_TABLES, buildLaunchChecks } = require("../../lib/launch-readiness");

function adminEmails() {
  return String(process.env.VERIFYFLOW_ADMIN_EMAILS || "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }

  try {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { ok: false, error: "Please sign in." });

    const allowed = adminEmails();
    if (!allowed.length) {
      return sendJson(res, 503, { ok: false, error: "Admin access is not configured." });
    }
    if (!allowed.includes(String(user.email || "").toLowerCase())) {
      return sendJson(res, 403, { ok: false, error: "You do not have admin access." });
    }

    const database = { connected: false, tables: [], migrations: [] };
    if (process.env.DATABASE_URL) {
      let client;
      try {
        client = await getPool().connect();
        database.connected = true;
        const tableResult = await client.query(
          "SELECT table_name FROM information_schema.tables " +
          "WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
          [REQUIRED_TABLES.concat("vf_schema_migrations")]
        );
        database.tables = tableResult.rows.map(row => row.table_name);

        if (database.tables.includes("vf_schema_migrations")) {
          const migrationResult = await client.query(
            "SELECT version FROM vf_schema_migrations ORDER BY version"
          );
          database.migrations = migrationResult.rows.map(row => row.version);
        }
      } catch (error) {
        console.error("[admin/readiness-db]", error.code || "DATABASE_CHECK_FAILED");
        database.connected = false;
      } finally {
        client?.release();
      }
    }

    const checks = buildLaunchChecks(process.env, database);
    const requiredChecksReady = checks.every(check => !check.required || check.status === "ready");
    const needsAction = checks.filter(check => check.required && check.status === "needs_action").length;
    const reviews = checks.filter(check => check.required && check.status === "review").length;

    return sendJson(res, 200, {
      ok: true,
      checkedAt: new Date().toISOString(),
      requiredChecksReady,
      needsAction,
      reviews,
      checks
    });
  } catch (error) {
    console.error("[admin/readiness]", error.code || error.message);
    return sendJson(res, 503, { ok: false, error: "Launch readiness could not be checked right now." });
  }
};
