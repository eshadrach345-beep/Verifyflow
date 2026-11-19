"use strict";

// Dedicated auth catch-all so nested /api/auth/* paths are routed reliably on Vercel.
const routes = {
  "login": require("../../api-handlers/auth/login"),
  "logout": require("../../api-handlers/auth/logout"),
  "me": require("../../api-handlers/auth/me"),
  "register": require("../../api-handlers/auth/register"),
  "request-password-reset": require("../../api-handlers/auth/request-password-reset"),
  "resend-verification": require("../../api-handlers/auth/resend-verification"),
  "reset-password": require("../../api-handlers/auth/reset-password"),
  "verify-email": require("../../api-handlers/auth/verify-email")
};

module.exports = async function handler(req, res) {
  let pathname = "/";
  try { pathname = new URL(String(req.url || "/"), "https://verifyflow.invalid").pathname; } catch {}
  let route = pathname.replace(/^\/api\/auth\/?/, "").replace(/^\/+|\/+$/g, "");
  if (!route && req.query && req.query.path) {
    route = Array.isArray(req.query.path) ? req.query.path.join("/") : String(req.query.path);
  }
  try { route = decodeURIComponent(route); } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: "Invalid authentication route." }));
  }
  const target = routes[route];
  if (!target) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: "Authentication route not found." }));
  }
  return target(req, res);
};
