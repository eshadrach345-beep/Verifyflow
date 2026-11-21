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

    // An unavailable method must not suppress the other methods that work.
    const definitions = [
      { type: "sms", label: "Text (SMS)" },
      { type: "call", label: "Voice call" },
      { type: "voice", label: "Voice + Text (All-in-One)" }
    ];
    const failures = [];
    const results = await Promise.all(definitions.map(async method => {
      try {
        const offer = await getVerificationOffer(
          selection.productId,
          Number(selection.countryId),
          method.type
        );
        const priceCents = retailPriceCents(offer.supplierPriceCents, "sms");
        if (!Number.isSafeInteger(priceCents) || priceCents <= 0) {
          failures.push({ type: method.type, code: "INVALID_OFFER_PRICE", status: 502 });
          return null;
        }
        return { type: method.type, label: method.label, priceCents };
      } catch (error) {
        const status = Number(error.status) || 0;
        const unavailable = error.code === "VERIFICATION_METHOD_UNAVAILABLE" ||
          [400, 404, 409, 422].includes(status);
        if (!unavailable) {
          failures.push({
            type: method.type,
            code: String(error.code || "HEROSMS_OFFER_FAILED").slice(0, 80),
            status: status || null
          });
        }
        return null;
      }
    }));

    const methods = results.filter(Boolean);
    if (failures.length) {
      console.warn("[herosms/offers] partial method lookup", JSON.stringify(failures));
    }
    if (!methods.length && failures.length) {
      return sendJson(res, 503, {
        ok: false,
        error: "HeroSMS verification options are temporarily unavailable. Please refresh and try again."
      });
    }
    if (!methods.length) {
      return sendJson(res, 409, {
        ok: false,
        error: "No verification methods are currently available for this service."
      });
    }
    return sendJson(res, 200, { ok: true, methods });
  } catch (error) {
    console.error("[herosms/offers]", error.code || error.message);
    return sendJson(res, 503, {
      ok: false,
      error: "HeroSMS verification options are temporarily unavailable. Please refresh and try again."
    });
  }
};
