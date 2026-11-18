const VOIDMOB_BASE = "https://dashboard.voidmob.com/api/v1";
const HERO_BASE = "https://partners-api.hero-sms.com";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

async function supplierGet(base, path, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(base + path, {
      method: "GET",
      headers,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error("Supplier request failed");
      error.status = response.status;
      error.code = payload.code || payload.error || "SUPPLIER_ERROR";
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function safeRead(label, task, map) {
  try {
    const payload = await task();
    return { ok: true, items: map(payload), error: null };
  } catch (error) {
    console.error("[catalog] " + label + ":", error.code || error.message);
    return {
      ok: false,
      items: [],
      error: error.status === 401 ? "Supplier API key rejected" :
        error.status === 429 ? "Supplier rate limit reached; retry shortly" :
        error.name === "AbortError" ? "Supplier request timed out" :
        "Supplier catalogue temporarily unavailable"
    };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }
  if (!process.env.VOIDMOB_API_KEY) {
    return json(res, 503, {
      ok: false,
      error: "VoidMob connection is not configured",
      providers: { voidmob: false, herosms: Boolean(process.env.HEROSMS_API_KEY) }
    });
  }

  const headers = {
    Authorization: "Bearer " + process.env.VOIDMOB_API_KEY,
    Accept: "application/json"
  };
  const tasks = [
    safeRead("SMS services", () => supplierGet(VOIDMOB_BASE, "/v1/services", headers), p =>
      (p.services || []).map(x => ({
        id: x.id, name: x.name, available: x.available !== false,
        verification: true, longTerm: true
      }))
    ),
    safeRead("eSIM plans", () => supplierGet(VOIDMOB_BASE, "/v1/esim_products?limit=20", headers), p =>
      (p.products || []).map(x => ({
        id: x.id, title: x.title, countries: x.countries || [],
        dataGb: x.data_limit_gb, unlimited: Boolean(x.data_unlimited),
        validityDays: x.validity_days,
        features: x.features || {}
      }))
    ),
    safeRead("Proxy plans", () => supplierGet(VOIDMOB_BASE, "/v1/proxy_plans?type=all", headers), p =>
      (p.plans || []).map(x => ({
        id: x.id, name: x.name, type: x.type,
        country: x.country_name || x.country || "Global",
        dataGb: x.data_gb, durationDays: x.duration_days,
        available: x.available !== false
      }))
    ),
    safeRead("Dedicated numbers", () => supplierGet(VOIDMOB_BASE, "/v1/dedicated/countries", headers), p =>
      (Array.isArray(p) ? p : []).map(x => ({
        country: x.country, name: x.name, inStock: Boolean(x.in_stock)
      }))
    )
  ];

  const [sms, esim, proxies, dedicated] = await Promise.all(tasks);
  const sections = { sms, esim, proxies, dedicated };
  const availableSections = Object.values(sections).filter(x => x.ok).length;
  return json(res, availableSections ? 200 : 502, {
    ok: availableSections > 0,
    source: "VoidMob",
    updatedAt: new Date().toISOString(),
    sections,
    summary: {
      sms: sms.items.length,
      esim: esim.items.length,
      proxies: proxies.items.length,
      dedicatedCountries: dedicated.items.length
    }
  });
};
