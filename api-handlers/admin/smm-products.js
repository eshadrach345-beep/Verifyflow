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
    markupPercent: (() => {
      const rate = Number(row.supplier_rate), currency = String(row.supplier_currency || "").toUpperCase();
      const fx = Number(process.env.VERIFYFLOW_USD_NGN_RATE || 1400);
      const usdCost = currency === "USD" ? rate : currency === "NGN" && fx > 0 ? rate / fx : null;
      return usdCost > 0 ? Math.max(0, Math.round((Number(row.retail_rate_minor_per_1000) / 100 / usdCost - 1) * 100)) : null;
    })(),
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
      // Supplier catalogues and saved storefront products are independent.
      // If migration 006 has not been applied, still return the full supplier
      // service lists so the admin can inspect them and report the setup issue.
      const providers = await Promise.all(PROVIDERS.map(readProvider));
      let products = [], productsTableReady = true;
      try {
        const result = await getPool().query(
          "SELECT * FROM vf_smm_products ORDER BY updated_at DESC LIMIT 500"
        );
        products = result.rows.map(productRow);
      } catch (error) {
        if (error.code !== "42P01") throw error;
        productsTableReady = false;
      }
      return sendJson(res, 200, {
        ok: true,
        providers: providers.map(provider => ({
          provider: provider.provider, label: provider.label, connected: provider.connected,
          message: provider.message, balance: provider.balance, currency: provider.currency,
          services: provider.eligibleServices || []
        })),
        products,
        productsTableReady,
        productsMessage: productsTableReady ? null :
          "The SMM product table is not installed yet. Apply database migration 006_smm_product_manager.sql to enable saving and publishing products.",
        updatedAt: new Date().toISOString()
      });
    }

    let body;
    try { body = await readJson(req); }
    catch { return sendJson(res, 400, { ok: false, error: "Please submit valid product details." }); }

    if (req.method === "POST" && body.action === "deduplicate") {
      // Keep the highest-priced active listing for each same platform, product
      // name and quantity range. Other matching rows are soft-hidden so order
      // history and existing references remain intact.
      const result = await getPool().query(
        "WITH ranked AS (" +
          "SELECT id, ROW_NUMBER() OVER (" +
            "PARTITION BY LOWER(REGEXP_REPLACE(TRIM(platform), '\\s+', ' ', 'g')), " +
              "LOWER(REGEXP_REPLACE(TRIM(product_name), '\\s+', ' ', 'g')), min_quantity, max_quantity " +
            "ORDER BY retail_rate_minor_per_1000 DESC, updated_at DESC, created_at DESC, id ASC" +
          ") AS duplicate_rank " +
          "FROM vf_smm_products WHERE is_active = TRUE" +
        "), hidden AS (" +
          "UPDATE vf_smm_products p SET is_active = FALSE, updated_at = NOW() " +
          "FROM ranked r WHERE p.id = r.id AND r.duplicate_rank > 1 RETURNING p.id" +
        ") SELECT COUNT(*)::INTEGER AS removed_count FROM hidden"
      );
      return sendJson(res, 200, {
        ok: true,
        removedCount: Number(result.rows[0]?.removed_count || 0),
        rule: "Kept the highest-priced listing for each matching platform, product name and quantity range."
      });
    }

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
    const markupPercent = Number(body.markupPercent);
    if (!Number.isFinite(markupPercent) || markupPercent < 0 || markupPercent > 1000) {
      return sendJson(res, 400, { ok: false, error: "Enter a markup percentage between 0 and 1,000." });
    }
    const supplier = await readProvider(provider);
    if (!supplier.connected) return sendJson(res, 503, { ok: false, error: supplier.message || "Supplier catalogue is unavailable." });
    const fx = Number(process.env.VERIFYFLOW_USD_NGN_RATE || 1400);
    const toRetailMinor = service => {
      const rate = Number(service.supplierRateReported);
      if (!Number.isFinite(rate) || rate <= 0) return null;
      const currency = String(service.supplierCurrency || "").toUpperCase();
      const usdCost = currency === "USD" ? rate : currency === "NGN" && Number.isFinite(fx) && fx > 0 ? rate / fx : null;
      if (usdCost === null) return null;
      const retail = Math.ceil(usdCost * (1 + markupPercent / 100) * 100 - 1e-9);
      return Number.isSafeInteger(retail) && retail > 0 ? retail : null;
    };
    const serviceMeta = service => {
      const min = Number(service.min), max = Number(service.max);
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min) return null;
      const supplierRate = Number(service.supplierRateReported);
      const supplierCurrency = /^[A-Z]{3}$/.test(String(service.supplierCurrency || "")) ? service.supplierCurrency : null;
      const retailRateMinor = toRetailMinor(service);
      if (!retailRateMinor) return null;
      return {
        serviceId: String(service.id), platform: String(service.category || "Other").slice(0, 60),
        productName: String(service.name || "Supplier service").slice(0, 140),
        description: String(service.description || "").slice(0, 500),
        supplierRate: Number.isFinite(supplierRate) && supplierRate >= 0 ? supplierRate : null,
        supplierCurrency, min, max, retailRateMinor
      };
    };

    if (body.action === "bulk") {
      const ids = Array.isArray(body.serviceIds) ? [...new Set(body.serviceIds.map(value => String(value).trim()).filter(Boolean))] : [];
      if (!ids.length || ids.length > 10000) return sendJson(res, 400, { ok: false, error: "Select between 1 and 10,000 supplier services." });
      const serviceMap = new Map((supplier.eligibleServices || []).map(item => [String(item.id), item]));
      const rows = [], invalid = [];
      for (const id of ids) {
        const service = serviceMap.get(id);
        const row = service && serviceMeta(service);
        if (!row) { invalid.push(id); continue; }
        rows.push(row);
      }
      if (!rows.length) return sendJson(res, 409, { ok: false, error: "None of the selected services has a supported USD or NGN supplier rate. Check the supplier catalogue rates." });
      const saved = await getPool().query(
        "WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(service_id TEXT, platform TEXT, product_name TEXT, description TEXT, supplier_rate NUMERIC, supplier_currency CHAR(3), min_quantity INTEGER, max_quantity INTEGER, retail_rate_minor_per_1000 BIGINT)), " +
        "updated AS (UPDATE vf_smm_products p SET platform=i.platform, product_name=i.product_name, description=i.description, supplier_rate=i.supplier_rate, supplier_currency=i.supplier_currency, min_quantity=i.min_quantity, max_quantity=i.max_quantity, retail_rate_minor_per_1000=i.retail_rate_minor_per_1000, is_active=TRUE, updated_at=NOW() FROM incoming i WHERE p.provider=$2 AND p.supplier_service_id=i.service_id RETURNING p.*), " +
        "inserted AS (INSERT INTO vf_smm_products (provider,supplier_service_id,platform,product_name,description,supplier_rate,supplier_currency,min_quantity,max_quantity,retail_rate_minor_per_1000,is_active,updated_at) SELECT $2,i.service_id,i.platform,i.product_name,i.description,i.supplier_rate,i.supplier_currency,i.min_quantity,i.max_quantity,i.retail_rate_minor_per_1000,TRUE,NOW() FROM incoming i WHERE NOT EXISTS (SELECT 1 FROM vf_smm_products p WHERE p.provider=$2 AND p.supplier_service_id=i.service_id) RETURNING *) " +
        "SELECT * FROM updated UNION ALL SELECT * FROM inserted",
        [JSON.stringify(rows), provider]
      );
      return sendJson(res, 200, {
        ok: true, savedCount: saved.rowCount, skippedCount: invalid.length,
        skippedServiceIds: invalid.slice(0, 100), products: saved.rows.map(productRow)
      });
    }

    const serviceId = String(body.serviceId || "").trim();
    const id = String(body.id || "");
    if (id && !UUID.test(id)) return sendJson(res, 400, { ok: false, error: "The saved product reference is invalid." });
    const service = (supplier.eligibleServices || []).find(item => item.id === serviceId);
    if (!service) return sendJson(res, 409, { ok: false, error: "That supplier service is no longer available. Refresh the service list and choose again." });
    const row = serviceMeta({ ...service, category: String(body.platform || service.category || "Other"), name: String(body.productName || service.name), description: String(body.description || service.description || "") });
    if (!row) return sendJson(res, 400, { ok: false, error: "This service has no usable supplier rate in USD or NGN. A percentage price cannot be calculated." });
    const saved = await getPool().query(
      "INSERT INTO vf_smm_products (id, provider, supplier_service_id, platform, product_name, description, supplier_rate, supplier_currency, min_quantity, max_quantity, retail_rate_minor_per_1000, is_active, updated_at) " +
      "VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, NOW()) " +
      "ON CONFLICT (id) DO UPDATE SET provider = EXCLUDED.provider, supplier_service_id = EXCLUDED.supplier_service_id, platform = EXCLUDED.platform, product_name = EXCLUDED.product_name, description = EXCLUDED.description, supplier_rate = EXCLUDED.supplier_rate, supplier_currency = EXCLUDED.supplier_currency, min_quantity = EXCLUDED.min_quantity, max_quantity = EXCLUDED.max_quantity, retail_rate_minor_per_1000 = EXCLUDED.retail_rate_minor_per_1000, is_active = TRUE, updated_at = NOW() RETURNING *",
      [id || null, provider, row.serviceId, row.platform, row.productName, row.description, row.supplierRate, row.supplierCurrency, row.min, row.max, row.retailRateMinor]
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
