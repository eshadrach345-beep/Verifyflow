"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const home = fs.readFileSync("index.html", "utf8");
const dashboard = fs.readFileSync("dashboard.html", "utf8");
const checkout = fs.readFileSync("dashboard-checkout.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const premium = fs.readFileSync("premium.css", "utf8");
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
const walletMigration = fs.readFileSync("db/migrations/008_wallet_ledger.sql", "utf8");
const walletLibrary = fs.readFileSync("lib/wallet.js", "utf8");
const walletApi = fs.readFileSync("api-handlers/wallet/index.js", "utf8");
const walletDepositApi = fs.readFileSync("api-handlers/wallet/deposit.js", "utf8");
const walletAccount = fs.readFileSync("wallet-account.js", "utf8");
const paymentService = fs.readFileSync("lib/payment-service.js", "utf8");
const paymentWebhook = fs.readFileSync("api-handlers/payments/webhook.js", "utf8");
const fulfilment = fs.readFileSync("lib/fulfilment.js", "utf8");
const proxyCatalog = fs.readFileSync("api-handlers/catalog.js", "utf8");
const proxySupplier = fs.readFileSync("lib/voidmob.js", "utf8");
const accountPage = fs.readFileSync("account.html", "utf8");

const categories = ["sms", "rentals", "dedicated", "esim", "proxies", "marketing"];

// The homepage category links must land on the live catalogue filter.
for (const category of categories) {
  assert.ok(home.includes("/dashboard.html?category=" + category + "#catalogue"),
    "Homepage must link to the " + category + " catalogue category");
  assert.ok(dashboard.includes('data-catalog-tab="' + category + '"'),
    "Dashboard must expose the " + category + " category tab");
}
assert.ok(dashboard.includes('data-catalog-tab="all"'), "Dashboard must expose All products");
assert.ok(dashboard.includes("const dedupeProducts=") && dashboard.includes("priceOf(item)>previous.price"),
  "The customer catalogue must remove duplicate listings while retaining the highest retail price");
assert.ok(dashboard.includes('data-vf-card-open') && checkout.includes('event.target.closest("[data-vf-card-open]")'),
  "Every product card must have a working Choose options action");
assert.ok(dashboard.includes('id="vf-category-backdrop"') && dashboard.includes('role="dialog"') &&
  dashboard.includes('aria-modal="true"') && dashboard.includes('document.body.classList.add("vf-category-open")'),
  "Dashboard All products navigation must open a real accessible off-canvas side drawer");
assert.ok(checkout.includes("Preparing secure options for this service") && checkout.includes("openBuyDialog"),
  "A card selected while checkout controls are loading must retry until options are ready");
assert.ok(dashboard.includes("www.google.com/s2/favicons"), "Recognised services must use real service-logo images");
assert.ok(dashboard.includes("categoryLogoFor") && dashboard.includes("data-fallback"), "Every catalogue card must have an illustrated image fallback");
assert.ok(dashboard.includes("catalog-brand-logo"), "Product cards must render image assets rather than text-only icons");
assert.ok(dashboard.includes('params.get("search")'), "Dashboard must hydrate search from the URL");

// The homepage All services control must open a real category menu rather than act as an anchor.
assert.match(home, /<button[^>]*id="vf-services-trigger"[^>]*aria-controls="vf-services-menu"/);
assert.ok(home.includes('id="vf-services-menu"'), "Homepage must contain the All services menu panel");
assert.ok(home.includes("off-canvas drawer"), "Homepage must wire the All services side drawer");
assert.ok(home.includes('id="vf-services-backdrop"') && home.includes('role="dialog"'), "All services drawer must include its modal panel and backdrop");
assert.ok(home.includes('event.key === "Escape"') && home.includes('event.key === "Tab"'), "All services drawer must support Escape and keyboard focus handling");
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
assert.ok(dashboard.includes('category==="marketing"') && dashboard.includes('pricePer1000Minor') && dashboard.includes('priceA-priceB'),
  "Social Media Boosters must sort by ascending customer retail price after every catalogue load");
assert.ok(adminSmm.includes("orderedProducts") && adminSmm.includes("retailRateMinorPer1000"),
  "Admin SMM product list must automatically sort imported products from cheapest to most expensive");

assert.ok(dashboard.includes('active==="all"?categoryKeys:[active]'),
  "Global search must query all catalogue categories");

// Search results need an explicit category and supplier-aware product key.
// Checkout resolves a card back to that exact category/product pair.
assert.ok(dashboard.includes('data-product-category="'), "Catalogue cards must carry their category");
assert.ok(dashboard.includes('data-product-key="'), "Catalogue cards must carry a stable product key");
assert.ok(checkout.includes('card.dataset.productCategory'), "Checkout must read the rendered card category");
assert.ok(checkout.includes('card.dataset.productKey'), "Checkout must resolve the rendered card product key");
assert.ok(dashboard.includes("return String(base);") && !dashboard.includes("item.provider||item.providerLabel"),
  "Customer catalogue selection keys must not expose supplier routing");
assert.ok(checkout.includes("card.dataset.productKey"), "Checkout must resolve opaque product selection tokens");
assert.ok(!checkout.includes("selected.provider") && !checkout.includes("selected.country"),
  "Customer checkout requests must not submit supplier routing details");
assert.ok(fs.readFileSync("api-handlers/catalog.js", "utf8").includes("sealCatalogProductToken"),
  "Public supplier catalogue IDs must be encrypted before they reach the customer");
assert.ok(fs.readFileSync("api-handlers/orders/create.js", "utf8").includes("openCatalogProductToken"),
  "Checkout must validate and resolve encrypted catalogue selections on the server");
assert.ok(checkout.includes('visibleRows(category)'), "Checkout must search within the card's original category");

assert.ok(dashboard.includes('id="catalog-country"') && dashboard.includes("populateCountryOptions(data.countries)"),
  "Country selector must be populated from the supported country catalogue");
assert.ok(dashboard.includes('"whatsapp","telegram","gmail"') && dashboard.includes('["sms","rentals"].includes(category)'),
  "Long-term rentals and SMS products must sort with popular services first");
assert.ok(checkout.includes("data-rental-selected-price") && dashboard.includes("Choose your rental period"), "Rental product cards must explain period selection");
assert.ok(checkout.includes("data-rental-selected-price") && checkout.includes("updateRentalPrice"),
  "Rental card price must update immediately when its period is changed");
assert.ok(dashboard.includes("private phone number reserved for your use") &&
  dashboard.includes("Receive a one-time SMS code") &&
  dashboard.includes("unlocked, eSIM-compatible") &&
  dashboard.includes("Shared mobile proxy") ,
  "All catalogue product families must have practical customer-facing descriptions");
assert.ok(proxyCatalog.includes("pricePerGbCents") && proxyCatalog.includes("Number(plan.data_gb)"),
  "Shared mobile proxy catalogue must expose a derived per-GB price");
assert.ok(dashboard.includes("Unlimited traffic") && dashboard.includes("unmetered · per "),
  "Dedicated proxy terms must not be presented as shared data packages");
assert.ok(dashboard.includes("groupProxyPlanRows") && dashboard.includes("pricePerGbCents") && dashboard.includes("durationOptions"), "Shared mobile proxy cards must show per-GB pricing and actual supplier duration tiers");
assert.ok(dashboard.includes('"PRICE PER GB · "') && dashboard.includes('data-proxy-metered="true"') &&
  checkout.includes('"PER GB · "') && checkout.includes('Choose data package') &&
  premium.includes('data-proxy-metered="true"] .catalog-price-row strong::after'),
  "Shared mobile proxies must present per-GB prices, volume choices and live package totals");
assert.ok(dashboard.includes('replace(/\\b\\d+(?:\\.\\d+)?\\s*(?:gb|gigabytes?)\\b/g," ")') &&
  dashboard.includes("pricePerDayCents") && dashboard.includes('discountUnit=shared?"per GB":"per day"'),
  "Shared volume tiers and dedicated daily/weekly/monthly plans must group separately with accurate discount units");
assert.ok(checkout.includes("data-proxy-duration") && checkout.includes("Choose rental period") &&
  checkout.includes("Save " + "' + esc(option.discountPercent) + (shared ? '% per GB' : '% per day')") &&
  checkout.includes("pricePerDayCents"),
  "Proxy selector must show volume discounts for shared packages and per-day savings for dedicated rental durations");
assert.ok(checkout.includes("activateServiceCard"), "Full service-card clicks must open the configured product options");
assert.ok(proxyCatalog.includes("Math.min(configuredPercent, 18)") &&
  proxySupplier.includes("Math.min(requestedPercent, 18)"),
  "Proxy quote and catalogue retail margins must both be capped at a competitive 18 percent");
assert.ok(walletMigration.includes("CREATE TABLE IF NOT EXISTS vf_wallet_accounts") &&
  walletMigration.includes("CREATE TABLE IF NOT EXISTS vf_wallet_transactions") &&
  walletMigration.includes("CREATE TABLE IF NOT EXISTS vf_wallet_topups"),
  "Wallet migration must create balance, immutable ledger and Monnify deposit records");
assert.ok(walletLibrary.includes("ON CONFLICT (user_id, reference_type, reference_id) DO NOTHING") &&
  walletLibrary.includes("refundFailedOrder"),
  "Wallet ledger must be idempotent and expose failed-order refunds");
assert.ok(walletApi.includes("getSessionUser") && walletApi.includes("vf_wallet_transactions"),
  "Wallet balance and history must be restricted to the signed-in customer");
assert.ok(walletDepositApi.includes("getCheckoutAmount") && walletDepositApi.includes("initializeTransaction"),
  "Wallet deposits must use configured currency conversion and Monnify hosted checkout");
assert.ok(walletAccount.includes("/api/wallet/deposit") && walletAccount.includes("amountUsdCents"),
  "Account wallet panel must fund the wallet through the protected deposit API");
assert.ok(accountPage.includes('id="panel-wallet"') && accountPage.includes('data-panel="wallet"'),
  "Customer account must expose a wallet panel");
assert.ok(accountPage.includes('id="account-welcome-toast"') && accountPage.includes('showWelcomeToast(user)') && accountPage.includes('5000);'), "Account welcome message must appear as a five-second popup");
assert.ok(paymentService.includes("verifyAndApplyWalletDeposit") &&
  paymentService.includes("postWalletTransaction") &&
  paymentWebhook.includes("verifyAndApplyWalletDeposit"),
  "Wallet top-ups must be credited only after server-side Monnify verification");
assert.ok(orderCreate.includes('paymentMethod === "wallet"') &&
  orderCreate.includes("createWalletOrder") &&
  checkout.includes('value="wallet"') &&
  checkout.includes('value="monnify"'),
  "Checkout must support either wallet balance or Monnify");
assert.ok(fulfilment.includes("refundFailedOrder") &&
  fulfilment.includes("wallet_refund_credited") &&
  fulfilment.includes('failedStatuses.includes(status)'),
  "Confirmed failed or refunded supplier orders across service types must be returned to the wallet");


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
assert.ok(admin.includes('id="orders-panel"') && admin.includes('id="supplier-connections-panel"') && admin.includes('id="supplier-connections-content"') && admin.includes('id="customer-support-inbox"'), "Admin workspace navigation targets must exist");
assert.ok(admin.includes('id="fulfilment-queue-panel"') && admin.includes('id="fulfilment-queue-body"'), "Admin fulfilment section and table body IDs must be distinct");
assert.ok(admin.includes('/admin.css') && admin.includes('admin-stat-orders'), "Admin must load its own readable stylesheet and order overview");
assert.ok(adminSmm.includes('fetch("/api/admin/smm-products"'), "Admin must save products through the protected API");
assert.ok(adminSmm.includes("Save and publish product"), "Admin must provide an explicit publish action");
assert.ok(adminSmm.includes("Database setup required"), "Admin must disable publishing until the SMM product table exists");
assert.ok(admin.includes("smm-select-all") && admin.includes("smm-select-visible") && admin.includes("smm-service-list"), "Admin must support selecting the full or filtered supplier catalogue");
assert.ok(admin.includes('id="smm-select-all-top"') && adminSmm.includes('selectAllTop?.addEventListener("click", selectAllServices)'),
  "Admin must expose a visible top-level Select All control that selects the currently chosen supplier catalogue");
assert.ok(!admin.includes('href="/premium.css"') && fs.readFileSync("admin.css", "utf8").includes("high-contrast light operations workspace"),
  "Admin must use its dedicated high-contrast workspace styles instead of the storefront dark theme");
assert.ok(admin.includes("smm-markup-percent"), "Admin must accept a percentage markup instead of a fixed retail price");
assert.ok(adminSmm.includes("action: \"bulk\"") && adminSmm.includes("selectedServices"), "Admin must bulk publish the selected supplier services");
assert.ok(smmAdminApi.includes("jsonb_to_recordset") && smmAdminApi.includes("markupPercent"), "Admin API must calculate and save bulk retail prices from percentage markup");
assert.ok(smmAdminApi.includes('body.action === "deduplicate"') && smmAdminApi.includes("ORDER BY retail_rate_minor_per_1000 DESC") && smmAdminApi.includes("r.duplicate_rank > 1"), "Duplicate cleanup must soft-hide lower-priced matching listings and keep the highest-priced version");
assert.ok(adminSmm.includes('JSON.stringify({ action: "deduplicate" })') && adminSmm.includes("highest-priced version"), "Admin product manager must run and report duplicate product cleanup");
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
