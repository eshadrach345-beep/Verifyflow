"use strict";

async function readAccount() {
  const key = process.env.HEROSMS_API_KEY;
  if (!key) {
    return { configured: false, connected: false, message: "HeroSMS Account API key is not configured.", rub: null, usd: null };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch("https://partners-api.hero-sms.com/api/v1/balance", {
      method: "GET",
      headers: { apikey: key, Accept: "application/json" },
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.status !== "success" || !payload.data) {
      const error = new Error("HeroSMS Account API check failed.");
      error.status = response.status;
      error.code = payload?.error || (response.status === 401 ? "UNAUTHORIZED" : "ACCOUNT_API_ERROR");
      throw error;
    }
    const rub = Number(payload.data.rub);
    const usd = Number(payload.data.usd);
    return {
      configured: true,
      connected: true,
      mode: "account_balance_only",
      message: "Account API verified. This API does not provide an OTP supplier catalogue.",
      rub: Number.isFinite(rub) ? rub : null,
      usd: Number.isFinite(usd) ? usd : null
    };
  } catch (error) {
    console.error("[herosms/account]", JSON.stringify({ status: error.status || null, code: error.code || "REQUEST_FAILED" }));
    return {
      configured: true,
      connected: false,
      mode: "account_balance_only",
      message: error.code === "UNAUTHORIZED" || error.status === 401
        ? "HeroSMS rejected the Account API key."
        : "HeroSMS Account API could not be reached.",
      rub: null,
      usd: null
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { readAccount };
