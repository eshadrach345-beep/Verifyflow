"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const pages = [
  "index.html", "dashboard.html", "account.html", "admin.html", "admin-login.html",
  "faq.html", "terms.html", "privacy.html", "acceptable-use.html",
  "forgot-password.html", "verify-email.html", "reset-password.html", "payment-return.html"
];
for (const page of pages) {
  const html = fs.readFileSync(page, "utf8");
  assert.ok(html.includes('href="/premium.css"'), page + " must load the shared premium theme");
}

const theme = fs.readFileSync("premium.css", "utf8");
assert.ok(theme.includes("--vf-bg:#070d16"), "Theme must use the deep midnight surface");
assert.ok(theme.includes("--vf-accent:#8de0cc"), "Theme must use the restrained mint accent");
assert.ok(theme.includes(".vf-checkout-dialog"), "Checkout modal must use the shared theme");
assert.ok(theme.includes(".admin-shell"), "Admin workspace must use the shared theme");
assert.ok(theme.includes(".account-page"), "Customer account must use the shared theme");
assert.equal((theme.match(/{/g) || []).length, (theme.match(/}/g) || []).length, "Theme CSS braces must balance");

const checkout = fs.readFileSync("dashboard-checkout.js", "utf8");
assert.equal(checkout.includes('document.createElement("style")'), false, "Checkout must not inject a second visual theme");
assert.ok(checkout.includes('class="vf-checkout-dialog"'), "Checkout must retain its accessible payment dialog");
console.log("Premium theme tests passed (shared pages, checkout, account and admin styling).");
