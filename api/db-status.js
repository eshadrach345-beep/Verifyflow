const { Client } = require("pg");
const { timingSafeEqual } = require("node:crypto");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Database diagnostics are administrative only. The public storefront
  // never receives supplier, schema, or environment readiness information.
  const expected = process.env.VERIFYFLOW_ADMIN_SECRET || "";
  const supplied = String(req.headers.authorization || "").startsWith("Bearer ") ? String(req.headers.authorization).slice(7) : "";
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (!expected || expectedBuffer.length !== suppliedBuffer.length ||
      !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return res.status(404).json({ ok: false, error: "Not found." });
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }
  if (!process.env.DATABASE_URL) {
    return res.status(503).json({ ok: false, database: "not_configured", schema: "unknown" });
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
    application_name: "verifyflow-admin-health-check"
  });
  try {
    await client.connect();
    const result = await client.query(
      "SELECT to_regclass('public.vf_users') IS NOT NULL AS customer_tables_ready"
    );
    const ready = Boolean(result.rows[0]?.customer_tables_ready);
    return res.status(200).json({
      ok: true,
      database: "connected",
      schema: ready ? "customer_tables_ready" : "migration_pending",
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("[admin/db-status] Database check failed:", error.code || "DB_ERROR");
    return res.status(503).json({ ok: false, database: "unavailable", schema: "unknown" });
  } finally {
    await client.end().catch(() => {});
  }
};
