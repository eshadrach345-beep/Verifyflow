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
      method: "GET", headers, signal: controller.signal
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

  // HeroSMS remains the preferred primary SMS partner. Its Account API key
  // is not a buyer-side inventory credential and is not exposed as connected.
  const sms = {
    ok: false,
    items: [],
    message: "SMS options are being prepared. Please check back shortly."
  };

  if (!process.env.VOIDMOB_API_KEY) {
    const unavailable = {
      ok: false, items: [],
      message: "This collection is temporarily unavailable. Please refresh in a little while."
    };
    return json(res, 200, {
      ok: false, updatedAt: new Date().toISOString(),
      sections: { sms, rentals: unavailable, esim: unavailable, proxies: unavailable, dedicated: unavailable },
      summary: { sms: 0, rentals: 0, esim: 0, proxies: 0, dedicated: 0 }
    });
  }

  const headers = {
    Authorization: "Bearer " + process.env.VOIDMOB_API_KEY,
    Accept: "application/json"
  };

  const [rentals, esim, proxies, dedicated] = await Promise.all([
    safeRead(
      () => supplierGet("/services?country=us", headers),
      data => (data.services || []).map(service => {
        const durationOptions = [
          { days: 3, available: Number(service.ltr_3d_price_cents || 0) > 0 },
          { days: 7, available: Number(service.ltr_7d_price_cents || 0) > 0 },
          { days: 14, available: Number(service.ltr_14d_price_cents || 0) > 0 },
          { days: 30, available: Number(service.ltr_30d_price_cents || 0) > 0 }
        ].filter(option => option.available).map(option => option.days);
        return {
          id: service.id,
          name: service.name,
          country: "United States",
          available: Boolean(service.available),
          durations: durationOptions
        };
      })
    ),
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
        id: x.id, name: x.name, type: x.type,
        country: x.country_name || x.country || "Global",
        carrier: x.carrier || null, region: x.region || null,
        dataGb: x.data_gb, durationDays: x.duration_days,
        period: x.period, available: x.available !== false
      }))
    ),
    safeRead(
      () => supplierGet("/dedicated/countries", headers),
      data => (Array.isArray(data) ? data : []).map(x => ({
        country: x.country, name: x.name, inStock: Boolean(x.in_stock)
      }))
    )
  ]);

  const sections = { sms, rentals, esim, proxies, dedicated };
  const availableSections = [rentals, esim, proxies, dedicated].filter(x => x.ok).length;
  return json(res, 200, {
    ok: availableSections > 0,
    updatedAt: new Date().toISOString(),
    sections,
    summary: {
      sms: 0, rentals: rentals.items.length,
      esim: esim.items.length, proxies: proxies.items.length,
      dedicated: dedicated.items.length
    }
  });
};
