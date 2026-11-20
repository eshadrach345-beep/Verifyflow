"use strict";

const { getPool, getSessionUser, sendJson } = require("../../lib/auth");
const { ensureWalletAccount } = require("../../lib/wallet");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }
  try {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { ok: false, error: "Please sign in to view your wallet." });
    const pool = getPool();
    const client = await pool.connect();
    let balanceMinor = 0;
    try {
      await client.query("BEGIN");
      await ensureWalletAccount(client, user.id);
      const account = await client.query(
        "SELECT balance_minor FROM vf_wallet_accounts WHERE user_id = $1",
        [user.id]
      );
      balanceMinor = Number(account.rows[0]?.balance_minor || 0);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    const history = await pool.query(
      "SELECT amount_minor, transaction_type, description, created_at " +
      "FROM vf_wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30",
      [user.id]
    );
    return sendJson(res, 200, {
      ok: true,
      wallet: {
        balanceMinor,
        currency: "USD",
        transactions: history.rows.map(row => ({
          amountMinor: Number(row.amount_minor),
          type: row.transaction_type,
          description: row.description,
          createdAt: row.created_at
        }))
      }
    });
  } catch (error) {
    console.error("[wallet/get]", error.code || error.message);
    const schemaMismatch = ["42P01", "42P10"].includes(error.code);
    return sendJson(res, 503, { ok: false, error: schemaMismatch
      ? "Your wallet database setup is incomplete. Apply the latest VerifyFlow database migrations, then refresh your wallet."
      : "Your wallet is temporarily unavailable." });
  }
};
