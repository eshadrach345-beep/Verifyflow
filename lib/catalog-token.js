"use strict";

const { createCipheriv, createDecipheriv, createHash, randomBytes } = require("node:crypto");

const VERSION = "vf1";
const ALLOWED_PROVIDERS = new Set(["voidmob", "herosms"]);
const ALLOWED_TYPES = new Set(["sms_otp", "long_term_number", "esim", "mobile_proxy", "dedicated_number"]);

function tokenKey() {
  const secret = String(
    process.env.VERIFYFLOW_CATALOG_TOKEN_SECRET ||
    process.env.DATABASE_URL ||
    [process.env.VOIDMOB_API_KEY, process.env.HEROSMS_RETAIL_API_KEY || process.env.HEROSMS_API_KEY].filter(Boolean).join("|")
  );
  if (!secret) {
    const error = new Error("Catalogue token signing is not configured.");
    error.code = "CATALOG_TOKEN_SECRET_MISSING";
    throw error;
  }
  return createHash("sha256")
    .update("verifyflow/catalog-token/v1\0")
    .update(secret)
    .digest();
}

function validateSelection(selection) {
  if (!selection || typeof selection !== "object" ||
      selection.v !== 1 ||
      !ALLOWED_PROVIDERS.has(String(selection.provider || "")) ||
      !ALLOWED_TYPES.has(String(selection.productType || "")) ||
      typeof selection.productId !== "string" ||
      !selection.productId.trim() ||
      selection.productId.length > 160 ||
      !/^[a-z]{2}$/.test(String(selection.country || ""))) {
    const error = new Error("Refresh the catalogue and choose a valid product.");
    error.code = "INVALID_CATALOG_SELECTION";
    error.status = 400;
    throw error;
  }
  return {
    provider: selection.provider,
    productType: selection.productType,
    productId: selection.productId,
    country: selection.country
  };
}

function sealCatalogProductToken(input) {
  const selection = validateSelection({ ...input, v: 1 });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ v: 1, ...selection }), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url")
  ].join(".");
}

function openCatalogProductToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    const error = new Error("Refresh the catalogue and choose a valid product.");
    error.code = "INVALID_CATALOG_SELECTION";
    error.status = 400;
    throw error;
  }
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");
    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length || ciphertext.length > 2048) {
      throw new Error("Invalid token shape");
    }
    const decipher = createDecipheriv("aes-256-gcm", tokenKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return validateSelection(JSON.parse(plaintext));
  } catch {
    const error = new Error("This product selection is no longer valid. Refresh the catalogue and try again.");
    error.code = "INVALID_CATALOG_SELECTION";
    error.status = 400;
    throw error;
  }
}

module.exports = { sealCatalogProductToken, openCatalogProductToken };
