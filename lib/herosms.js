"use strict";

const BASE_URL = "https://hero-sms.com/stubs/handler_api.php";
const TIMEOUT_MS = 12000;

function makeError(code, status) {
  const error = new Error("HeroSMS API request failed.");
  error.code = String(code || "HEROSMS_REQUEST_FAILED").slice(0, 80);
  if (status) error.status = status;
  return error;
}

async function request(action, params = {}) {
  const key = process.env.HEROSMS_API_KEY;
  if (!key) throw makeError("SUPPLIER_NOT_CONFIGURED");
  const url = new URL(BASE_URL);
  url.searchParams.set("api_key", key);
  url.searchParams.set("action", action);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(name, String(value));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json, text/plain" },
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw makeError("HTTP_" + response.status, response.status);
    let data;
    try { data = JSON.parse(text); } catch { data = text.trim(); }
    if (typeof data === "string") {
      const code = data.split(":")[0];
      if (["BAD_KEY", "NO_KEY", "NO_BALANCE", "NO_NUMBERS", "BAD_ACTION", "BAD_SERVICE", "WRONG_COUNTRY", "ACCOUNT_INACTIVE"].includes(code)) {
        throw makeError(code, code === "BAD_KEY" || code === "NO_KEY" ? 401 : 502);
      }
      if (data.startsWith("ACCESS_BALANCE:")) return { balance: Number(data.slice("ACCESS_BALANCE:".length)) };
      throw makeError(code || "INVALID_RESPONSE", 502);
    }
    if (!data || typeof data !== "object" || data.title) throw makeError(data?.title || "INVALID_RESPONSE", 502);
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw makeError("TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function countryIsoFromName(name) {
  const normalized = String(name || "").toLowerCase().replace(/[^a-z]/g, "");
  const aliases = {
    unitedstates: "us", unitedstatesofamerica: "us", usa: "us",
    unitedkingdom: "gb", greatbritain: "gb", uk: "gb",
    southkorea: "kr", republicofkorea: "kr",
    vietnam: "vn", russianfederation: "ru",
    bolivia: "bo", tanzania: "tz", iran: "ir",
    venezuela: "ve", syria: "sy", taiwan: "tw"
  };
  if (aliases[normalized]) return aliases[normalized];
  if (typeof Intl.DisplayNames === "function") {
    const display = new Intl.DisplayNames(["en"], { type: "region" });
    for (const code of ["us","gb","ca","au","de","fr","in","ng","za","ke","br","jp","mx","ph","sg","it","es","nl","se","no","fi","pl","ua","tr","ae","sa","eg","gh","ug","tz","rw","cn","hk","tw","kr","vn","th","id","my","pk","bd","lk","np","ar","cl","co","pe","ec","do","cr","pa","gt","hn","sv","ni","uy","py","bo","ve","cu","is","ie","pt","gr","ch","at","be","cz","ro","hu","bg","hr","rs","sk","si","lt","lv","ee","cy","mt","lu","qa","kw","bh","om","jo","lb","ma","tn","dz","et","zm","zw","mu","mg","cm","sn","ci","ao","mz","na","bw","sz","ls","mw","sl","lr","gm","tg","bj","ne","ml","bf","ga","cg","cd","so","sd","ss","ly","iq","af","ge","am","az","kz","uz","kg","tj","mn","kh","la","mm","bn","bt","mv","fj","pg","ws","to","vu","sb","nc"]) {
      const label = String(display.of(code.toUpperCase()) || "").toLowerCase().replace(/[^a-z]/g, "");
      if (label === normalized) return code;
    }
  }
  return "";
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function priceForCountry(data, countryId) {
  if (!data || typeof data !== "object") return {};
  const root = data.prices || data.data || data;
  return root[String(countryId)] || root[countryId] || root;
}

async function getCatalog(countryCode = "us") {
  const iso = String(countryCode || "us").trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(iso)) throw makeError("INVALID_COUNTRY", 400);
  const countryData = await request("getCountries");
  const countries = Object.entries(countryData).map(([id, item]) => ({
    id: Number(item.id ?? id),
    name: String(item.eng || item.name || item.rus || id),
    code: countryIsoFromName(item.eng || item.name || "")
  })).filter(item => Number.isInteger(item.id) && item.id >= 0);
  const country = countries.find(item => item.code === iso);
  if (!country) return { countries, items: [], country: iso, countryName: null, available: false };

  const [countryServices, countryPrices] = await Promise.all([
    request("getServicesList", { country: country.id }),
    request("getPrices", { country: country.id })
  ]);
  const services = asArray(countryServices.services || countryServices.data || countryServices);
  const priceMap = priceForCountry(countryPrices, country.id);
  const allServices = services;
  const items = allServices.map(service => {
    const code = String(service.code || service.id || "");
    const quote = priceMap[code] || priceMap.services?.[code] || {};
    const cost = Number(quote.cost ?? quote.price ?? quote.retail_price);
    const count = Number(quote.count ?? quote.quantity ?? 0);
    const physicalCount = Number(quote.physicalCount ?? quote.physical_count ?? 0);
    if (!code || !Number.isFinite(cost) || cost <= 0 || count <= 0) return null;
    const supplierPriceCents = Math.round(cost * 100);
    const retailPriceCents = Math.max(
      Math.ceil(supplierPriceCents * 1.55 - 1e-9),
      supplierPriceCents + 5
    );
    return {
      id: code,
      name: String(service.name || service.title || code),
      provider: "herosms",
      countryCode: iso,
      countryId: country.id,
      countryName: country.name,
      available: true,
      availableCount: Number.isFinite(count) ? count : 0,
      physicalCount: Number.isFinite(physicalCount) ? physicalCount : 0,
      supplierPriceCents,
      priceCents: retailPriceCents,
      currency: "USD"
    };
  }).filter(Boolean);
  return { countries, items, country: iso, countryName: country.name, available: true };
}

async function getBalance() {
  const result = await request("getBalance");
  const amount = Number(result.balance);
  if (!Number.isFinite(amount)) throw makeError("INVALID_BALANCE_RESPONSE", 502);
  return { balance: amount, currency: "USD" };
}

module.exports = { request, getCatalog, getBalance, countryIsoFromName };
