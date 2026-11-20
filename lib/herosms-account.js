"use strict";

const BASE_URL = "https://partners-api.hero-sms.com/api/v1";

async function readAccount() {
  const key = String(process.env.HEROSMS_ACCOUNT_API_KEY || process.env.HEROSMS_API_KEY || "").trim();
  const retailApiConfigured = Boolean(String(process.env.HEROSMS_RETAIL_API_KEY || process.env.HEROSMS_API_KEY || "").trim());
  if (!key) return {
    configured: false, connected: false, accountKeyConfigured: false, mode: "account_api", retailApiConfigured,
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
      configured: true, connected: true, accountKeyConfigured: true, mode: "account_api", retailApiConfigured,
      message: "HeroSMS Account API connected. Retail catalogue and activation connectivity are checked separately.",
      balance: Number.isFinite(usd) ? usd : null,
      rubBalance: Number.isFinite(rub) ? rub : null,
      currency: "USD"
    };
  } catch (error) {
    console.error("[herosms/account]", JSON.stringify({ code: error.code || "REQUEST_FAILED", status: error.status || null }));
    return {
      configured: true, connected: false, accountKeyConfigured: true, mode: "account_api", retailApiConfigured,
      message: error.code === "BAD_KEY" ? "HeroSMS rejected the Account API key. The retail catalogue uses a separate credential check." :
        "HeroSMS Account API could not be reached. Check the key and account service status.",
      balance: null, currency: "USD"
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { readAccount };
