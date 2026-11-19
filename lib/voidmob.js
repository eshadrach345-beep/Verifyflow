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

const PRICE_RULES = {
  sms_otp: { percent: 55, minimumMarkupCents: 5 },
  long_term_number: { percent: 40, minimumMarkupCents: 100 },
  esim: { percent: 35, minimumMarkupCents: 100 },
  mobile_proxy: { percent: 35, minimumMarkupCents: 100 },
  dedicated_number: { percent: 35, minimumMarkupCents: 200 }
};

function retailPriceCents(supplierPrice, productType) {
  const cost = Number(supplierPrice);
  if (!Number.isSafeInteger(cost) || cost <= 0) {
    throw createError("Supplier did not return a valid price.", "SUPPLIER_PRICE_INVALID");
  }
  const rule = PRICE_RULES[productType];
  const category = {
    sms_otp: "SMS",
    long_term_number: "RENTALS",
    esim: "ESIM",
    mobile_proxy: "PROXIES",
    dedicated_number: "DEDICATED"
  }[productType];
  const percentName = "VERIFYFLOW_" + category + "_MARKUP_PERCENT";
  const minimumName = "VERIFYFLOW_" + category + "_MIN_MARKUP_CENTS";
  const configuredPercent = Number(process.env[percentName]);
  const configuredMinimum = Number(process.env[minimumName]);
  const percent = Number.isFinite(configuredPercent) && configuredPercent >= 0 && configuredPercent <= 5000
    ? configuredPercent : rule.percent;
  const minimum = Number.isSafeInteger(configuredMinimum) && configuredMinimum >= 0 && configuredMinimum <= 10000000
    ? configuredMinimum : rule.minimumMarkupCents;
  return Math.max(Math.ceil(cost * (1 + percent / 100) - 1e-9), cost + minimum);
}

function unwrapItem(data, key) {
  return key && data && data[key] ? data[key] : data;
}

async function quoteProduct(productType, input) {
  if (!input || typeof input !== "object") {
    throw createError("Product selection is missing.", "INVALID_PRODUCT");
  }
  let item;
  let supplierPriceCents;
  let supplierInput;

  if (productType === "sms_otp" || productType === "long_term_number") {
    if (String(input.country || "us").toLowerCase() !== "us") {
      throw createError("VoidMob SMS verifications and long-term rentals are currently available only for US numbers.", "COUNTRY_UNAVAILABLE");
    }
    const data = await request("/services?country=us");
    const rows = Array.isArray(data.services) ? data.services : [];
    item = rows.find(row => String(row.id) === String(input.productId));
    if (!item || item.available !== true) {
      throw createError("This supplier service is not currently available.", "PRODUCT_UNAVAILABLE", 409);
    }
    if (productType === "sms_otp") {
      supplierPriceCents = item.quoted_price_cents;
      supplierInput = { serviceId: item.id, country: "us", maxPriceCents: Number(item.quoted_price_cents) };
    } else {
      const days = Number(input.durationDays);
      if (![3, 7, 14, 30].includes(days)) throw createError("Choose a 3, 7, 14 or 30 day rental.", "INVALID_DURATION");
      const priceKey = "ltr_" + days + "d_price_cents";
      supplierPriceCents = item[priceKey];
      supplierInput = { serviceId: item.id, durationDays: days, maxPriceCents: Number(supplierPriceCents) };
    }
  } else if (productType === "dedicated_number") {
    const country = String(input.country || "").toLowerCase();
    if (!/^[a-z]{2}$/.test(country)) throw createError("Choose a valid dedicated-number country.", "INVALID_COUNTRY");
    const data = await request("/dedicated/countries");
    const rows = Array.isArray(data) ? data : (Array.isArray(data.countries) ? data.countries : []);
    item = rows.find(row => String(row.country || "").toLowerCase() === country);
    if (!item || item.in_stock !== true) throw createError("Dedicated numbers are not currently available in that country.", "PRODUCT_UNAVAILABLE", 409);
    supplierPriceCents = item.quoted_price_cents;
    supplierInput = { country, maxPriceCents: Number(supplierPriceCents) };
  } else if (productType === "esim") {
    const id = String(input.productId || "");
    if (!/^prod_[A-Za-z0-9_-]+$/.test(id)) throw createError("Choose a valid eSIM plan.", "INVALID_PRODUCT");
    const data = await request("/esim_products/" + encodeURIComponent(id));
    item = unwrapItem(data, "product");
    if (!item || String(item.id) !== id) throw createError("The eSIM plan could not be found.", "PRODUCT_NOT_FOUND", 404);
    supplierPriceCents = item.price_cents;
    supplierInput = { productId: id, maxPriceCents: Number(supplierPriceCents) };
  } else if (productType === "mobile_proxy") {
    const id = String(input.productId || "");
    if (!/^plan_[A-Za-z0-9_-]+$/.test(id)) throw createError("Choose a valid mobile proxy plan.", "INVALID_PRODUCT");
    const data = await request("/proxy_plans/" + encodeURIComponent(id));
    item = unwrapItem(data, "plan");
    if (!item || String(item.id) !== id || item.available === false) {
      throw createError("This mobile proxy plan is not currently available.", "PRODUCT_UNAVAILABLE", 409);
    }
    supplierPriceCents = item.quoted_price_cents;
    supplierInput = { planId: id, maxPriceCents: Number(supplierPriceCents) };
  } else {
    throw createError("This product type is not available for checkout.", "UNSUPPORTED_PRODUCT");
  }

  const salePriceCents = retailPriceCents(supplierPriceCents, productType);
  if (productType === "long_term_number") supplierInput.maxPriceCents = Number(supplierPriceCents);
  const productName = item.full_title || item.title || item.name ||
    (productType === "dedicated_number" ? item.name || item.country : "VerifyFlow service");
  return {
    productType,
    productName: String(productName || "VerifyFlow service").slice(0, 180),
    supplierPriceCents: Number(supplierPriceCents),
    salePriceCents,
    currency: "USD",
    supplierInput,
    productSnapshot: {
      id: item.id || item.country,
      name: String(productName || "VerifyFlow service"),
      type: productType,
      country: item.country || (productType === "sms_otp" || productType === "long_term_number" ? "us" : null),
      supplierPriceCents: Number(supplierPriceCents),
      retailPriceCents: salePriceCents,
      currency: "USD",
      durationDays: productType === "long_term_number" ? Number(input.durationDays) : null,
      quotedAt: new Date().toISOString()
    }
  };
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
  if (process.env.VOIDMOB_FULFILMENT_ENABLED !== "true" || process.env.VOIDMOB_AUTOBUY_CONFIRMED !== "true") {
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
  const data = await request(prefix + encodeURIComponent(supplierOrderId));
  return data.verification || data.rental || data.number || data.esim || data.proxy || data;
}

module.exports = { buildPurchase, quoteProduct, purchase, getOrder, retailPriceCents };
