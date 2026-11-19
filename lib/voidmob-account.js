"use strict";
async function readAccount() {
  const key = process.env.VOIDMOB_API_KEY;
  if (!key) return { configured: false, connected: false, message: "VoidMob API key is not configured.", balanceCents: null, currency: "USD" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch("https://dashboard.voidmob.com/api/v1/me", {
      method: "GET",
      headers: { Authorization: "Bearer " + key, Accept: "application/json" },
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.success === false) {
      const error = new Error("VoidMob account check failed.");
      error.status = response.status;
      error.code = payload?.error?.code || payload?.code || (response.status === 401 ? "UNAUTHORIZED" : "ACCOUNT_API_ERROR");
      error.requestId = payload?.error?.request_id || payload?.request_id || response.headers.get("x-request-id") || null;
      throw error;
    }
    const account = payload.data ?? payload;
    const balance = account.balance || {};
    const amount = Number(balance.amount_cents);
    if (!account.id || !Number.isSafeInteger(amount)) throw Object.assign(new Error("Unexpected account response."), { code: "INVALID_ACCOUNT_RESPONSE" });
    return {
      configured: true, connected: true, accountId: String(account.id),
      balanceCents: amount, currency: balance.currency === "USD" ? "USD" : null,
      balanceFormatted: typeof balance.formatted === "string" ? balance.formatted.slice(0, 40) : null,
      message: "Read-only account and API-key check passed."
    };
  } catch (error) {
    console.error("[voidmob/account]", JSON.stringify({ status: error.status || null, code: error.code || "REQUEST_FAILED", requestId: error.requestId || null }));
    return {
      configured: true, connected: false, balanceCents: null, currency: "USD",
      message: error.status === 401 || error.code === "UNAUTHORIZED"
        ? "VoidMob rejected the API key. Check that it is a current vmk_live_ key."
        : "VoidMob account API could not be reached; see server diagnostics."
    };
  } finally { clearTimeout(timer); }
}
module.exports = { readAccount };
