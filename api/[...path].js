"use strict";

// Single Vercel function for every VerifyFlow API endpoint.
const routes = {
  "account/profile": require("../api-handlers/account/profile"),
  "admin/fulfilment": require("../api-handlers/admin/fulfilment"),
  "admin/orders": require("../api-handlers/admin/orders"),
  "admin/readiness": require("../api-handlers/admin/readiness"),
  "admin/suppliers": require("../api-handlers/admin/suppliers"),
  "auth/login": require("../api-handlers/auth/login"),
  "auth/logout": require("../api-handlers/auth/logout"),
  "auth/me": require("../api-handlers/auth/me"),
  "auth/register": require("../api-handlers/auth/register"),
  "auth/request-password-reset": require("../api-handlers/auth/request-password-reset"),
  "auth/resend-verification": require("../api-handlers/auth/resend-verification"),
  "auth/reset-password": require("../api-handlers/auth/reset-password"),
  "auth/verify-email": require("../api-handlers/auth/verify-email"),
  "catalog": require("../api-handlers/catalog"),
  "db-status": require("../api-handlers/db-status"),
  "health": require("../api-handlers/health"),
  "orders": require("../api-handlers/orders"),
  "orders/create": require("../api-handlers/orders/create"),
  "orders/refresh": require("../api-handlers/orders/refresh"),
  "payments/create-test": require("../api-handlers/payments/create-test"),
  "payments/verify": require("../api-handlers/payments/verify"),
  "payments/webhook": require("../api-handlers/payments/webhook"),
};

module.exports = async function handler(req, res) {
  let pathname = "/";
  try { pathname = new URL(String(req.url || "/"), "https://verifyflow.invalid").pathname; } catch {}
  let route = pathname.replace(/^\\/api\\/?/, "").replace(/^\\/+|\\/+$/g, "");
  if (!route && req.query && req.query.path) route = Array.isArray(req.query.path) ? req.query.path.join("/") : String(req.query.path);
  route = decodeURIComponent(route);
  const target = routes[route];
  if (!target) { res.statusCode = 404; res.setHeader("Content-Type", "application/json; charset=utf-8"); return res.end(JSON.stringify({ ok: false, error: "API route not found." })); }
  return target(req, res);
};
