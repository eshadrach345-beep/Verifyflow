"use strict";

// One Vercel function handles every API path. vercel.json rewrites /api/*
// to /api?path=... so nested endpoints do not depend on platform catch-all routing.
const routes = {
  "account/profile": require("../api-handlers/account/profile"),
  "admin/access": require("../api-handlers/admin/access"),
  "admin/fulfilment": require("../api-handlers/admin/fulfilment"),
  "admin/orders": require("../api-handlers/admin/orders"),
  "admin/payments": require("../api-handlers/admin/payments"),
  "admin/readiness": require("../api-handlers/admin/readiness"),
  "admin/suppliers": require("../api-handlers/admin/suppliers"),
  "admin/smm-products": require("../api-handlers/admin/smm-products"),
  "admin/support": require("../api-handlers/support-chat"),
  "auth/login": require("../api-handlers/auth/login"),
  "auth/logout": require("../api-handlers/auth/logout"),
  "auth/me": require("../api-handlers/auth/me"),
  "auth/register": require("../api-handlers/auth/register"),
  "auth/request-password-reset": require("../api-handlers/auth/request-password-reset"),
  "auth/resend-verification": require("../api-handlers/auth/resend-verification"),
  "auth/reset-password": require("../api-handlers/auth/reset-password"),
  "auth/verify-email": require("../api-handlers/auth/verify-email"),
  "catalog": require("../api-handlers/catalog"),
  "marketing-catalog": require("../api-handlers/marketing-catalog"),
  "db-status": require("../api-handlers/db-status"),
  "health": require("../api-handlers/health"),
  "herosms/webhook": require("../api-handlers/herosms-webhook"),
  "herosms/offers": require("../api-handlers/herosms/offers"),
  "orders": require("../api-handlers/orders"),
  "orders/create": require("../api-handlers/orders/create"),
  "orders/refresh": require("../api-handlers/orders/refresh"),
  "support/chat": require("../api-handlers/support-chat"),
  "wallet": require("../api-handlers/wallet/index"),
  "wallet/deposit": require("../api-handlers/wallet/deposit"),
  "payments/create-test": require("../api-handlers/payments/create-test"),
  "payments/verify": require("../api-handlers/payments/verify"),
  "payments/webhook": require("../api-handlers/payments/webhook"),
  "payments/squad-webhook": require("../api-handlers/payments/squad-webhook")
};

module.exports = async function handler(req, res) {
  let route = "";
  if (req.query && req.query.path) {
    route = Array.isArray(req.query.path) ? req.query.path.join("/") : String(req.query.path);
  } else {
    try {
      const pathname = new URL(String(req.url || "/"), "https://verifyflow.invalid").pathname;
      route = pathname.replace(/^\/api\/?/, "").replace(/^\/+|\/+$/g, "");
    } catch {}
  }

  try { route = decodeURIComponent(route); } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: "Invalid API route." }));
  }
  const target = routes[route];
  if (!target) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: "API route not found." }));
  }
  return target(req, res);
};

// Preserve raw request bodies for signed provider webhooks; readJson handles ordinary API payloads.
module.exports.config = { api: { bodyParser: false } };
