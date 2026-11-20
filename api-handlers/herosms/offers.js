"use strict";
const { sendJson } = require("../../lib/auth");
const { openCatalogProductToken } = require("../../lib/catalog-token");
const { getVerificationOffer, retailPriceCents } = require("../../lib/herosms");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }
  try {
    const selection = openCatalogProductToken(String(req.query?.productId || ""));
    if (selection.provider !== "herosms" || selection.productType !== "sms_otp") {
      return sendJson(res, 400, { ok: false, error: "Choose a valid HeroSMS SMS product." });
    }
    const catalog = await require("../../lib/herosms").getCatalog(selection.country);
    const item = catalog.items.find(row => String(row.id) === String(selection.productId));
    if (!item) return sendJson(res, 404, { ok: false, error: "This service is no longer available." });
    const types = ["sms", "call", "voice"];
    const results = await Promise.all(types.map(async type => {
      try {
        const offer = await getVerificationOffer(item.id, item.countryId, type);
        return { type, label: type === "sms" ? "SMS" : type === "call" ? "Incoming call" : "Voice", priceCents: retailPriceCents(offer.supplierPriceCents, "sms") };
      } catch (error) {
        if (error.code === "VERIFICATION_METHOD_UNAVAILABLE") return null;
        throw error;
      }
    }));
    const methods = results.filter(Boolean);
    if (!methods.length) return sendJson(res, 409, { ok: false, error: "No verification methods are currently available." });
    return sendJson(res, 200, { ok: true, methods });
  } catch (error) {
    console.error("[herosms/offers]", error.code || error.message);
    return sendJson(res, 503, { ok: false, error: "HeroSMS verification options are temporarily unavailable." });
  }
};
