"use strict";

const { PROVIDERS } = require("./smm-catalog");

async function request(providerKey, values) {
  const provider = PROVIDERS[providerKey];
  if (!provider) {
    const error = new Error("Unknown social marketing supplier.");
    error.code = "SMM_PROVIDER_UNSUPPORTED";
    throw error;
  }
  const key = String(process.env[provider.keyEnv] || "").trim();
  if (!key) {
    const error = new Error("Supplier API key is not configured.");
    error.code = "SUPPLIER_NOT_CONFIGURED";
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const body = new URLSearchParams({ key, ...values });
    let response;
    try {
      response = await fetch(provider.url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body, signal: controller.signal
      });
    } catch (cause) {
      const error = new Error("Supplier did not confirm the order response.");
      error.code = "SUPPLIER_OUTCOME_UNKNOWN";
      error.cause = cause;
      throw error;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.error) {
      const error = new Error("Supplier rejected the request.");
      error.code = response.status === 401 ? "INVALID_SUPPLIER_KEY" : "SUPPLIER_API_ERROR";
      error.httpStatus = response.status;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function placeSmmOrder(provider, supplierInput) {
  const service = String(supplierInput?.serviceId || "");
  const link = String(supplierInput?.link || "");
  const quantity = Number(supplierInput?.quantity);
  if (!service || !Number.isSafeInteger(quantity) || quantity < 1 ||
      !/^https?:\/\//i.test(link)) {
    const error = new Error("The saved social service order details are invalid.");
    error.code = "SMM_ORDER_INPUT_INVALID";
    throw error;
  }
  const payload = await request(provider, {
    action: "add", service, link, quantity: String(quantity)
  });
  const orderId = payload.order ?? payload.order_id ?? payload.id;
  if (orderId === undefined || orderId === null || String(orderId).trim() === "") {
    const error = new Error("Supplier response did not include an order reference.");
    error.code = "SUPPLIER_RESPONSE_UNCLEAR";
    throw error;
  }
  return {
    supplierOrderId: String(orderId),
    status: String(payload.status || "Pending"),
    supplierData: { order: String(orderId), status: String(payload.status || "Pending") }
  };
}

async function getSmmOrderStatus(provider, supplierOrderId) {
  const payload = await request(provider, {
    action: "status", order: String(supplierOrderId)
  });
  return {
    status: String(payload.status || "Unknown"),
    remains: payload.remains ?? null,
    startCount: payload.start_count ?? null,
    charge: payload.charge ?? null,
    currency: payload.currency ?? null
  };
}
module.exports = { placeSmmOrder, getSmmOrderStatus };
