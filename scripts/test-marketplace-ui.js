"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const home = fs.readFileSync("index.html", "utf8");
const dashboard = fs.readFileSync("dashboard.html", "utf8");
const checkout = fs.readFileSync("dashboard-checkout.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const robots = fs.readFileSync("robots.txt", "utf8");
const sitemap = fs.readFileSync("sitemap.xml", "utf8");
const admin = fs.readFileSync("admin.html", "utf8");
const adminSmm = fs.readFileSync("admin-smm-products.js", "utf8");
const ordersApi = fs.readFileSync("api-handlers/orders.js", "utf8");
const accessApi = fs.readFileSync("api-handlers/admin/access.js", "utf8");
const smmAdminApi = fs.readFileSync("api-handlers/admin/smm-products.js", "utf8");
const smmSupplier = fs.readFileSync("lib/smm-service.js", "utf8");
const orderCreate = fs.readFileSync("api-handlers/orders/create.js", "utf8");
const migration = fs.readFileSync("db/migrations/006_smm_product_manager.sql", "utf8");

const categories = ["sms", "rentals", "dedicated", "esim", "proxies", "marketing"];

// The homepage category links must land on the live catalogue filter.
for (const category of categories) {
  assert.ok(home.includes("/dashboard.html?category=" + category + "#catalogue"),
    "Homepage must link to the " + category + " catalogue category");
  assert.ok(dashboard.includes('data-catalog-tab="' + category + '"'),
    "Dashboard must expose the " + category + " category tab");
}
assert.ok(dashboard.includes('data-catalog-tab="all"'), "Dashboard must expose All products");
assert.ok(dashboard.includes('params.get("search")'), "Dashboard must hydrate search from the URL");
assert.ok(dashboard.includes('active==="all"?categoryKeys:[active]'),
  "Global search must query all catalogue categories");

// Search results need an explicit category and supplier-aware product key.
// Checkout resolves a card back to that exact category/product pair.
assert.ok(dashboard.includes('data-product-category="'), "Catalogue cards must carry their category");
assert.ok(dashboard.includes('data-product-key="'), "Catalogue cards must carry a stable product key");
assert.ok(checkout.includes('card.dataset.productCategory'), "Checkout must read the rendered card category");
assert.ok(checkout.includes('card.dataset.productKey'), "Checkout must resolve the rendered card product key");
assert.ok(checkout.includes('row.provider||row.providerLabel||""'),
  "Checkout matching must distinguish supplier rows sharing a product identifier");
assert.ok(checkout.includes('visibleRows(category)'), "Checkout must search within the card's original category");

assert.ok(!dashboard.includes('String(x.provider||"Supplier").toUpperCase()'), "Customer dashboard must not display supplier names");
assert.ok(!dashboard.includes('String(x.provider||"supplier").toUpperCase()'), "Customer dashboard price labels must not display supplier names");
assert.ok(!dashboard.includes("supplierCoverage"), "Public dashboard must not read supplier connection metadata");
assert.ok(!home.includes("connected suppliers"), "Homepage must not expose supplier relationships");
assert.ok(ordersApi.includes("supplier_order_id") === false, "Customer order API must not return supplier order identifiers");
assert.ok(ordersApi.includes("product_snapshot") === false, "Customer order API must not return internal supplier product snapshots");
assert.ok(accessApi.includes("VERIFYFLOW_ADMIN_EMAILS"), "Admin access must be checked on the server");
assert.ok(admin.includes("/api/admin/access"), "Admin page must check authorization before showing its interface");

assert.ok(admin.includes("Social Media Boosters — Product Manager"), "Admin must expose SMM product management");
assert.ok(admin.includes('id="smm-product-form"'), "Admin must contain the product publishing form");
assert.ok(adminSmm.includes('fetch("/api/admin/smm-products"'), "Admin must save products through the protected API");
assert.ok(adminSmm.includes("Save and publish product"), "Admin must provide an explicit publish action");
assert.ok(smmAdminApi.includes("readProvider(provider)"), "Admin must validate chosen supplier service IDs");
assert.ok(smmAdminApi.includes("retail_rate_minor_per_1000"), "Admin must persist a retail rate per 1,000");
assert.ok(smmSupplier.includes('action: "add"') && smmSupplier.includes('action: "status"'), "SMM supplier orders and status must be wired");
assert.ok(orderCreate.includes("FROM vf_smm_products WHERE id = $1 AND is_active = TRUE"), "Checkout must quote saved active product records");
assert.ok(orderCreate.includes("supplier_service_id"), "Checkout must use the owner-selected supplier service ID");
assert.ok(checkout.includes("data-smm-link") && checkout.includes("data-smm-quantity"), "Storefront SMM products must collect destination URL and quantity");
assert.ok(migration.includes("CREATE TABLE IF NOT EXISTS vf_smm_products"), "Database migration must create the saved product table");
assert.ok(migration.includes("'peakerr', 'justanotherpanel'"), "Orders and fulfilment must allow both SMM suppliers");

// The landing page needs indexable metadata and valid structured data.
assert.match(home, /<title>VerifyFlow[^<]+<\/title>/i);
assert.match(home, /<meta name="description" content="[^"]+"/i);
assert.match(home, /<link rel="canonical" href="https:\/\/verifyflow\.us\.ci\/">/i);
const jsonLd = home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
assert.ok(jsonLd, "Homepage must contain JSON-LD");
const structuredData = JSON.parse(jsonLd[1]);
assert.ok(structuredData["@graph"].some(node => node["@type"] === "WebSite"));
assert.ok(structuredData["@graph"].some(node => node["@type"] === "Organization"));

// The carousel and card layouts must remain responsive and compact on mobile.
assert.match(styles, /\.spotlight-slide\{min-height:286px\}/);
assert.match(styles, /\.marketplace-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.match(styles, /@media\(max-width:700px\)[\s\S]*?\.marketplace-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(dashboard, /\.catalog-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
assert.match(dashboard, /@media\(max-width:600px\)[\s\S]*?\.catalog-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);

assert.ok(robots.includes("Sitemap: https://verifyflow.us.ci/sitemap.xml"));
assert.ok(sitemap.includes("<loc>https://verifyflow.us.ci/</loc>"));
assert.ok(sitemap.includes("<loc>https://verifyflow.us.ci/dashboard.html</loc>"));

console.log("VerifyFlow marketplace, SMM product manager, supplier order wiring and SEO checks passed.");
