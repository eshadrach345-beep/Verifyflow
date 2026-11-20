"use strict";

const { getPool } = require("../lib/auth");

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }
  try {
    const result = await getPool().query(
      "SELECT id, platform, subcategory, classification_status, product_name, description, min_quantity, max_quantity, retail_rate_minor_per_1000 " +
      "FROM vf_smm_products WHERE is_active = TRUE ORDER BY platform, product_name"
    );
    const items = result.rows.map(row => ({
      id: row.id,
      platform: row.platform,
      category: row.platform,
      subcategory: row.subcategory || "Other",
      classificationStatus: row.classification_status || "needs_review",
      name: row.product_name,
      description: row.description,
      min: Number(row.min_quantity),
      max: Number(row.max_quantity),
      pricePer1000Minor: Number(row.retail_rate_minor_per_1000)
    }));
    return sendJson(res, 200, { ok: true, items, count: items.length, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("[marketing-catalog]", error.code || error.message);
    return sendJson(res, 503, { ok: false, message: "Social media products are temporarily unavailable." });
  }
};
