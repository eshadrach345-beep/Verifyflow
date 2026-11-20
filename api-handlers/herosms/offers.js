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
    if (selection.provider !== "herosms" || selection.productType !== "sms_otp" ||
        !Number.isSafeInteger(Number(selection.countryId)) || Number(selection.countryId) < 0) {
      return sendJson(res, 400, { ok: false, error: "Refresh the catalogue and choose a valid HeroSMS SMS product." });
    }
    // The signed catalogue token carries the supplier country ID. Avoid a
    // second legacy catalogue lookup; method availability is read from retail v1.
    const types = ["sms", "call", "voice"];
    const results = await Promise.all(types.map(async type => {
      try {
        const offer = await getVerificationOffer(selection.productId, Number(selection.countryId), type);
        return {
          type,
          label: type === "sms" ? "Text (SMS)" : type === "call" ? "Voice call" : "Text + Voice (All-in-One)",
          priceCents: retailPriceCents(offer.supplierPriceCents, "sms")
        };
      } catch (error) {
        if (error.code === "VERIFICATION_METHOD_UNAVAILABLE") return null;
        throw error;
      }
    }));
    const methods = results.filter(Boolean);
    if (!methods.length) return sendJson(res, 409, { ok: false, error: "No verification methods are currently available for this service." });
    return sendJson(res, 200, { ok: true, methods });
  } catch (error) {
    console.error("[herosms/offers]", error.code || error.message);
    return sendJson(res, 503, { ok: false, error: "HeroSMS verification options are temporarily unavailable. Please refresh and try again." });
  }
};
