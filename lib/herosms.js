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
  const key = process.env.HEROSMS_RETAIL_API_KEY;
  if (!key) throw makeError("HEROSMS_RETAIL_KEY_NOT_CONFIGURED");
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
      if (["STATUS_OK", "STATUS_WAIT_CODE", "STATUS_WAIT_RETRY", "STATUS_CANCEL", "STATUS_WAIT_RESEND"].includes(code)) return data;
      if (["BAD_KEY", "NO_KEY", "NO_BALANCE", "NO_NUMBERS", "BAD_ACTION", "BAD_SERVICE", "WRONG_COUNTRY", "ACCOUNT_INACTIVE", "EARLY_CANCEL_DENIED", "NO_ACTIVATION"].includes(code)) {
        throw makeError(code, code === "BAD_KEY" || code === "NO_KEY" ? 401 : 502);
      }
      if (data.startsWith("ACCESS_BALANCE:")) return { balance: Number(data.slice("ACCESS_BALANCE:".length)) };
      throw makeError(code || "INVALID_RESPONSE", 502);
    }
    if (!data || typeof data !== "object" || data.title) throw makeError(data?.title || "INVALID_RESPONSE", 502);
    if (data.status === "error" || typeof data.error === "string") throw makeError(data.error || "API_ERROR", 502);
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
    for (const code of ["ad","ae","af","ag","ai","al","am","ao","aq","ar","as","at","au","aw","ax","az","ba","bb","bd","be","bf","bg","bh","bi","bj","bl","bm","bn","bo","bq","br","bs","bt","bv","bw","by","bz","ca","cc","cd","cf","cg","ch","ci","ck","cl","cm","cn","co","cr","cu","cv","cw","cx","cy","cz","de","dj","dk","dm","do","dz","ec","ee","eg","eh","er","es","et","fi","fj","fk","fm","fo","fr","ga","gb","gd","ge","gf","gg","gh","gi","gl","gm","gn","gp","gq","gr","gs","gt","gu","gw","gy","hk","hm","hn","hr","ht","hu","id","ie","il","im","in","io","iq","ir","is","it","je","jm","jo","jp","ke","kg","kh","ki","km","kn","kp","kr","kw","ky","kz","la","lb","lc","li","lk","lr","ls","lt","lu","lv","ly","ma","mc","md","me","mf","mg","mh","mk","ml","mm","mn","mo","mp","mq","mr","ms","mt","mu","mv","mw","mx","my","mz","na","nc","ne","nf","ng","ni","nl","no","np","nr","nu","nz","om","pa","pe","pf","pg","ph","pk","pl","pm","pn","pr","ps","pt","pw","py","qa","re","ro","rs","ru","rw","sa","sb","sc","sd","se","sg","sh","si","sj","sk","sl","sm","sn","so","sr","ss","st","sv","sx","sy","sz","tc","td","tf","tg","th","tj","tk","tl","tm","tn","to","tr","tt","tv","tw","tz","ua","ug","um","us","uy","uz","va","vc","ve","vg","vi","vn","vu","wf","ws","ye","yt","za","zm","zw"]) {
      const label = String(display.of(code.toUpperCase()) || "").toLowerCase().replace(/[^a-z]/g, "");
      if (label === normalized) return code;
    }
  }
  return "";
}

function retailPriceCents(supplierPriceCents, category) {
  const fallback = category === "rentals" ? { percent: 40, minimum: 100 } : { percent: 55, minimum: 5 };
  const percentValue = Number(process.env["VERIFYFLOW_" + category.toUpperCase() + "_MARKUP_PERCENT"]);
  const minimumValue = Number(process.env["VERIFYFLOW_" + category.toUpperCase() + "_MIN_MARKUP_CENTS"]);
  const percent = Number.isFinite(percentValue) && percentValue >= 0 && percentValue <= 5000 ? percentValue : fallback.percent;
  const minimum = Number.isSafeInteger(minimumValue) && minimumValue >= 0 && minimumValue <= 10000000 ? minimumValue : fallback.minimum;
  return Math.max(Math.ceil(supplierPriceCents * (1 + percent / 100) - 1e-9), supplierPriceCents + minimum);
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
  })).filter((item, index) => {
    const source = Object.values(countryData)[index];
    return Number.isInteger(item.id) && item.id >= 0 && source?.visible !== 0;
  });
  const country = countries.find(item => item.code === iso);
  if (!country) return { countries, items: [], country: iso, countryName: null, available: false };

  const rentalHours = [24, 72, 168, 720];
  const [countryServices, countryPrices, rentalResponses] = await Promise.all([
    request("getServicesList", { country: country.id }),
    request("getPrices", { country: country.id }),
    Promise.all(rentalHours.map(duration => request("getRentServicesAndCountries", { country: country.id, duration }).catch(error => ({ _error: error.code || "RENTAL_UNAVAILABLE" }))))
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
    const retailPrice = retailPriceCents(supplierPriceCents, "sms");
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
      priceCents: retailPrice,
      currency: "USD"
    };
  }).filter(Boolean);
  const rentalMaps = rentalResponses.map(response => response && !response._error ? (response.services || response.data?.services || {}) : {});
  const rentalCodes = [...new Set(rentalMaps.flatMap(map => Object.keys(map)))];
  const rentals = rentalCodes.map(code => {
    const durations = rentalMaps.map((map, index) => {
      const offer = map[code];
      if (!offer) return null;
      const cost = Number(offer.cost ?? offer.price ?? offer.retail_price);
      const count = Number(offer.quant ?? offer.quantity ?? offer.count ?? 0);
      if (!Number.isFinite(cost) || cost <= 0 || count <= 0) return null;
      const supplierPriceCents = Math.round(cost * 100);
      const priceCents = retailPriceCents(supplierPriceCents, "rentals");
      return { days: rentalHours[index] / 24, hours: rentalHours[index], priceCents, currency: "USD", availableCount: count, supplierPriceCents };
    }).filter(Boolean);
    if (!durations.length) return null;
    return {
      id: code, name: String(allServices.find(service => String(service.code) === code)?.name || code),
      provider: "herosms", countryCode: iso, countryId: country.id, countryName: country.name,
      available: true, availableCount: Math.max(...durations.map(item => item.availableCount)),
      supplierPriceCents: Math.min(...durations.map(item => item.supplierPriceCents)),
      priceCents: Math.min(...durations.map(item => item.priceCents)),
      currency: "USD", durations: durations.map(({ availableCount, supplierPriceCents, ...duration }) => duration)
    };
  }).filter(Boolean);
  return { countries, items, rentals, country: iso, countryName: country.name, available: true };
}

async function buyNumber(service, countryId, reference) {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(String(service || "")) || !Number.isInteger(Number(countryId))) {
    throw makeError("INVALID_PURCHASE_INPUT", 400);
  }
  const data = await request("getNumberV2", {
    service: String(service),
    country: Number(countryId),
    ref: String(reference || "").slice(0, 64) || undefined
  });
  const activationId = data.activationId ?? data.id;
  const phoneNumber = String(data.phoneNumber || data.phone || "");
  if (!activationId || !/^\\+?[0-9]{6,20}$/.test(phoneNumber)) throw makeError("SUPPLIER_RESPONSE_UNCLEAR", 502);
  return {
    supplierOrderId: String(activationId),
    status: "waiting_code",
    chargedPriceCents: Number.isFinite(Number(data.activationCost)) ? Math.round(Number(data.activationCost) * 100) : null,
    supplierData: {
      activationId: String(activationId),
      phoneNumber,
      countryCode: data.countryCode || null,
      activationEndTime: data.activationEndTime || null,
      canGetAnotherSms: data.canGetAnotherSms === true
    }
  };
}

async function getActivation(activationId) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(activationId || ""))) throw makeError("INVALID_SUPPLIER_ORDER_ID", 400);
  const data = await request("getStatusV2", { id: String(activationId) }).catch(async error => {
    if (error.code === "BAD_ACTION") return request("getStatus", { id: String(activationId) });
    throw error;
  });
  if (typeof data === "string") {
    if (data.startsWith("STATUS_OK:")) return { status: "code_received", code: data.slice("STATUS_OK:".length) };
    if (data === "STATUS_CANCEL" || data === "NO_ACTIVATION") return { status: "cancelled" };
    return { status: "waiting_code" };
  }
  const sms = data.sms || data.messages || null;
  const code = typeof sms === "string" ? sms : Array.isArray(sms) ? (sms[sms.length - 1]?.code || sms[sms.length - 1]?.text || "") : (sms?.code || "");
  const state = String(data.status || data.statusCode || "").toLowerCase();
  return {
    status: code ? "code_received" : /cancel|finish|expired/.test(state) ? "cancelled" : "waiting_code",
    code: code ? String(code) : null,
    phoneNumber: data.phoneNumber || data.phone || null,
    activationId: String(activationId)
  };
}

async function setActivationStatus(activationId, status) {
  if (!["6", "8"].includes(String(status))) throw makeError("INVALID_ACTIVATION_STATUS", 400);
  const result = await request("setStatus", { id: String(activationId), status: String(status) });
  return { result: typeof result === "string" ? result : "OK" };
}

async function quoteProduct(productType, input) {
  const countryCode = String(input.country || "us").toLowerCase();
  const catalog = await getCatalog(countryCode);
  if (productType !== "sms_otp") throw makeError("HEROSMS_PRODUCT_NOT_SUPPORTED", 400);
  const item = catalog.items.find(row => String(row.id) === String(input.productId));
  if (!item || !item.available) throw makeError("PRODUCT_UNAVAILABLE", 409);
  return {
    provider: "herosms",
    productName: item.name + " (" + catalog.countryName + ")",
    supplierPriceCents: item.supplierPriceCents,
    salePriceCents: item.priceCents,
    supplierInput: {
      service: String(item.id),
      countryId: Number(item.countryId),
      countryCode,
      maxPriceCents: Number(item.supplierPriceCents)
    },
    productSnapshot: {
      id: item.id, name: item.name, type: productType, country: countryCode,
      supplierPriceCents: item.supplierPriceCents, retailPriceCents: item.priceCents,
      currency: "USD", quotedAt: new Date().toISOString()
    }
  };
}

async function getBalance() {
  throw makeError("USE_HEROSMS_ACCOUNT_API");
}

module.exports = { request, getCatalog, getBalance, buyNumber, getActivation, setActivationStatus, quoteProduct, countryIsoFromName };
