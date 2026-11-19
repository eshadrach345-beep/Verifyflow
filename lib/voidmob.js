"use strict";

const BASE_URL = "https://dashboard.voidmob.com/api/v1";
const TIMEOUT_MS = 60000;

function createError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  if (status) error.status = status;
  return error;
}

function requirePositiveCents(value) {
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw createError("A valid supplier price cap is required.", "INVALID_PRICE_CAP");
  }
  return cents;
}

function buildPurchase(productType, input) {
  if (!input || typeof input !== "object") {
    throw createError("Supplier purchase details are missing.", "INVALID_PURCHASE");
  }
  const max_price_cents = requirePositiveCents(input.maxPriceCents);
  switch (productType) {
    case "sms_otp":
      if (!input.serviceId) throw createError("SMS service ID is required.", "INVALID_PURCHASE");
      return { path: "/verifications", body: { service_id: String(input.serviceId), country: input.country || "us", max_price_cents }, resultKey: "verification" };
    case "long_term_number": {
      if (!input.serviceId) throw createError("Rental service ID is required.", "INVALID_PURCHASE");
      const days = Number(input.durationDays);
      if (![3, 7, 14, 30].includes(days)) throw createError("Rental duration must be 3, 7, 14 or 30 days.", "INVALID_DURATION");
      return { path: "/rentals", body: { service_id: String(input.serviceId), duration: days + "D", max_price_cents }, resultKey: null };
    }
    case "dedicated_number":
      if (!/^[a-z]{2}$/i.test(String(input.country || ""))) throw createError("A two-letter country code is required.", "INVALID_PURCHASE");
      return { path: "/dedicated/numbers", body: { country: String(input.country).toLowerCase(), auto_renew: false, max_price_cents }, resultKey: null };
    case "esim":
      if (!input.productId) throw createError("eSIM product ID is required.", "INVALID_PURCHASE");
      return { path: "/esims", body: { product_id: String(input.productId), max_price_cents }, resultKey: "esim" };
    case "mobile_proxy":
      if (!input.planId) throw createError("Proxy plan ID is required.", "INVALID_PURCHASE");
      return { path: "/proxies", body: { plan_id: String(input.planId), max_price_cents }, resultKey: "proxy" };
    default:
      throw createError("This product type is not supported for automated fulfilment.", "UNSUPPORTED_PRODUCT");
  }
}

async function request(path, options = {}) {
  const key = process.env.VOIDMOB_API_KEY;
  if (!key) throw createError("VoidMob is not configured on the server.", "SUPPLIER_NOT_CONFIGURED");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || TIMEOUT_MS);
  try {
    const response = await fetch(BASE_URL + path, {
      method: options.method || "GET",
      headers: {
        Authorization: "Bearer " + key,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {})
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      const code = payload.error?.code || payload.code || "VOIDMOB_REQUEST_FAILED";
      throw createError("VoidMob request failed: " + code, code, response.status);
    }
    return payload.data ?? payload;
  } catch (error) {
    if (error.name === "AbortError") throw createError("VoidMob request timed out; reconcile before retrying.", "SUPPLIER_OUTCOME_UNKNOWN");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function purchase(productType, input, idempotencyKey) {
  if (process.env.VOIDMOB_FULFILMENT_ENABLED !== "true") {
    throw createError("Automated supplier purchases are disabled until VerifyFlow checkout and fulfilment are approved.", "FULFILMENT_DISABLED");
  }
  if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    throw createError("A stable order idempotency key is required.", "INVALID_IDEMPOTENCY_KEY");
  }
  const spec = buildPurchase(productType, input);
  const data = await request(spec.path, {
    method: "POST",
    body: spec.body,
    idempotencyKey
  });
  const item = spec.resultKey ? data[spec.resultKey] : data;
  if (!item || !item.id) {
    throw createError("VoidMob returned an unexpected purchase response; reconcile the supplier order before retrying.", "SUPPLIER_RESPONSE_UNCLEAR");
  }
  return {
    supplierOrderId: item.id,
    status: item.status || "processing",
    chargedPriceCents: Number.isSafeInteger(Number(item.charged_price_cents)) ? Number(item.charged_price_cents) : null,
    supplierData: item
  };
}

async function getOrder(productType, supplierOrderId) {
  if (!supplierOrderId || !/^[A-Za-z0-9_-]{4,100}$/.test(String(supplierOrderId))) {
    throw createError("A valid supplier order ID is required.", "INVALID_SUPPLIER_ORDER_ID");
  }
  const paths = {
    sms_otp: "/verifications/",
    long_term_number: "/rentals/",
    dedicated_number: "/dedicated/numbers/",
    esim: "/esims/",
    mobile_proxy: "/proxies/"
  };
  const prefix = paths[productType];
  if (!prefix) throw createError("Unsupported product type.", "UNSUPPORTED_PRODUCT");
  return request(prefix + encodeURIComponent(supplierOrderId));
}

module.exports = { buildPurchase, purchase, getOrder };
