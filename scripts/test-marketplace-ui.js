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
assert.ok(dashboard.includes("www.google.com/s2/favicons"), "Recognised services must use real service-logo images");
assert.ok(dashboard.includes("categoryLogoFor") && dashboard.includes("data-fallback"), "Every catalogue card must have an illustrated image fallback");
assert.ok(dashboard.includes("catalog-brand-logo"), "Product cards must render image assets rather than text-only icons");
assert.ok(dashboard.includes('params.get("search")'), "Dashboard must hydrate search from the URL");

// The homepage All services control must open a real category menu rather than act as an anchor.
assert.match(home, /<button[^>]*id="vf-services-trigger"[^>]*aria-controls="vf-services-menu"/);
assert.ok(home.includes('id="vf-services-menu"'), "Homepage must contain the All services menu panel");
assert.ok(home.includes("Accessible All services disclosure"), "Homepage must wire menu open/close behavior");
for (const category of categories) {
  assert.ok(home.includes('/dashboard.html?category=' + category + '#catalogue'),
    "All services menu must link to the " + category + " catalogue");
}
assert.ok(home.includes('id="home-smm-grid"'), "Homepage must visibly reserve a Social Media Boosters product section");
assert.ok(home.includes('/api/marketing-catalog'), "Homepage must load published public SMM products");
assert.ok(home.includes("No Social Media Boosters have been published yet."),
  "Homepage must explain when no SMM products are published");
assert.ok(dashboard.includes('data-nav-category="marketing"'),
  "Dashboard top navigation must expose Social Media Boosters");
assert.ok(dashboard.includes("No Social Media Boosters are published yet."),
  "Dashboard must explain an empty SMM catalogue");
assert.ok(dashboard.includes("SMM product database migration may need to be applied"),
  "Dashboard must surface a clear SMM catalogue setup hint");

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
assert.ok(admin.includes('class="admin-workspace-nav"') && admin.includes('href="#smm-products-manager"'), "Admin must provide direct navigation to product management");
assert.ok(admin.includes("＋ Add or edit products"), "Admin must surface a prominent add/edit products action");
assert.ok(admin.indexOf('id="smm-products-manager"') < admin.indexOf('id="launch-readiness"'), "Product manager must appear before the long launch-readiness report");
assert.ok(admin.includes('id="orders-panel"') && admin.includes('id="supplier-connections"') && admin.includes('id="customer-support-inbox"'), "Admin workspace navigation targets must exist");
assert.ok(adminSmm.includes('fetch("/api/admin/smm-products"'), "Admin must save products through the protected API");
assert.ok(adminSmm.includes("Save and publish product"), "Admin must provide an explicit publish action");
assert.ok(adminSmm.includes("Database setup required"), "Admin must disable publishing until the SMM product table exists");
assert.ok(admin.includes("smm-select-all") && admin.includes("smm-service-list"), "Admin must support selecting all supplier services for bulk publishing");
assert.ok(admin.includes("smm-markup-percent"), "Admin must accept a percentage markup instead of a fixed retail price");
assert.ok(adminSmm.includes("action: \"bulk\"") && adminSmm.includes("selectedServices"), "Admin must bulk publish the selected supplier services");
assert.ok(smmAdminApi.includes("jsonb_to_recordset") && smmAdminApi.includes("markupPercent"), "Admin API must calculate and save bulk retail prices from percentage markup");
assert.ok(smmAdminApi.includes("readProvider(provider)"), "Admin must validate chosen supplier service IDs");
assert.ok(smmAdminApi.includes("retail_rate_minor_per_1000"), "Admin must persist a retail rate per 1,000");
assert.ok(smmAdminApi.includes("productsTableReady"), "Admin must report whether the SMM product table is installed");
assert.ok(smmAdminApi.includes('error.code !== "42P01"'), "Missing SMM table must be handled without hiding supplier catalogues");
assert.ok(smmAdminApi.includes("productsMessage"), "Admin must explain when the SMM database migration is missing");
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
