"use strict";

const { getSessionUser, sendJson } = require("../../lib/auth");
const { readProvider } = require("../../lib/smm-catalog");

function adminEmails() {
  return String(process.env.VERIFYFLOW_ADMIN_EMAILS || "")
    .split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
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
    if (!allowed.length) return sendJson(res, 503, { ok: false, error: "Admin access is not configured." });
    if (!allowed.includes(String(user.email || "").toLowerCase())) {
      return sendJson(res, 403, { ok: false, error: "You do not have admin access." });
    }
    const providers = await Promise.all([
      readProvider("peakerr"),
      readProvider("justanotherpanel")
    ]);
    return sendJson(res, 200, {
      ok: true,
      updatedAt: new Date().toISOString(),
      providers: providers.map(({ eligibleServices, ...provider }) => ({
        ...provider, eligibleServices
      })),
      pricing: {
        markupPercent: Number(process.env.VERIFYFLOW_SMM_MARKUP_PERCENT || 40),
        minimumMarkupCents: Number(process.env.VERIFYFLOW_SMM_MIN_MARKUP_CENTS || 25),
        basis: "USD per 1,000 units; server-side retail rates"
      }
    });
  } catch (error) {
    console.error("[admin/suppliers]", error.code || error.message);
    return sendJson(res, 503, { ok: false, error: "Supplier report is temporarily unavailable." });
  }
};
