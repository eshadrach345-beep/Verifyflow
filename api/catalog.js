const VOIDMOB_BASE = "https://dashboard.voidmob.com/api/v1";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

async function supplierGet(path, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(VOIDMOB_BASE + path, {
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
      error: error.status === 401 ? "VoidMob API key was rejected" :
        error.status === 429 ? "Supplier rate limit reached; retry shortly" :
        error.name === "AbortError" ? "Supplier catalogue request timed out" :
        "Supplier catalogue temporarily unavailable"
    };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  // HeroSMS is the selected primary OTP supplier. The Account API key is not
  // assumed to be a customer-facing reseller purchase/catalogue credential.
  // Keep SMS unavailable until HeroSMS confirms the correct partner flow.
  const sms = {
    ok: false,
    items: [],
    provider: "HeroSMS",
    error: process.env.HEROSMS_API_KEY
      ? "HeroSMS credentials are present. The reseller catalogue and purchase API still need supplier confirmation."
      : "HeroSMS connection is not configured."
  };

  if (!process.env.VOIDMOB_API_KEY) {
    return json(res, 200, {
      ok: false,
      updatedAt: new Date().toISOString(),
      providers: {
        herosms: Boolean(process.env.HEROSMS_API_KEY),
        voidmob: false
      },
      sections: {
        sms,
        esim: { ok: false, items: [], error: "VoidMob connection is not configured." },
        proxies: { ok: false, items: [], error: "VoidMob connection is not configured." },
        dedicated: { ok: false, items: [], error: "VoidMob connection is not configured." }
      },
      summary: { sms: 0, esim: 0, proxies: 0, dedicatedCountries: 0 }
    });
  }

  const headers = {
    Authorization: "Bearer " + process.env.VOIDMOB_API_KEY,
    Accept: "application/json"
  };

  const [esim, proxies, dedicated] = await Promise.all([
    safeRead("eSIM plans", () => supplierGet("/v1/esim_products?limit=20", headers), p =>
      (p.products || []).map(x => ({
        id: x.id,
        title: x.title,
        countries: x.countries || [],
        dataGb: x.data_limit_gb,
        unlimited: Boolean(x.data_unlimited),
        validityDays: x.validity_days,
        features: x.features || {}
      }))
    ),
    safeRead("proxy plans", () => supplierGet("/v1/proxy_plans?type=all", headers), p =>
      (p.plans || []).map(x => ({
        id: x.id,
        name: x.name,
        type: x.type,
        country: x.country_name || x.country || "Global",
        dataGb: x.data_gb,
        durationDays: x.duration_days,
        available: x.available !== false
      }))
    ),
    safeRead("dedicated-number countries", () => supplierGet("/v1/dedicated/countries", headers), p =>
      (Array.isArray(p) ? p : []).map(x => ({
        country: x.country,
        name: x.name,
        inStock: Boolean(x.in_stock)
      }))
    )
  ]);

  const sections = { sms, esim, proxies, dedicated };
  const availableSections = [esim, proxies, dedicated].filter(x => x.ok).length;
  return json(res, 200, {
    ok: availableSections > 0,
    updatedAt: new Date().toISOString(),
    providers: {
      herosms: Boolean(process.env.HEROSMS_API_KEY),
      voidmob: true
    },
    sections,
    summary: {
      sms: 0,
      esim: esim.items.length,
      proxies: proxies.items.length,
      dedicatedCountries: dedicated.items.length
    }
  });
};
