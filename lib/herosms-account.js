"use strict";

const BASE_URL = "https://partners-api.hero-sms.com/api/v1";
const RETAIL_URL = "https://hero-sms.com/stubs/handler_api.php";

async function readLegacyRetailBalance(key, retailApiConfigured) {
  if (!key || !retailApiConfigured) return null;
  const url = new URL(RETAIL_URL);
  url.searchParams.set("api_key", key);
  url.searchParams.set("action", "getBalance");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json, text/plain" },
      signal: controller.signal
    });
    const raw = (await response.text()).trim();
    if (!response.ok) return null;
    const match = raw.match(/^ACCESS_BALANCE:([0-9]+(?:\\.[0-9]+)?)$/);
    if (match) {
      const balance = Number(match[1]);
      if (Number.isFinite(balance)) return {
        configured: true, connected: true, accountKeyConfigured: false,
        mode: "retail_compatibility_api", retailApiConfigured,
        message: "HeroSMS balance connected through the retail compatibility API.",
        balance, currency: "USD"
      };
    }
    let data;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    const values = data?.data || data;
    const balance = Number(values?.usd ?? values?.balance_usd ?? values?.balance);
    if (data?.status !== "error" && Number.isFinite(balance) && balance >= 0) return {
      configured: true, connected: true, accountKeyConfigured: false,
      mode: "retail_compatibility_api", retailApiConfigured,
      message: "HeroSMS balance connected through the retail compatibility API.",
      balance, currency: "USD"
    };
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

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
      if (response.status === 401) {
        const legacy = await readLegacyRetailBalance(
          String(process.env.HEROSMS_RETAIL_API_KEY || process.env.HEROSMS_API_KEY || "").trim(),
          retailApiConfigured
        );
        if (legacy) return legacy;
      }
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
