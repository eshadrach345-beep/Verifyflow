"use strict";

const PROVIDERS = {
  peakerr: { label: "Peakerr", url: "https://peakerr.com/api/v2", keyEnv: "PEAKERR_API_KEY" },
  justanotherpanel: { label: "JustAnotherPanel", url: "https://justanotherpanel.com/api/v2", keyEnv: "JUSTANOTHERPANEL_API_KEY" }
};

function currencyCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}
function numericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Return every service the supplier makes available. The owner chooses which
// services become storefront products from the protected Admin screen.
function serviceIsEligible(service) {
  return Boolean(service && (service.service ?? service.id) !== undefined &&
    String(service.service ?? service.id).trim() &&
    String(service.name || "").trim());
}
async function panelRequest(provider, key, action) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const body = new URLSearchParams({ key, action });
    const response = await fetch(provider.url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body, signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.error) {
      const error = new Error("Supplier API request failed");
      error.code = response.status === 401 ? "INVALID_SUPPLIER_KEY" : "SUPPLIER_API_ERROR";
      error.httpStatus = response.status;
      throw error;
    }
    return payload;
  } finally { clearTimeout(timeout); }
}
async function readProvider(providerKey) {
  const provider = PROVIDERS[providerKey];
  if (!provider) throw new Error("Unknown supplier provider.");
  const key = process.env[provider.keyEnv];
  if (!key) return {
    provider: providerKey, label: provider.label, connected: false,
    message: "API key not configured.", balance: null, currency: null,
    eligibleServices: [], eligibleCount: 0, totalServices: null
  };
  try {
    const [balanceData, servicesData] = await Promise.all([
      panelRequest(provider, key, "balance"), panelRequest(provider, key, "services")
    ]);
    const services = Array.isArray(servicesData) ? servicesData :
      Array.isArray(servicesData?.services) ? servicesData.services : [];
    const walletBalance = numericValue(balanceData?.balance);
    const walletCurrency = currencyCode(balanceData?.currency);
    const allServices = services.filter(serviceIsEligible).map(service => {
      const min = numericValue(service.min), max = numericValue(service.max);
      const rate = numericValue(service.rate);
      return {
        id: String(service.service ?? service.id),
        name: String(service.name || "Supplier service").slice(0, 180),
        category: String(service.category || service.type || "Other").slice(0, 100),
        type: String(service.type || "Default").slice(0, 80),
        description: String(service.description || "").slice(0, 500),
        supplierRateReported: rate === null ? null : String(service.rate).slice(0, 40),
        supplierCurrency: walletCurrency,
        rateUnit: "per_1000",
        min: min === null ? 1 : min,
        max: max === null ? 1 : max,
        refill: Boolean(service.refill),
        cancel: Boolean(service.cancel)
      };
    }).filter(service => service.id && Number.isSafeInteger(service.min) &&
      Number.isSafeInteger(service.max) && service.min > 0 && service.max >= service.min);
    return {
      provider: providerKey, label: provider.label, connected: true,
      message: allServices.length ? null :
        "Supplier API connected, but it returned no usable catalogue entries.",
      balance: walletBalance, currency: walletCurrency,
      eligibleServices: allServices, eligibleCount: allServices.length, totalServices: services.length
    };
  } catch (error) {
    console.error("[smm-provider]", providerKey, error.code || error.message);
    return {
      provider: providerKey, label: provider.label, connected: false,
      message: error.code === "INVALID_SUPPLIER_KEY" ? "Supplier rejected the API key." : "Supplier API could not be reached.",
      balance: null, currency: null, eligibleServices: [], eligibleCount: 0, totalServices: null
    };
  }
}
module.exports = { readProvider, serviceIsEligible, currencyCode, numericValue, PROVIDERS, panelRequest };
