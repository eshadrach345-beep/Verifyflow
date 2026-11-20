"use strict";

const herosms = require("./herosms");

async function readRetailStatus() {
  const configured = Boolean(String(
    process.env.HEROSMS_RETAIL_API_KEY || process.env.HEROSMS_API_KEY || ""
  ).trim());
  if (!configured) {
    return {
      configured: false,
      connected: false,
      countryCount: 0,
      message: "HeroSMS retail catalogue key is not configured."
    };
  }

  try {
    // A lightweight read-only call confirms the credential used by VerifyFlow's
    // customer-facing SMS and rental catalogue without placing an order.
    const response = await herosms.request("getCountries");
    const countries = response?.countries ?? response?.data ?? response;
    const countryCount = Array.isArray(countries)
      ? countries.length
      : countries && typeof countries === "object"
        ? Object.keys(countries).length
        : 0;
    if (countryCount < 1) {
      return {
        configured: true,
        connected: false,
        countryCount: 0,
        message: "HeroSMS accepted the request but returned no country catalogue."
      };
    }
    return {
      configured: true,
      connected: true,
      countryCount,
      message: "HeroSMS retail catalogue API connected and responding."
    };
  } catch (error) {
    console.error("[herosms/retail-status]", JSON.stringify({
      code: error.code || "REQUEST_FAILED",
      status: error.status || null
    }));
    return {
      configured: true,
      connected: false,
      countryCount: 0,
      message: error.code === "BAD_KEY" || error.code === "NO_KEY"
        ? "HeroSMS rejected the retail catalogue key."
        : "HeroSMS retail catalogue endpoint could not be reached."
    };
  }
}

module.exports = { readRetailStatus };
