"use strict";

const { getPool, getSessionUser, sendJson, readJson, sameOrigin } = require("../../lib/auth");
const { readProvider } = require("../../lib/smm-catalog");
const { classifySmmService } = require("../../lib/smm-categorizer");

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
function cleanSupplierText(value, maxLength) {
  // PostgreSQL JSONB rejects lone UTF-16 surrogates. Supplier names/descriptions
  // can contain broken emoji or decorative Unicode, so repair them before JSON encoding.
  const input = String(value ?? "");
  let safe = "";
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        safe += input[index] + input[index + 1];
        index += 1;
      } else safe += "�";
    } else if (code >= 0xDC00 && code <= 0xDFFF) safe += "�";
    else safe += input[index];
  }
  return Array.from(safe).slice(0, maxLength).join("");
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
    platform: row.platform, category: row.platform, subcategory: row.subcategory || "Other",
    classificationStatus: row.classification_status || "needs_review", productName: row.product_name, description: row.description,
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
      let productsMessage = null;
      try {
        const result = await getPool().query(
          "SELECT id, provider, supplier_service_id, platform, subcategory, classification_status, product_name, description, supplier_rate, supplier_currency, min_quantity, max_quantity, retail_rate_minor_per_1000, is_active, created_at, updated_at FROM vf_smm_products ORDER BY updated_at DESC LIMIT 500"
        );
        products = result.rows.map(productRow);
      } catch (error) {
        if (!["42P01", "42703"].includes(error.code)) throw error;
        productsTableReady = false;
        productsMessage = error.code === "42P01"
          ? "The SMM product table is not installed yet. Apply database migration 006_smm_product_manager.sql."
          : "The SMM category fields are not installed yet. Apply database migration 010_smm_categories.sql.";
      }
      return sendJson(res, 200, {
        ok: true,
        providers: providers.map(provider => ({
          provider: provider.provider, label: provider.label, connected: provider.connected,
          message: provider.message, balance: provider.balance, currency: provider.currency,
          services: (provider.eligibleServices || []).map(service => ({ ...service, ...classifySmmService(service) }))
        })),
        products,
        productsTableReady,
        productsMessage: productsTableReady ? null : productsMessage,
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
        serviceId: cleanSupplierText(service.id, 160).trim(), platform: cleanSupplierText(classifySmmService(service).platform, 60),
        subcategory: cleanSupplierText(classifySmmService(service).subcategory, 60),
        classificationStatus: classifySmmService(service).classificationStatus,
        productName: cleanSupplierText(service.name || "Supplier service", 140),
        description: cleanSupplierText(service.description || "", 500),
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
        "WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(service_id TEXT, platform TEXT, subcategory TEXT, classification_status TEXT, product_name TEXT, description TEXT, supplier_rate NUMERIC, supplier_currency CHAR(3), min_quantity INTEGER, max_quantity INTEGER, retail_rate_minor_per_1000 BIGINT)) " +
        "INSERT INTO vf_smm_products (provider,supplier_service_id,platform,subcategory,classification_status,product_name,description,supplier_rate,supplier_currency,min_quantity,max_quantity,retail_rate_minor_per_1000,is_active,updated_at) " +
        "SELECT $2,i.service_id,i.platform,i.subcategory,i.classification_status,i.product_name,i.description,i.supplier_rate,i.supplier_currency,i.min_quantity,i.max_quantity,i.retail_rate_minor_per_1000,TRUE,NOW() FROM incoming i " +
        "ON CONFLICT (provider, supplier_service_id) WHERE is_active = TRUE DO UPDATE SET " +
        "platform=EXCLUDED.platform, subcategory=EXCLUDED.subcategory, classification_status=EXCLUDED.classification_status, product_name=EXCLUDED.product_name, description=EXCLUDED.description, " +
        "supplier_rate=EXCLUDED.supplier_rate, supplier_currency=EXCLUDED.supplier_currency, " +
        "min_quantity=EXCLUDED.min_quantity, max_quantity=EXCLUDED.max_quantity, " +
        "retail_rate_minor_per_1000=EXCLUDED.retail_rate_minor_per_1000, is_active=TRUE, updated_at=NOW() " +
        "RETURNING *",
        [JSON.stringify(rows.map(row => ({
          service_id: row.serviceId,
          platform: row.platform,
          subcategory: row.subcategory,
          classification_status: row.classificationStatus,
          product_name: row.productName,
          description: row.description,
          supplier_rate: row.supplierRate,
          supplier_currency: row.supplierCurrency,
          min_quantity: row.min,
          max_quantity: row.max,
          retail_rate_minor_per_1000: row.retailRateMinor
        }))), provider]
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
    const autoClassification = classifySmmService({ ...service, name: body.productName || service.name, description: body.description || service.description });
    const row = serviceMeta(service);
    if (!row) return sendJson(res, 400, { ok: false, error: "This service has no usable supplier rate in USD or NGN. A percentage price cannot be calculated." });
    row.platform = cleanSupplierText(body.platform || autoClassification.platform, 60);
    row.subcategory = cleanSupplierText(body.subcategory || autoClassification.subcategory, 60);
    const manualCategoryOverride = (body.platform && body.platform !== autoClassification.platform) ||
      (body.subcategory && body.subcategory !== autoClassification.subcategory);
    row.classificationStatus = manualCategoryOverride ? "medium" : autoClassification.classificationStatus;
    row.productName = cleanSupplierText(body.productName || service.name, 140);
    row.description = cleanSupplierText(body.description || service.description || "", 500);
    const productValues = [provider, row.serviceId, row.platform, row.subcategory, row.classificationStatus, row.productName, row.description,
      row.supplierRate, row.supplierCurrency, row.min, row.max, row.retailRateMinor];
    let saved;
    if (id) {
      saved = await getPool().query(
        "UPDATE vf_smm_products SET provider=$2, supplier_service_id=$3, platform=$4, subcategory=$5, classification_status=$6, product_name=$7, description=$8, " +
        "supplier_rate=$9, supplier_currency=$10, min_quantity=$11, max_quantity=$12, retail_rate_minor_per_1000=$13, " +
        "is_active=TRUE, updated_at=NOW() WHERE id=$1 RETURNING *",
        [id, ...productValues]
      );
      if (!saved.rowCount) return sendJson(res, 404, { ok: false, error: "The product you are editing no longer exists. Refresh the list and try again." });
    } else {
      saved = await getPool().query(
        "INSERT INTO vf_smm_products (provider,supplier_service_id,platform,subcategory,classification_status,product_name,description,supplier_rate,supplier_currency,min_quantity,max_quantity,retail_rate_minor_per_1000,is_active,updated_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE,NOW()) " +
        "ON CONFLICT (provider, supplier_service_id) WHERE is_active = TRUE DO UPDATE SET " +
        "platform=EXCLUDED.platform, subcategory=EXCLUDED.subcategory, classification_status=EXCLUDED.classification_status, product_name=EXCLUDED.product_name, description=EXCLUDED.description, " +
        "supplier_rate=EXCLUDED.supplier_rate, supplier_currency=EXCLUDED.supplier_currency, " +
        "min_quantity=EXCLUDED.min_quantity, max_quantity=EXCLUDED.max_quantity, " +
        "retail_rate_minor_per_1000=EXCLUDED.retail_rate_minor_per_1000, updated_at=NOW() RETURNING *",
        productValues
      );
    }
    return sendJson(res, 200, { ok: true, product: productRow(saved.rows[0]) });
  } catch (error) {
    console.error("[admin/smm-products]", JSON.stringify({
      code: error.code || "ADMIN_SMM_ERROR",
      message: String(error.message || "Database operation failed").slice(0, 240),
      column: error.column || null,
      dataType: error.dataType || null,
      constraint: error.constraint || null,
      where: error.where ? String(error.where).slice(0, 240) : null
    }));
    if (error.code === "23505") {
      return sendJson(res, 409, {
        ok: false,
        error: "This supplier service is already published. Edit its existing listing instead of creating a duplicate."
      });
    }
    const schemaMismatch = ["42P01", "42P10"].includes(error.code);
    if (error.code === "22P02") {
      return sendJson(res, 422, {
        ok: false,
        error: "A supplier catalogue entry contains data the product manager cannot save. Refresh the supplier catalogue and try again. The database migration is not the cause of this error."
      });
    }
    return sendJson(res, 503, {
      ok: false,
      error: schemaMismatch
        ? "A required product table or database index is missing. Verify the production database schema before publishing."
        : "The Social Media Boosters product manager is temporarily unavailable."
    });
  }
};

module.exports.cleanSupplierText = cleanSupplierText;
