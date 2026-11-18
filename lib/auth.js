const { Pool } = require("pg");
const {
  randomBytes,
  createHash,
  scrypt: scryptCallback,
  timingSafeEqual
} = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = "vf_session";
const SESSION_DAYS = 30;
let pool;

function getPool() {
  if (!process.env.DATABASE_URL) {
    const error = new Error("Database unavailable");
    error.code = "DATABASE_NOT_CONFIGURED";
    throw error;
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 4,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 8000,
      application_name: "verifyflow-customer-api"
    });
  }
  return pool;
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

function readCookie(req, name) {
  const header = String(req.headers.cookie || "");
  const match = header.match(new RegExp("(?:^|;\\s*)" + name + "=([a-f0-9]{64})(?:;|$)"));
  return match ? match[1] : null;
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function cookieOptions(maxAge) {
  const secure = process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "";
  return SESSION_COOKIE + "=" + (maxAge ? maxAge.token : "") +
    "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + (maxAge ? maxAge.seconds : 0) + secure;
}

async function issueSession(db, userId, res) {
  const token = randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO vf_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')",
    [userId, hashToken(token)]
  );
  const secure = process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", SESSION_COOKIE + "=" + token +
    "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + (SESSION_DAYS * 86400) + secure);
}

function clearSessionCookie(res) {
  const secure = process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", SESSION_COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" + secure);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  try {
    return host && new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 16384) throw new Error("Request too large");
  }
  if (!raw) return {};
  return JSON.parse(raw);
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, {
    N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024
  });
  return "scrypt$16384$8$1$" + salt.toString("base64") + "$" + derived.toString("base64");
}

async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt" ||
      parts[1] !== "16384" || parts[2] !== "8" || parts[3] !== "1") return false;
  try {
    const salt = Buffer.from(parts[4], "base64");
    const expected = Buffer.from(parts[5], "base64");
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = await scrypt(password, salt, expected.length, {
      N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function getSessionUser(req) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const result = await getPool().query(
    `SELECT u.id, u.email, u.full_name, u.created_at
       FROM vf_sessions s
       JOIN vf_users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > NOW()
        AND u.status = 'active'
      LIMIT 1`,
    [hashToken(token)]
  );
  if (!result.rowCount) return null;
  return result.rows[0];
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    createdAt: user.created_at
  };
}

module.exports = {
  getPool,
  sendJson,
  readJson,
  sameOrigin,
  hashPassword,
  verifyPassword,
  issueSession,
  clearSessionCookie,
  readCookie,
  hashToken,
  getSessionUser,
  publicUser
};
