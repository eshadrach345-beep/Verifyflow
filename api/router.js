"use strict";

// One fixed Vercel Function handles every API route.
// vercel.json rewrites /api/<route> to /api/router?route=<route>.
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
  "payments/webhook": require("../api-handlers/payments/webhook")
};

module.exports = async function handler(req, res) {
  const requestUrl = new URL(String(req.url || "/"), "https://verifyflow.invalid");
  const rewrittenRoute = requestUrl.searchParams.get("route");
  const pathname = String(rewrittenRoute || requestUrl.pathname.replace(/^\/api\/?/, ""))
    .replace(/^\/+|\/+$/g, "");
  const route = routes[pathname];

  if (!route) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: "API route not found." }));
  }

  return route(req, res);
};
