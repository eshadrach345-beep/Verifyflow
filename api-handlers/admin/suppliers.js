"use strict";

const { getPool, getSessionUser, sendJson, readJson, sameOrigin } = require("../../lib/auth");
const { readProvider } = require("../../lib/smm-catalog");
const { readAccount: readHeroSmsAccount } = require("../../lib/herosms-account");
const { readRetailStatus: readHeroSmsRetailStatus } = require("../../lib/herosms-retail-status");
const { readAccount: readVoidMobAccount } = require("../../lib/voidmob-account");

const SUPPLIERS = new Set(["voidmob", "herosms", "peakerr", "justanotherpanel"]);
function adminEmails() {
  return String(process.env.VERIFYFLOW_ADMIN_EMAILS || "")
    .split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
}
async function requireAdmin(req, res) {
  const user = await getSessionUser(req);
  if (!user) { sendJson(res, 401, { ok: false, error: "Please sign in." }); return false; }
  const allowed = adminEmails();
  if (!allowed.length) { sendJson(res, 503, { ok: false, error: "Admin access is not configured." }); return false; }
  if (!allowed.includes(String(user.email || "").toLowerCase())) {
    sendJson(res, 403, { ok: false, error: "You do not have admin access." }); return false;
  }
  return true;
}
module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }
  if (req.method === "POST" && !sameOrigin(req)) {
    return sendJson(res, 403, { ok: false, error: "Request could not be verified." });
  }
  try {
    if (!await requireAdmin(req, res)) return;
    const pool = getPool();
    if (req.method === "POST") {
      let body;
      try { body = await readJson(req); }
      catch { return sendJson(res, 400, { ok: false, error: "Submit valid supplier funding settings." }); }
      const provider = String(body.provider || "").toLowerCase();
      const amount = Number(body.minimumDeposit);
      if (!SUPPLIERS.has(provider) || !Number.isFinite(amount) || amount < 0 || amount > 1000000 ||
          (amount !== 0 && !Number.isSafeInteger(Math.round(amount * 100)))) {
        return sendJson(res, 400, { ok: false, error: "Enter a valid minimum deposit in USD. Use 0 if the supplier has no minimum." });
      }
      const minor = amount === 0 ? null : Math.round(amount * 100);
      await pool.query(
        "INSERT INTO vf_supplier_funding_settings (provider, minimum_deposit_minor, currency, updated_at) " +
        "VALUES ($1, $2, 'USD', NOW()) ON CONFLICT (provider) DO UPDATE SET minimum_deposit_minor = EXCLUDED.minimum_deposit_minor, updated_at = NOW()",
        [provider, minor]
      );
      return sendJson(res, 200, { ok: true, provider, minimumDepositMinor: minor });
    }
    const [providers, heroSms, heroSmsRetail, voidMob, settings] = await Promise.all([
      Promise.all([readProvider("peakerr"), readProvider("justanotherpanel")]),
      readHeroSmsAccount(),
      readHeroSmsRetailStatus(),
      readVoidMobAccount(),
      pool.query("SELECT provider, minimum_deposit_minor FROM vf_supplier_funding_settings")
    ]);
    const minimumDeposits = Object.fromEntries(settings.rows.map(row => [row.provider, row.minimum_deposit_minor == null ? null : Number(row.minimum_deposit_minor)]));
    return sendJson(res, 200, {
      ok: true, updatedAt: new Date().toISOString(),
      providers: providers.map(({ eligibleServices, ...provider }) => ({ ...provider, eligibleServices })),
      heroSms, heroSmsRetail, voidMob, minimumDeposits
    });
  } catch (error) {
    console.error("[admin/suppliers]", error.code || error.message);
    return sendJson(res, 503, { ok: false, error: "Supplier report is temporarily unavailable." });
  }
};
