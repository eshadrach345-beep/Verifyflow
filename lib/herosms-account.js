"use strict";

const { getBalance } = require("./herosms");

async function readAccount() {
  if (!process.env.HEROSMS_API_KEY) {
    return { configured: false, connected: false, mode: "retail_api", message: "HeroSMS API key is not configured.", balance: null, currency: "USD" };
  }
  try {
    const account = await getBalance();
    return {
      configured: true,
      connected: true,
      mode: "retail_api",
      message: "HeroSMS retail API verified. Country, service, price and stock catalogue endpoints are available.",
      balance: account.balance,
      currency: account.currency
    };
  } catch (error) {
    console.error("[herosms/account]", JSON.stringify({ code: error.code || "REQUEST_FAILED", status: error.status || null }));
    return {
      configured: true,
      connected: false,
      mode: "retail_api",
      message: error.code === "BAD_KEY" || error.code === "NO_KEY" || error.status === 401
        ? "HeroSMS rejected the retail API key."
        : "HeroSMS retail API could not be reached. Check the API key and supplier service status.",
      balance: null,
      currency: "USD"
    };
  }
}

module.exports = { readAccount };
