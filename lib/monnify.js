const { createHmac, timingSafeEqual } = require("node:crypto");

const SANDBOX_URL = "https://sandbox.monnify.com";
const LIVE_URL = "https://api.monnify.com";
let cachedToken = null;

function getMonnifyConfig() {
  const environment = String(process.env.MONNIFY_ENVIRONMENT || "SANDBOX").trim().toUpperCase();
  if (environment !== "SANDBOX" && environment !== "LIVE") {
    const error = new Error("Monnify environment must be SANDBOX or LIVE.");
    error.code = "MONNIFY_ENVIRONMENT_INVALID";
    throw error;
  }
  if (environment === "LIVE" &&
      (process.env.MONNIFY_LIVE_ENABLED !== "true" ||
       process.env.MONNIFY_PRODUCT_APPROVAL_CONFIRMED !== "true")) {
    const error = new Error("Live Monnify payments are locked until approval and launch checks are complete.");
    error.code = "MONNIFY_LIVE_LOCKED";
    throw error;
  }

  const apiKey = String(process.env.MONNIFY_API_KEY || "").trim();
  const secretKey = String(process.env.MONNIFY_SECRET_KEY || "").trim();
  const contractCode = String(process.env.MONNIFY_CONTRACT_CODE || "").trim();
  if (!apiKey || !secretKey || !contractCode) {
    const error = new Error("Monnify credentials are not fully configured.");
    error.code = "MONNIFY_CONFIG_MISSING";
    throw error;
  }
  return {
    environment, apiKey, secretKey, contractCode,
    baseUrl: environment === "LIVE" ? LIVE_URL : SANDBOX_URL
  };
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.requestSuccessful === false) {
      const error = new Error("Monnify request was not successful.");
      error.code = String(payload.responseCode || response.status || "MONNIFY_REQUEST_FAILED");
      error.httpStatus = response.status;
      error.providerCode = String(payload.responseCode || "").slice(0, 80) || undefined;
      error.providerMessage = String(payload.responseMessage || payload.message || "No provider message returned").slice(0, 240);
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function getAccessToken(config = getMonnifyConfig()) {
  const now = Date.now();
  if (cachedToken &&
      cachedToken.apiKey === config.apiKey &&
      cachedToken.environment === config.environment &&
      cachedToken.expiresAt > now + 30000) {
    return cachedToken.value;
  }

  const credentials = Buffer.from(config.apiKey + ":" + config.secretKey, "utf8").toString("base64");
  const payload = await requestJson(config.baseUrl + "/api/v1/auth/login", {
    method: "POST",
    headers: { Authorization: "Basic " + credentials, Accept: "application/json" }
  });
  const token = payload.responseBody && payload.responseBody.accessToken;
  if (!token || typeof token !== "string") {
    const error = new Error("Monnify did not return an access token.");
    error.code = "MONNIFY_AUTH_FAILED";
    throw error;
  }
  const expiresIn = Number(payload.responseBody.expiresIn || 3600);
  cachedToken = {
    apiKey: config.apiKey,
    environment: config.environment,
    value: token,
    expiresAt: now + Math.max(60, expiresIn) * 1000
  };
  return token;
}

async function monnifyRequest(path, options = {}) {
  const config = getMonnifyConfig();
  const token = await getAccessToken(config);
  return requestJson(config.baseUrl + path, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
      Authorization: "Bearer " + token
    }
  });
}

async function initializeTransaction(details) {
  return monnifyRequest("/api/v1/merchant/transactions/init-transaction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(details)
  });
}

async function getTransactionByPaymentReference(paymentReference) {
  const path = "/api/v2/merchant/transactions/query?paymentReference=" +
    encodeURIComponent(paymentReference);
  return monnifyRequest(path, { method: "GET" });
}

function parseMinorUnits(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = String(value).trim().match(/^(\d{1,12})(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number((match[2] || "").padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(major)) return null;
  const total = major * 100 + minor;
  return Number.isSafeInteger(total) ? total : null;
}

function verifyWebhookSignature(rawBody, signature, secretKey) {
  if (!rawBody || !signature || !secretKey) return false;
  const expected = createHmac("sha512", secretKey).update(rawBody).digest("hex");
  const supplied = String(signature).trim().toLowerCase();
  if (!/^[a-f0-9]{128}$/.test(supplied)) return false;
  const expectedBuffer = Buffer.from(expected, "hex");
  const suppliedBuffer = Buffer.from(supplied, "hex");
  return expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer);
}

module.exports = {
  getMonnifyConfig, getAccessToken, initializeTransaction,
  getTransactionByPaymentReference, parseMinorUnits, verifyWebhookSignature
};
