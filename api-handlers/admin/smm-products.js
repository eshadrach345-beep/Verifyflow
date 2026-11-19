"use strict";

const { getPool, getSessionUser, sendJson, readJson, sameOrigin } = require("../../lib/auth");
const { readProvider } = require("../../lib/smm-catalog");

const PROVIDERS = ["peakerr", "justanotherpanel"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function adminEmails() {
  return String(process.env.VERIFYFLOW_ADMIN_EMAILS || "")
    .split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
}
async function requireAdmin(req, res) {
  const user = await getSessionUser(req);
  if (!user) { sendJson(res, 401, { ok: false, error: "Please sign in." }); return false; }
  const allowed = adminEmails();
  if (!allowed.length) { sendJson(res, 503, { ok: false, error: "Admin access has not been configured." }); return false; }
  if (!allowed.includes(String(user.email || "").toLowerCase())) {
    sendJson(res, 403, { ok: false, error: "You do not have admin access." }); return false;
  }
  return true;
}
function moneyToMinor(value) {
  const match = String(value ?? "").trim().match(/^(\d{1,9})(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const amount = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0") || "0");
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}
function productRow(row) {
  return {
    id: row.id, provider: row.provider, serviceId: row.supplier_service_id,
    platform: row.platform, productName: row.product_name, description: row.description,
    supplierRate: row.supplier_rate == null ? null : String(row.supplier_rate),
    supplierCurrency: row.supplier_currency,
    min: Number(row.min_quantity), max: Number(row.max_quantity),
    retailRateMinorPer1000: Number(row.retail_rate_minor_per_1000),
    active: Boolean(row.is_active), createdAt: row.created_at, updatedAt: row.updated_at
  };
}

module.exports = async function handler(req, res) {
  if (!["GET", "POST", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, DELETE");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }
  if (req.method !== "GET" && !sameOrigin(req)) {
    return sendJson(res, 403, { ok: false, error: "Request could not be verified." });
  }
  try {
    if (!await requireAdmin(req, res)) return;
    if (req.method === "GET") {
      const [providers, products] = await Promise.all([
        Promise.all(PROVIDERS.map(readProvider)),
        getPool().query("SELECT * FROM vf_smm_products ORDER BY updated_at DESC LIMIT 500")
      ]);
      return sendJson(res, 200, {
        ok: true,
        providers: providers.map(provider => ({
          provider: provider.provider, label: provider.label, connected: provider.connected,
          message: provider.message, balance: provider.balance, currency: provider.currency,
          services: provider.eligibleServices || []
        })),
        products: products.rows.map(productRow),
        updatedAt: new Date().toISOString()
      });
    }

    let body;
    try { body = await readJson(req); }
    catch { return sendJson(res, 400, { ok: false, error: "Please submit valid product details." }); }

    if (req.method === "DELETE") {
      const id = String(body.id || "");
      if (!UUID.test(id)) return sendJson(res, 400, { ok: false, error: "Select a valid product." });
      const result = await getPool().query(
        "UPDATE vf_smm_products SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id",
        [id]
      );
      if (!result.rowCount) return sendJson(res, 404, { ok: false, error: "Product not found." });
      return sendJson(res, 200, { ok: true, id, active: false });
    }

    const provider = String(body.provider || "").toLowerCase();
    if (!PROVIDERS.includes(provider)) return sendJson(res, 400, { ok: false, error: "Choose Peakerr or JustAnotherPanel." });
    const serviceId = String(body.serviceId || "").trim();
    const platform = String(body.platform || "").trim().slice(0, 60);
    const productName = String(body.productName || "").trim().slice(0, 140);
    const description = String(body.description || "").trim().slice(0, 500);
    const retailRateMinor = moneyToMinor(body.pricePer1000);
    const id = String(body.id || "");
    if (id && !UUID.test(id)) return sendJson(res, 400, { ok: false, error: "The saved product reference is invalid." });
    if (!serviceId || !platform || !productName || retailRateMinor === null) {
      return sendJson(res, 400, { ok: false, error: "Enter the platform, product name, supplier service and a valid USD price per 1,000." });
    }

    const supplier = await readProvider(provider);
    if (!supplier.connected) return sendJson(res, 503, { ok: false, error: supplier.message || "Supplier catalogue is unavailable." });
    const service = (supplier.eligibleServices || []).find(item => item.id === serviceId);
    if (!service) return sendJson(res, 409, { ok: false, error: "That supplier service is no longer available. Refresh the service list and choose again." });
    const min = Number(service.min), max = Number(service.max);
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min) {
      return sendJson(res, 409, { ok: false, error: "The supplier returned invalid quantity limits for this service." });
    }
    const supplierRate = Number(service.supplierRateReported);
    const validSupplierRate = Number.isFinite(supplierRate) && supplierRate >= 0 ? supplierRate : null;
    const supplierCurrency = /^[A-Z]{3}$/.test(String(service.supplierCurrency || "")) ? service.supplierCurrency : null;

    const saved = await getPool().query(
      "INSERT INTO vf_smm_products (id, provider, supplier_service_id, platform, product_name, description, supplier_rate, supplier_currency, min_quantity, max_quantity, retail_rate_minor_per_1000, is_active, updated_at) " +
      "VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, NOW()) " +
      "ON CONFLICT (id) DO UPDATE SET provider = EXCLUDED.provider, supplier_service_id = EXCLUDED.supplier_service_id, platform = EXCLUDED.platform, product_name = EXCLUDED.product_name, description = EXCLUDED.description, supplier_rate = EXCLUDED.supplier_rate, supplier_currency = EXCLUDED.supplier_currency, min_quantity = EXCLUDED.min_quantity, max_quantity = EXCLUDED.max_quantity, retail_rate_minor_per_1000 = EXCLUDED.retail_rate_minor_per_1000, is_active = TRUE, updated_at = NOW() RETURNING *",
      [id || null, provider, serviceId, platform, productName, description, validSupplierRate, supplierCurrency, min, max, retailRateMinor]
    );
    return sendJson(res, 200, { ok: true, product: productRow(saved.rows[0]) });
  } catch (error) {
    console.error("[admin/smm-products]", error.code || error.message);
    const missingMigration = error.code === "42P01";
    return sendJson(res, 503, {
      ok: false,
      error: missingMigration
        ? "The SMM product database migration has not been applied yet."
        : "The SMM product manager is temporarily unavailable."
    });
  }
};
