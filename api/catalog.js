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
    if (!response.ok || payload.success === false) {
      const error = new Error("Catalogue request failed");
      error.status = response.status;
      error.code = payload.error?.code || payload.code || "CATALOGUE_ERROR";
      throw error;
    }
    return payload.data ?? payload;
  } finally {
    clearTimeout(timer);
  }
}

async function safeRead(task, map) {
  try {
    const data = await task();
    return { ok: true, items: map(data), message: null };
  } catch (error) {
    console.error("[catalog]", error.code || error.message);
    return {
      ok: false,
      items: [],
      message: "This collection is temporarily unavailable. Please refresh in a little while."
    };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { ok: false, error: "Method not allowed." });
  }

  // HeroSMS remains the planned primary SMS source. The Account API key is
  // not a number-purchase integration; do not present it as a live catalogue.
  const sms = {
    ok: false,
    items: [],
    message: "SMS options are being prepared. Please check back shortly."
  };

  if (!process.env.VOIDMOB_API_KEY) {
    const unavailable = {
      ok: false,
      items: [],
      message: "This collection is temporarily unavailable. Please refresh in a little while."
    };
    return json(res, 200, {
      ok: false,
      updatedAt: new Date().toISOString(),
      sections: {
        sms,
        esim: unavailable,
        proxies: unavailable,
        dedicated: unavailable
      },
      summary: { sms: 0, esim: 0, proxies: 0, dedicated: 0 }
    });
  }

  const headers = {
    Authorization: "Bearer " + process.env.VOIDMOB_API_KEY,
    Accept: "application/json"
  };

  const [esim, proxies, dedicated] = await Promise.all([
    safeRead(
      () => supplierGet("/esim_products?limit=100", headers),
      data => (data.products || []).map(x => ({
        id: x.id,
        title: x.full_title || x.title,
        countries: Array.isArray(x.countries) ? x.countries : [],
        dataGb: x.data_limit_gb,
        unlimited: Boolean(x.data_unlimited),
        validityDays: x.validity_days,
        networkType: x.network_type,
        routingLocation: x.routing_location,
        features: x.features || {}
      }))
    ),
    safeRead(
      () => supplierGet("/proxy_plans?type=all&limit=100", headers),
      data => (data.plans || []).map(x => ({
        id: x.id,
        name: x.name,
        type: x.type,
        country: x.country_name || x.country || "Global",
        carrier: x.carrier || null,
        region: x.region || null,
        dataGb: x.data_gb,
        durationDays: x.duration_days,
        period: x.period,
        available: x.available !== false
      }))
    ),
    safeRead(
      () => supplierGet("/dedicated/countries", headers),
      data => (Array.isArray(data) ? data : []).map(x => ({
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
    sections,
    summary: {
      sms: 0,
      esim: esim.items.length,
      proxies: proxies.items.length,
      dedicated: dedicated.items.length
    }
  });
};
