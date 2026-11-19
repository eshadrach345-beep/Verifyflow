"use strict";

const BASE_URL = "https://partners-api.hero-sms.com/api/v1";

async function readAccount() {
  const key = process.env.HEROSMS_API_KEY;
  if (!key) return {
    configured: false, connected: false, mode: "account_api", retailApiConfigured: Boolean(process.env.HEROSMS_RETAIL_API_KEY),
    message: "HeroSMS Account API key is not configured.", balance: null, currency: "USD"
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(BASE_URL + "/balance", {
      method: "GET",
      headers: { apikey: key, Accept: "application/json" },
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.status === "error") {
      const error = new Error("HeroSMS Account API request failed.");
      error.code = response.status === 401 ? "BAD_KEY" : "ACCOUNT_API_ERROR";
      error.status = response.status;
      throw error;
    }
    const values = data.data || data;
    const usd = Number(values.usd ?? values.balance_usd);
    const rub = Number(values.rub ?? values.balance_rub);
    return {
      configured: true, connected: true, mode: "account_api", retailApiConfigured: Boolean(process.env.HEROSMS_RETAIL_API_KEY),
      message: "HeroSMS Account API connected. This key manages account data; retail number purchasing uses a separate API credential.",
      balance: Number.isFinite(usd) ? usd : null,
      rubBalance: Number.isFinite(rub) ? rub : null,
      currency: "USD"
    };
  } catch (error) {
    console.error("[herosms/account]", JSON.stringify({ code: error.code || "REQUEST_FAILED", status: error.status || null }));
    return {
      configured: true, connected: false, mode: "account_api", retailApiConfigured: Boolean(process.env.HEROSMS_RETAIL_API_KEY),
      message: error.code === "BAD_KEY" ? "HeroSMS rejected the Account API key." :
        "HeroSMS Account API could not be reached. Check the key and account service status.",
      balance: null, currency: "USD"
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { readAccount };
