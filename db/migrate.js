const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Configure it in the server environment.");
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    application_name: "verifyflow-migrations"
  });

  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS vf_schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const version = "001_customer_accounts";
    const existing = await client.query(
      "SELECT version FROM vf_schema_migrations WHERE version = $1",
      [version]
    );

    if (existing.rowCount) {
      await client.query("COMMIT");
      console.log("VerifyFlow database is already up to date.");
      return;
    }

    const sqlPath = path.join(__dirname, "migrations", version + ".sql");
    const sql = fs.readFileSync(sqlPath, "utf8");
    await client.query(sql);
    await client.query(
      "INSERT INTO vf_schema_migrations (version) VALUES ($1)",
      [version]
    );
    await client.query("COMMIT");
    console.log("Applied VerifyFlow migration " + version + ".");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error("VerifyFlow database migration failed:", error.message);
  process.exitCode = 1;
});
