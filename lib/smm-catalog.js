"use strict";

const PROVIDERS = {
  peakerr: {
    label: "Peakerr",
    url: "https://peakerr.com/api/v2",
    keyEnv: "PEAKERR_API_KEY"
  },
  justanotherpanel: {
    label: "JustAnotherPanel",
    url: "https://justanotherpanel.com/api/v2",
    keyEnv: "JUSTANOTHERPANEL_API_KEY"
  }
};

// Only services that are clearly operational/creative marketing work are eligible.
// Engagement inflation, purchased traffic, reviews, backlinks and metric manipulation
// are deliberately excluded from the customer-facing catalogue.
const SAFE_SERVICE_TERMS = [
  "content creation", "video editing", "graphic design", "creative design",
  "social media ads", "advertising campaign", "ad campaign management",
  "analytics report", "social media audit", "seo audit", "marketing consultation",
  "content strategy", "brand strategy"
];
const BLOCKED_SERVICE_TERMS = [
  "follower", "subscriber", "like", "view", "watch time", "member",
  "reaction", "comment", "review", "rating", "traffic", "impression",
  "share", "save", "vote", "backlink", "boost", "engagement"
];

function serviceIsEligible(service) {
  const haystack = [service?.name, service?.category, service?.description, service?.type]
    .filter(value => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (!haystack || BLOCKED_SERVICE_TERMS.some(term => haystack.includes(term))) return false;
  return SAFE_SERVICE_TERMS.some(term => haystack.includes(term));
}

function retailRate(rate, markupPercent, minimumMarkupCents) {
  const cost = Number(rate);
  if (!Number.isFinite(cost) || cost <= 0) return null;
  const costCents = Math.round(cost * 100);
  const marked = Math.ceil(costCents * (1 + markupPercent / 100));
  return Math.max(marked, costCents + minimumMarkupCents);
}

async function panelRequest(provider, key, action) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const body = new URLSearchParams({ key, action });
    const response = await fetch(provider.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.error) {
      const error = new Error("Supplier API request failed");
      error.code = response.status === 401 ? "INVALID_SUPPLIER_KEY" : "SUPPLIER_API_ERROR";
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function readProvider(providerKey) {
  const provider = PROVIDERS[providerKey];
  const key = process.env[provider.keyEnv];
  if (!key) {
    return {
      provider: providerKey, label: provider.label, connected: false,
      message: "API key not configured.", balance: null, currency: "USD",
      eligibleServices: [], eligibleCount: 0, totalServices: null
    };
  }

  try {
    const [balanceData, servicesData] = await Promise.all([
      panelRequest(provider, key, "balance"),
      panelRequest(provider, key, "services")
    ]);
    const services = Array.isArray(servicesData) ? servicesData :
      Array.isArray(servicesData?.services) ? servicesData.services : [];
    const markupPercent = Number(process.env.VERIFYFLOW_SMM_MARKUP_PERCENT || 40);
    const minimumMarkupCents = Number(process.env.VERIFYFLOW_SMM_MIN_MARKUP_CENTS || 25);
    const eligibleServices = services.filter(serviceIsEligible).map(service => ({
      id: String(service.service ?? service.id ?? ""),
      name: String(service.name || "Marketing service"),
      category: String(service.category || service.type || "Marketing"),
      supplierRatePerThousand: Number(service.rate),
      retailRatePerThousandCents: retailRate(service.rate, markupPercent, minimumMarkupCents),
      min: Number(service.min || 1),
      max: Number(service.max || 1),
      refill: Boolean(service.refill),
      cancel: Boolean(service.cancel)
    })).filter(service => service.id && service.retailRatePerThousandCents != null &&
      Number.isFinite(service.min) && Number.isFinite(service.max) && service.max >= service.min);

    return {
      provider: providerKey, label: provider.label, connected: true,
      message: null,
      balance: Number(balanceData?.balance),
      currency: String(balanceData?.currency || "USD").toUpperCase(),
      eligibleServices,
      eligibleCount: eligibleServices.length,
      totalServices: services.length
    };
  } catch (error) {
    console.error("[smm-provider]", providerKey, error.code || error.message);
    return {
      provider: providerKey, label: provider.label, connected: false,
      message: error.code === "INVALID_SUPPLIER_KEY" ? "Supplier rejected the API key." :
        "Supplier API could not be reached.",
      balance: null, currency: "USD", eligibleServices: [],
      eligibleCount: 0, totalServices: null
    };
  }
}

module.exports = { readProvider };
