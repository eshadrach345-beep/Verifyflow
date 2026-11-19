"use strict";

const { createHash } = require("node:crypto");
const { getPool, sendJson } = require("./auth");

let lastPruneAt = 0;

function makeBucketKey(scope, identifier, pepper = process.env.VERIFYFLOW_RATE_LIMIT_PEPPER || "verifyflow-auth-rate-limit-v1") {
  const normalizedScope = String(scope || "").trim().toLowerCase();
  const normalizedIdentifier = String(identifier || "").trim().toLowerCase();
  if (!normalizedScope || !normalizedIdentifier) {
    throw new Error("A rate-limit scope and identifier are required.");
  }
  return createHash("sha256")
    .update(normalizedScope + ":" + normalizedIdentifier + ":" + String(pepper))
    .digest("hex");
}

function getClientAddress(req) {
  const headers = req?.headers || {};
  const forwarded = headers["x-forwarded-for"] || headers["x-real-ip"] || "";
  const address = String(forwarded).split(",")[0].trim();
  return address && address.length <= 128 ? address : "";
}

async function consumeRateLimit(db, options, pepper) {
  const {
    scope, identifier, limit, windowSeconds
  } = options || {};
  if (!Number.isInteger(limit) || limit < 1 ||
      !Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new Error("Invalid rate-limit configuration.");
  }

  const key = makeBucketKey(scope, identifier, pepper);
  const result = await db.query(
    "INSERT INTO vf_auth_rate_limits (bucket_key, window_started_at, attempts, updated_at) " +
    "VALUES ($1, NOW(), 1, NOW()) " +
    "ON CONFLICT (bucket_key) DO UPDATE SET " +
    "window_started_at = CASE " +
    "WHEN vf_auth_rate_limits.window_started_at <= NOW() - ($2::int * INTERVAL '1 second') " +
    "THEN NOW() ELSE vf_auth_rate_limits.window_started_at END, " +
    "attempts = CASE " +
    "WHEN vf_auth_rate_limits.window_started_at <= NOW() - ($2::int * INTERVAL '1 second') " +
    "THEN 1 ELSE vf_auth_rate_limits.attempts + 1 END, " +
    "updated_at = NOW() " +
    "RETURNING attempts, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (" +
    "window_started_at + ($2::int * INTERVAL '1 second') - NOW()))))::int AS retry_after_seconds",
    [key, windowSeconds]
  );

  const row = result.rows[0];
  if (!row) throw new Error("Rate-limit state could not be saved.");
  return {
    allowed: Number(row.attempts) <= limit,
    attempts: Number(row.attempts),
    retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds) || windowSeconds)
  };
}

async function enforceAuthRateLimit(req, res, options) {
  const db = getPool();
  const address = getClientAddress(req);
  const checks = [];

  if (address) {
    checks.push(consumeRateLimit(db, {
      scope: "auth:" + options.scope + ":ip",
      identifier: address,
      limit: options.ipLimit,
      windowSeconds: options.windowSeconds
    }));
  }

  checks.push(consumeRateLimit(db, {
    scope: "auth:" + options.scope + ":identity",
    identifier: options.identifier,
    limit: options.identityLimit,
    windowSeconds: options.windowSeconds
  }));

  const results = await Promise.all(checks);
  const blocked = results.filter(result => !result.allowed);
  if (!blocked.length) return false;

  const retryAfter = Math.max(...blocked.map(result => result.retryAfterSeconds));
  res.setHeader("Retry-After", String(retryAfter));
  sendJson(res, 429, {
    ok: false,
    error: "Too many attempts. Please wait before trying again."
  });
  return true;
}

async function pruneExpiredRateLimits(db = getPool()) {
  const now = Date.now();
  if (now - lastPruneAt < 10 * 60 * 1000) return;
  lastPruneAt = now;
  await db.query(
    "DELETE FROM vf_auth_rate_limits WHERE updated_at < NOW() - INTERVAL '48 hours'"
  );
}

module.exports = {
  makeBucketKey,
  getClientAddress,
  consumeRateLimit,
  enforceAuthRateLimit,
  pruneExpiredRateLimits
};
