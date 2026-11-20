const { getCatalog: getHeroSmsCatalog } = require("../lib/herosms");
const { sealCatalogProductToken } = require("../lib/catalog-token");
const VOIDMOB_BASE = "https://dashboard.voidmob.com/api/v1";

const PRICE_RULES = {
  sms: { percent: 55, minimumMarkupCents: 5 },
  rentals: { percent: 40, minimumMarkupCents: 100 },
  esim: { percent: 35, minimumMarkupCents: 100 },
  proxies: { percent: 18, minimumMarkupCents: 25 },
  dedicated: { percent: 35, minimumMarkupCents: 200 }
};

function json(res, status, body, cacheControl = "private, no-store") {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 && value <= 5000 ? value : fallback;
}

function retailPriceCents(supplierPrice, category) {
  const cost = Number(supplierPrice);
  if (!Number.isSafeInteger(cost) || cost <= 0) return null;

  const rule = PRICE_RULES[category];
  const configuredPercent = envNumber("VERIFYFLOW_" + category.toUpperCase() + "_MARKUP_PERCENT", rule.percent);
  const configuredMinimum = envNumber("VERIFYFLOW_" + category.toUpperCase() + "_MIN_MARKUP_CENTS", rule.minimumMarkupCents);
  // Keep shared and dedicated proxy prices competitive: never exceed an 18% retail
  // markup or a $0.25 minimum margin per supplier plan.
  const percent = category === "proxies" ? Math.min(configuredPercent, 18) : configuredPercent;
  const minimum = category === "proxies" ? Math.min(configuredMinimum, 25) : configuredMinimum;
  const percentagePrice = Math.ceil(cost * (1 + percent / 100) - 1e-9);
  const currentPrice = Math.max(percentagePrice, cost + minimum);
  // Preserve all existing OTP prices at $1.00 or above. For cheaper OTP options,
  // guarantee at least a $0.70 margin (about NGN 900 at the current exchange rate).
  if (category === "sms" && currentPrice < 100) {
    return Math.max(percentagePrice, cost + Math.max(minimum, 70));
  }
  return currentPrice;
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
      error.requestId = payload.error?.request_id || payload.request_id || response.headers.get("x-request-id") || null;
      error.endpoint = path;
      error.retryAfter = response.headers.get("retry-after") || null;
      throw error;
    }
    return payload.data ?? payload;
  } finally {
    clearTimeout(timer);
  }
}

async function supplierList(path, collectionName, headers, limit) {
  const rows = [];
  const seen = new Set();
  let cursor = null;

  for (let page = 0; page < 20; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const cursorPart = cursor ? "&cursor=" + encodeURIComponent(cursor) : "";
    const data = await supplierGet(path + separator + "limit=" + limit + cursorPart, headers);
    const pageRows = Array.isArray(data[collectionName]) ? data[collectionName] : [];
    rows.push(...pageRows);
    const next = data.next_cursor;
    if (!next || seen.has(next)) break;
    seen.add(next);
    cursor = next;
  }
  return rows;
}

async function safeRead(task, map) {
  try {
    const data = await task();
    return { ok: true, items: map(data), message: null };
  } catch (error) {
    console.error("[catalog]", JSON.stringify({ endpoint: error.endpoint || null, status: error.status || null, code: error.code || "CATALOGUE_ERROR", requestId: error.requestId || null, retryAfter: error.retryAfter || null }));
    return {
      ok: false,
      items: [],
      message: "This collection is temporarily unavailable. Please refresh in a little while."
    };
  }
}

function unavailableSection() {
  return {
    ok: false,
    items: [],
    message: "This collection is temporarily unavailable. Please refresh in a little while."
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { ok: false, error: "Method not allowed." });
  }

  const requestedCountry = String(req.query?.country || "us").trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(requestedCountry)) {
    return json(res, 400, { ok: false, error: "Enter a valid two-letter country code." });
  }

  if (!process.env.VOIDMOB_API_KEY && !(process.env.HEROSMS_RETAIL_API_KEY || process.env.HEROSMS_API_KEY)) {
    const unavailable = unavailableSection();
    return json(res, 200, {
      ok: false,
      country: requestedCountry,
      updatedAt: new Date().toISOString(),
      currency: "USD",
      taxNote: "Applicable VAT and local taxes are additional and depend on the customer's billing location.",
      sections: {
        sms: unavailable,
        rentals: unavailable,
        esim: unavailable,
        proxies: unavailable,
        dedicated: unavailable
      },
      summary: { sms: 0, rentals: 0, esim: 0, proxies: 0, dedicated: 0 }
    });
  }

  const headers = {
    Authorization: "Bearer " + process.env.VOIDMOB_API_KEY,
    Accept: "application/json"
  };

  const [services, esim, proxies, dedicated, heroSms] = await Promise.all([
    requestedCountry === "us"
      ? safeRead(
          () => supplierGet("/services", headers),
          data => Array.isArray(data.services) ? data.services : []
        )
      : Promise.resolve({
          ok: true,
          items: [],
          message: "SMS verification and long-term number rentals are currently available for US numbers only."
        }),
    safeRead(
      () => supplierList("/esim_products", "products", headers, 100),
      data => data
    ),
    safeRead(
      () => supplierList("/proxy_plans?type=all", "plans", headers, 200),
      data => data
    ),
    safeRead(
      () => supplierGet("/dedicated/countries", headers),
      data => Array.isArray(data) ? data : []
    ),
    (process.env.HEROSMS_RETAIL_API_KEY || process.env.HEROSMS_API_KEY)
      ? safeRead(() => getHeroSmsCatalog(requestedCountry), data => ({ smsItems: data.items || [], rentalItems: data.rentals || [], countries: data.countries || [], countryName: data.countryName }))
      : Promise.resolve({ ok: false, items: [], rentals: [], countries: [], message: "HeroSMS retail API key is not configured. The Account API key is separate." })
  ]);

  const smsItems = services.items.map(service => ({
    id: sealCatalogProductToken({
      provider: "voidmob", productType: "sms_otp",
      productId: String(service.id), country: requestedCountry
    }),
    name: service.name,
    available: Boolean(service.available),
    priceCents: retailPriceCents(service.quoted_price_cents, "sms"),
    currency: "USD"
  }));

  const voidMobRentalItems = services.items.map(service => {
    const priceFields = [
      [3, service.ltr_3d_price_cents],
      [7, service.ltr_7d_price_cents],
      [14, service.ltr_14d_price_cents],
      [30, service.ltr_30d_price_cents]
    ];
    const durations = priceFields
      .filter(([, price]) => Number(price) > 0)
      .map(([days, price]) => ({
        days,
        priceCents: retailPriceCents(price, "rentals"),
        currency: "USD"
      }));

    return {
      id: sealCatalogProductToken({
        provider: "voidmob", productType: "long_term_number",
        productId: String(service.id), country: requestedCountry
      }),
      name: service.name,
      countryCode: requestedCountry.toUpperCase(),
      available: Boolean(service.available),
      durations
    };
  }).filter(item => item.durations.length > 0);

  const esimItems = esim.items.map(product => ({
    id: sealCatalogProductToken({
      provider: "voidmob", productType: "esim",
      productId: String(product.id), country: requestedCountry
    }),
    title: product.full_title || product.title,
    countries: Array.isArray(product.countries) ? product.countries : [],
    dataGb: product.data_limit_gb,
    unlimited: Boolean(product.data_unlimited),
    validityDays: product.validity_days,
    networkType: product.network_type,
    routingLocation: product.routing_location,
    features: product.features || {},
    priceCents: retailPriceCents(product.price_cents, "esim"),
    currency: "USD"
  }));

  const proxyItems = proxies.items.map(plan => ({
    id: sealCatalogProductToken({
      provider: "voidmob", productType: "mobile_proxy",
      productId: String(plan.id), country: requestedCountry
    }),
    name: plan.name,
    type: plan.type,
    country: plan.country_name || plan.country || "Global",
    carrier: plan.carrier || null,
    region: plan.region || null,
    dataGb: plan.data_gb == null ? null : Number(plan.data_gb),
    durationDays: plan.duration_days,
    period: plan.period || (String(plan.type || "").toLowerCase() === "shared" ? "30 days" : null),
    available: plan.available !== false,
    priceCents: retailPriceCents(plan.quoted_price_cents, "proxies"),
    pricePerGbCents: String(plan.type || "").toLowerCase() === "shared" && Number(plan.data_gb) > 0
      ? Math.ceil(retailPriceCents(plan.quoted_price_cents, "proxies") / Number(plan.data_gb))
      : null,
    currency: "USD",
    description: String(plan.type || "").toLowerCase() === "shared"
      ? "Shared pay-per-GB access through a pool of real 4G/5G mobile carrier devices. Use HTTP(S) or SOCKS5 connections with rotating or sticky sessions where supported by the selected plan."
      : "A dedicated mobile proxy connection routed through a real 4G/5G carrier device. Designed for a more consistent mobile IP, with unmetered traffic on supported dedicated plans."
  }));

  const dedicatedItems = dedicated.items.map(item => ({
    id: sealCatalogProductToken({
      provider: "voidmob", productType: "dedicated_number",
      productId: String(item.country).toLowerCase(), country: String(item.country).toLowerCase()
    }),
    country: item.country,
    name: item.name,
    inStock: Boolean(item.in_stock),
    priceCents: retailPriceCents(item.quoted_price_cents, "dedicated"),
    currency: "USD",
    billingPeriod: "monthly"
  }));

  // HeroSMS is mapped into the same public shape, but supplier IDs, provider
  // names, country IDs, stock counters and supplier cost fields stay server-side.
  const heroSmsItems = heroSms.ok ? (heroSms.items?.smsItems || []).map(item => ({
    id: sealCatalogProductToken({
      provider: "herosms", productType: "sms_otp",
      productId: String(item.id), country: String(item.countryCode || requestedCountry).toLowerCase(),
      countryId: Number(item.countryId), productName: String(item.name || item.id)
    }),
    name: item.name,
    available: Boolean(item.available),
    supportsVerificationMethods: true,
    priceCents: Number(item.priceCents),
    currency: "USD"
  })) : [];
  const heroSmsRentalItems = heroSms.ok ? (heroSms.items?.rentalItems || []).map(item => ({
    id: sealCatalogProductToken({
      provider: "herosms", productType: "long_term_number",
      productId: String(item.id), country: String(item.countryCode || requestedCountry).toLowerCase(),
      countryId: Number(item.countryId), productName: String(item.name || item.id)
    }),
    name: item.name,
    countryCode: String(item.countryCode || requestedCountry).toUpperCase(),
    available: Boolean(item.available),
    durations: (Array.isArray(item.durations) ? item.durations : []).map(duration => ({
      days: Number(duration.days),
      hours: Number(duration.hours),
      priceCents: Number(duration.priceCents),
      currency: "USD"
    }))
  })).filter(item => item.durations.length) : [];
  const mergedSmsItems = [...smsItems, ...heroSmsItems];
  const mergedRentalItems = [...voidMobRentalItems, ...heroSmsRentalItems];
  const smsOk = services.ok || heroSms.ok;
  const rentalOk = services.ok || heroSms.ok;
  const smsMessage = mergedSmsItems.length ? null : (!heroSms.ok && requestedCountry !== "us" ? services.message : null);
  const rentalMessage = mergedRentalItems.length ? null : (!heroSms.ok && requestedCountry !== "us" ? services.message : null);
  const sections = {
    sms: { ok: smsOk, items: mergedSmsItems, message: smsOk ? smsMessage : "SMS catalogues are temporarily unavailable." },
    rentals: { ok: rentalOk, items: mergedRentalItems, message: rentalOk ? rentalMessage : "Number rental catalogues are temporarily unavailable." },
    esim: { ok: esim.ok, items: esimItems, message: esim.message },
    proxies: { ok: proxies.ok, items: proxyItems, message: proxies.message },
    dedicated: { ok: dedicated.ok, items: dedicatedItems, message: dedicated.message }
  };

  const successfulSections = Object.values(sections).filter(section => section.ok).length;
  return json(res, 200, {
    ok: successfulSections > 0,
    country: requestedCountry,
    updatedAt: new Date().toISOString(),
    currency: "USD",
    countries: (() => {
      const rows = heroSms.ok && Array.isArray(heroSms.items?.countries) ? heroSms.items.countries : [];
      const valid = rows.filter(item => item && /^[a-z]{2}$/i.test(String(item.code || "")))
        .map(item => ({ code: String(item.code).toLowerCase(), name: String(item.name || item.code) }));
      if (!valid.some(item => item.code === "us") && process.env.VOIDMOB_API_KEY) valid.unshift({ code: "us", name: "United States" });
      return valid.sort((a, b) => (a.code === "us" ? -1 : b.code === "us" ? 1 : a.name.localeCompare(b.name)));
    })(),
    taxNote: "Displayed prices are before applicable VAT or local sales taxes. These are added separately at checkout based on the customer's billing location.",
    sections,
    summary: {
      sms: mergedSmsItems.length,
      rentals: mergedRentalItems.length,
      esim: esimItems.length,
      proxies: proxyItems.length,
      dedicated: dedicatedItems.length
    }
  }, "public, s-maxage=30, stale-while-revalidate=120");
};
