"use strict";

const BASE_URL = "https://hero-sms.com/stubs/handler_api.php";
const TIMEOUT_MS = 12000;

const V1_BASE_URL = "https://hero-sms.com/api/v1";

async function requestV1(path, options = {}) {
  const key = process.env.HEROSMS_RETAIL_API_KEY || process.env.HEROSMS_API_KEY;
  if (!key) throw makeError("HEROSMS_RETAIL_KEY_NOT_CONFIGURED");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(V1_BASE_URL + path, {
      method: options.method || "GET",
      headers: {
        Accept: "application/json",
        Authorization: "ApiKey " + key,
        ...(options.body ? { "Content-Type": "application/json" } : {})
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal
    });
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw.slice(0, 500) }; }
    if (!response.ok) {
      const error = makeError(data?.error?.code || data?.code || "HEROSMS_V1_HTTP_" + response.status, response.status);
      error.details = data?.details || data?.error || null;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw makeError("TIMEOUT");
    if (!error.code && !error.status) throw makeError("SUPPLIER_CONNECTION_FAILED");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function activationRows(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.activations)) return payload.activations;
  return [];
}



function makeError(code, status) {
  const error = new Error("HeroSMS API request failed.");
  error.code = String(code || "HEROSMS_REQUEST_FAILED").slice(0, 80);
  if (status) error.status = status;
  return error;
}

async function request(action, params = {}) {
  const key = process.env.HEROSMS_RETAIL_API_KEY || process.env.HEROSMS_API_KEY;
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
      if (["STATUS_OK", "STATUS_WAIT_CODE", "STATUS_WAIT_RETRY", "STATUS_CANCEL", "STATUS_WAIT_RESEND", "ACCESS_CANCEL", "ACCESS_ACTIVATION", "ACCESS_RETRY_GET"].includes(code)) return data;
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
    if (!error.code && !error.status) throw makeError("SUPPLIER_CONNECTION_FAILED");
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
  const percentagePrice = Math.ceil(supplierPriceCents * (1 + percent / 100) - 1e-9);
  const currentPrice = Math.max(percentagePrice, supplierPriceCents + minimum);
  // Keep existing OTP prices of $1.00 or more unchanged; add at least $0.70
  // margin only to OTP options whose current retail price is below $1.00.
  if (category === "sms" && currentPrice < 100) {
    return Math.max(percentagePrice, supplierPriceCents + Math.max(minimum, 70));
  }
  return currentPrice;
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

async function buyNumber(service, countryId, reference, maxPriceCents, verificationType = "sms") {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(String(service || "")) || !Number.isInteger(Number(countryId))) throw makeError("INVALID_PURCHASE_INPUT", 400);
  const method = String(verificationType || "sms").toLowerCase();
  if (!["sms", "call", "voice"].includes(method)) throw makeError("INVALID_VERIFICATION_TYPE", 400);
  const maxPrice = Number.isSafeInteger(Number(maxPriceCents)) && Number(maxPriceCents) > 0 ? Number(maxPriceCents) / 100 : undefined;
  let payload;
  try {
    payload = await requestV1("/activations", {
      method: "POST",
      body: { amount: 1, country: Number(countryId), service: String(service), ...(maxPrice ? { maxPrice, fixedPrice: true } : {}), verificationType: method }
    });
  } catch (error) {
    if (error.code === "TIMEOUT" || !error.status || error.status >= 500) throw makeError("SUPPLIER_OUTCOME_UNKNOWN", 503);
    throw error;
  }
  const activation = activationRows(payload)[0] || payload?.data || payload?.activation || payload;
  const activationId = activation?.id ?? activation?.activationId;
  const phoneNumber = String(activation?.phone || activation?.phoneNumber || "");
  const supplierCost = Number(activation?.price ?? activation?.cost ?? activation?.activationCost);
  if (!activationId || !/^\+?[0-9]{6,20}$/.test(phoneNumber) || !Number.isFinite(supplierCost) || supplierCost <= 0) throw makeError("SUPPLIER_RESPONSE_UNCLEAR", 502);
  const chargedPriceCents = Math.round(supplierCost * 100);
  if (Number.isSafeInteger(Number(maxPriceCents)) && chargedPriceCents > Number(maxPriceCents)) {
    await requestV1("/activations/" + encodeURIComponent(String(activationId)), { method: "DELETE" }).catch(() => {});
    throw makeError("SUPPLIER_PRICE_CHANGED", 409);
  }
  return {
    supplierOrderId: String(activationId),
    status: activation?.otpLast?.smsCode ? "code_received" : "waiting_code",
    chargedPriceCents,
    supplierData: {
      activationId: String(activationId), phoneNumber,
      countryCode: activation?.countryPhoneCode ? "+" + String(activation.countryPhoneCode) : null,
      activationEndTime: activation?.expiredAt || null, verificationType: method,
      otpLast: activation?.otpLast || null
    }
  };
}

async function getActivation(activationId, verificationType = "sms") {
  if (!/^\d{1,20}$/.test(String(activationId || ""))) throw makeError("INVALID_SUPPLIER_ORDER_ID", 400);
  const method = ["sms", "call", "voice"].includes(String(verificationType).toLowerCase()) ? String(verificationType).toLowerCase() : "sms";
  const query = new URLSearchParams({ size: "25", page: "1", search: String(activationId), verificationType: method });
  const payload = await requestV1("/activations?" + query.toString());
  const activation = activationRows(payload).find(row => String(row.id) === String(activationId));
  if (!activation) return { status: "waiting_code", activationId: String(activationId), verificationType: method };
  const otp = activation.otpLast && typeof activation.otpLast === "object" ? activation.otpLast : {};
  const code = otp.smsCode == null ? null : String(otp.smsCode);
  const message = otp.smsText == null ? null : String(otp.smsText);
  const statusCode = Number(activation.status);
  return {
    status: code ? "code_received" : statusCode === 8 || statusCode === 10 ? "cancelled" : "waiting_code",
    code, message,
    phoneNumber: activation.phone == null ? null : String(activation.phone),
    activationId: String(activationId),
    verificationType: activation.verificationType || method,
    receivedAt: otp.receivedAt || null
  };
}

async function buyRentalNumber(service, countryId, durationHours, maxPriceCents) {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(String(service || "")) || !Number.isInteger(Number(countryId))) {
    throw makeError("INVALID_RENTAL_INPUT", 400);
  }
  const hours = Number(durationHours);
  if (![24, 72, 168, 720].includes(hours)) throw makeError("INVALID_RENTAL_DURATION", 400);
  let data;
  try {
    data = await request("getRentNumber", {
      service: String(service), country: Number(countryId), rent_time: hours
    });
  } catch (error) {
    if (error.code === "TIMEOUT" || error.code === "SUPPLIER_CONNECTION_FAILED" || !error.status || error.status >= 500) {
      throw makeError("SUPPLIER_OUTCOME_UNKNOWN", 503);
    }
    throw error;
  }
  const phone = data.phone || data.rental || data;
  const rentalId = phone.id ?? data.id;
  const phoneNumber = String(phone.number || phone.phoneNumber || phone.phone || "");
  const cost = Number(phone.cost ?? data.cost);
  if (!rentalId || !/^\+?[0-9]{6,20}$/.test(phoneNumber) || !Number.isFinite(cost) || cost <= 0) {
    throw makeError("SUPPLIER_RESPONSE_UNCLEAR", 502);
  }
  const chargedPriceCents = Math.round(cost * 100);
  if (Number.isSafeInteger(Number(maxPriceCents)) && chargedPriceCents > Number(maxPriceCents)) {
    await request("setRentStatus", { id: String(rentalId), status: 2 }).catch(() => {});
    throw makeError("SUPPLIER_PRICE_CHANGED", 409);
  }
  return {
    supplierOrderId: String(rentalId),
    status: "active",
    chargedPriceCents,
    supplierData: {
      rentalId: String(rentalId), phoneNumber,
      endDate: phone.endDate || phone.expiresAt || phone.expires_at || null,
      durationHours: hours
    }
  };
}

async function getRentalStatus(rentalId) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(rentalId || ""))) throw makeError("INVALID_SUPPLIER_ORDER_ID", 400);
  const data = await request("getRentStatus", { id: String(rentalId) });
  if (typeof data === "string") {
    if (data === "STATUS_CANCEL") return { status: "cancelled", rentalId: String(rentalId) };
    if (data === "STATUS_FINISH") return { status: "expired", rentalId: String(rentalId) };
    return { status: "active", rentalId: String(rentalId) };
  }
  const values = data.values && typeof data.values === "object" ? Object.values(data.values) : [];
  const latest = values.length ? values[values.length - 1] : null;
  const message = latest ? String(latest.text || latest.message || "") : "";
  const state = String(data.status || "").toLowerCase();
  return {
    status: /cancel/.test(state) ? "cancelled" : /finish|expired/.test(state) ? "expired" : "active",
    rentalId: String(rentalId),
    phoneNumber: data.phone?.number || data.phoneNumber || null,
    endDate: data.phone?.endDate || data.endDate || null,
    messages: values.map(value => ({
      sender: value.phoneFrom || value.sender || null,
      text: String(value.text || value.message || ""),
      receivedAt: value.date || value.createdAt || null
    })).filter(value => value.text),
    message: message || null,
    code: message ? (message.match(/\b(\d{4,8})\b/) || [])[1] || null : null
  };
}

async function setActivationStatus(activationId, status) {
  if (!/^\d{1,20}$/.test(String(activationId || ""))) throw makeError("INVALID_SUPPLIER_ORDER_ID", 400);
  if (String(status) === "6") {
    await requestV1("/activations/" + encodeURIComponent(String(activationId)) + "/finish", { method: "POST" });
    return { result: "OK" };
  }
  if (String(status) === "8") {
    await requestV1("/activations/" + encodeURIComponent(String(activationId)), { method: "DELETE" });
    return { result: "OK" };
  }
  throw makeError("INVALID_ACTIVATION_STATUS", 400);
}

async function quoteProduct(productType, input) {
  const countryCode = String(input.country || "us").toLowerCase();
  const catalog = await getCatalog(countryCode);
  if (productType === "long_term_number") {
    const item = catalog.rentals.find(row => String(row.id) === String(input.productId));
    if (!item || !item.available) throw makeError("PRODUCT_UNAVAILABLE", 409);
    const days = Number(input.durationDays);
    const duration = (item.durations || []).find(row => Number(row.days) === days);
    if (!duration || !Number.isSafeInteger(Number(duration.hours))) throw makeError("INVALID_DURATION", 400);
    const rentalData = await request("getRentServicesAndCountries", { country: Number(item.countryId), duration: Number(duration.hours) });
    const rentalServices = rentalData.services || rentalData.data?.services || {};
    const offer = rentalServices[String(item.id)];
    const supplierCost = Number(offer?.cost ?? offer?.price ?? offer?.retail_price);
    const availableCount = Number(offer?.quant ?? offer?.quantity ?? offer?.count ?? 0);
    if (!Number.isFinite(supplierCost) || supplierCost <= 0 || availableCount <= 0) throw makeError("PRODUCT_UNAVAILABLE", 409);
    const supplierPriceCents = Math.round(supplierCost * 100);
    const salePriceCents = retailPriceCents(supplierPriceCents, "rentals");
    return {
      provider: "herosms",
      productName: item.name + " (" + catalog.countryName + " · " + days + " days)",
      supplierPriceCents,
      salePriceCents,
      supplierInput: {
        service: String(item.id), countryId: Number(item.countryId),
        countryCode, durationHours: Number(duration.hours),
        maxPriceCents: supplierPriceCents
      },
      productSnapshot: {
        id: item.id, name: item.name, type: productType, country: countryCode,
        durationDays: days, durationHours: Number(duration.hours),
        supplierPriceCents,
        retailPriceCents: salePriceCents, currency: "USD", quotedAt: new Date().toISOString()
      }
    };
  }
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
      maxPriceCents: Number(item.supplierPriceCents),
      verificationType: ["sms", "call", "voice"].includes(String(input.verificationType || "sms").toLowerCase()) ? String(input.verificationType || "sms").toLowerCase() : "sms"
    },
    productSnapshot: {
      id: item.id, name: item.name, type: productType, country: countryCode,
      verificationType: ["sms", "call", "voice"].includes(String(input.verificationType || "sms").toLowerCase()) ? String(input.verificationType || "sms").toLowerCase() : "sms",
      supplierPriceCents: item.supplierPriceCents, retailPriceCents: item.priceCents,
      currency: "USD", quotedAt: new Date().toISOString()
    }
  };
}

async function getBalance() {
  throw makeError("USE_HEROSMS_ACCOUNT_API");
}

module.exports = { request, getCatalog, getBalance, buyNumber, buyRentalNumber, getActivation, getRentalStatus, setActivationStatus, quoteProduct, countryIsoFromName };
