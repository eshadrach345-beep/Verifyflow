"use strict";

const REQUIRED_MIGRATIONS = [
  "001_customer_accounts",
  "002_monnify_payments",
  "003_fulfilment_jobs",
  "004_checkout_idempotency",
  "005_auth_rate_limits",
  "006_smm_product_manager",
  "008_wallet_ledger",
  "009_wallet_smm_schema_repair"
];

const REQUIRED_TABLES = [
  "vf_users",
  "vf_customer_profiles",
  "vf_sessions",
  "vf_email_verification_tokens",
  "vf_password_reset_tokens",
  "vf_orders",
  "vf_order_events",
  "vf_payments",
  "vf_payment_webhook_events",
  "vf_fulfilment_jobs",
  "vf_auth_rate_limits",
  "vf_smm_products",
  "vf_wallet_accounts",
  "vf_wallet_transactions",
  "vf_wallet_topups"
];

function isTrue(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function hasValue(env, name) {
  return typeof env[name] === "string" && env[name].trim().length > 0;
}

function makeCheck(id, label, status, message, action, required = true) {
  return { id, label, status, message, action, required };
}

function buildLaunchChecks(env = process.env, database = {}) {
  const checks = [];
  const migrations = new Set(database.migrations || []);
  const tables = new Set(database.tables || []);
  const missingMigrations = REQUIRED_MIGRATIONS.filter(value => !migrations.has(value));
  const missingTables = REQUIRED_TABLES.filter(value => !tables.has(value));
  const dbConnected = database.connected === true;

  checks.push(makeCheck(
    "database",
    "Database connection",
    dbConnected ? "ready" : "needs_action",
    dbConnected ? "VerifyFlow connected to PostgreSQL during this check." : "The application could not confirm a database connection.",
    "Confirm DATABASE_URL is set on the VerifyFlow Vercel project and that the database allows connections."
  ));

  const schemaReady = dbConnected && missingMigrations.length === 0 && missingTables.length === 0;
  checks.push(makeCheck(
    "schema",
    "Database migrations",
    schemaReady ? "ready" : "needs_action",
    schemaReady
      ? "All required customer, payment and fulfilment tables were found."
      : "Database schema is incomplete. Missing migrations: " + (missingMigrations.join(", ") || "none") +
        ". Missing tables: " + (missingTables.join(", ") || "none") + ".",
    "Run npm run db:migrate against the VerifyFlow DATABASE_URL, then refresh this report."
  ));

  const adminConfigured = String(env.VERIFYFLOW_ADMIN_EMAILS || "")
    .split(",").some(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()));
  checks.push(makeCheck(
    "admin",
    "Admin access",
    adminConfigured ? "ready" : "needs_action",
    adminConfigured ? "At least one syntactically valid admin email is allowlisted." : "No valid admin email is configured.",
    "Set VERIFYFLOW_ADMIN_EMAILS to the exact email address used by your VerifyFlow admin account."
  ));

  const emailConfigured = hasValue(env, "RESEND_API_KEY") && hasValue(env, "VERIFYFLOW_EMAIL_FROM");
  checks.push(makeCheck(
    "email_security",
    "Email verification and account recovery",
    emailConfigured ? "review" : "needs_action",
    emailConfigured
      ? "Email API and sender variables are present. This check does not prove the sender domain is verified or that messages reach customer inboxes."
      : "Transactional email is not configured. New registrations remain unavailable until the sending credentials and sender address are added.",
    "Configure a Resend API key and a sender address on a domain you control, verify the domain with the provider, then test verification, resend and password-reset emails."
  ));

  const monnifyConfigured = [
    "MONNIFY_API_KEY", "MONNIFY_SECRET_KEY", "MONNIFY_CONTRACT_CODE"
  ].every(name => hasValue(env, name));
  checks.push(makeCheck(
    "monnify_credentials",
    "Monnify credentials",
    monnifyConfigured ? "review" : "needs_action",
    monnifyConfigured
      ? "The three server-side credential variables are present. This check does not authenticate them with Monnify."
      : "One or more required Monnify credential variables are missing.",
    "Set MONNIFY_API_KEY, MONNIFY_SECRET_KEY and MONNIFY_CONTRACT_CODE on the VerifyFlow project, then complete a sandbox checkout test."
  ));

  const usdEnabled = isTrue(env.MONNIFY_INTERNATIONAL_ENABLED);
  checks.push(makeCheck(
    "usd_checkout",
    "International USD checkout",
    usdEnabled ? "review" : "needs_action",
    usdEnabled
      ? "The USD checkout feature flag is enabled; merchant-account eligibility still needs confirmation in Monnify."
      : "USD international card checkout is still disabled.",
    "Enable USD international payments in the Monnify merchant account first. Only then set MONNIFY_INTERNATIONAL_ENABLED=true."
  ));

  const environment = String(env.MONNIFY_ENVIRONMENT || "SANDBOX").trim().toUpperCase();
  const liveApproved = environment === "LIVE" &&
    isTrue(env.MONNIFY_LIVE_ENABLED) &&
    isTrue(env.MONNIFY_PRODUCT_APPROVAL_CONFIRMED);
  checks.push(makeCheck(
    "monnify_live",
    "Monnify live approval",
    liveApproved ? "review" : "needs_action",
    liveApproved
      ? "Live-mode flags are set. Confirm the merchant approval and production credentials directly in Monnify."
      : "Payments are not in fully approved LIVE mode (current environment: " + environment + ").",
    "Keep SANDBOX during testing. Switch to LIVE only after Monnify has approved the business and product categories and supplied live credentials."
  ));

  const liveOrdersEnabled = isTrue(env.VERIFYFLOW_LIVE_ORDERS_ENABLED);
  checks.push(makeCheck(
    "live_orders",
    "Live order gate",
    liveOrdersEnabled ? "review" : "needs_action",
    liveOrdersEnabled
      ? "The live-order gate is enabled. Run final payment and fulfilment tests before accepting customers."
      : "Live customer orders are safely locked.",
    "Set VERIFYFLOW_LIVE_ORDERS_ENABLED=true only after every required launch check is complete."
  ));

  const voidmobConfigured = hasValue(env, "VOIDMOB_API_KEY");
  checks.push(makeCheck(
    "voidmob_key",
    "VoidMob supplier key",
    voidmobConfigured ? "review" : "needs_action",
    voidmobConfigured
      ? "The server-side VoidMob key is present. This check does not verify the key or supplier wallet balance."
      : "The VoidMob API key is missing.",
    "Set VOIDMOB_API_KEY in VerifyFlow and confirm the supplier account has sufficient funds and the intended product permissions."
  ));

  const autoBuyEnabled = isTrue(env.VOIDMOB_FULFILMENT_ENABLED) &&
    isTrue(env.VOIDMOB_AUTOBUY_CONFIRMED);
  checks.push(makeCheck(
    "voidmob_autobuy",
    "Supplier auto-fulfilment",
    autoBuyEnabled ? "review" : "needs_action",
    autoBuyEnabled
      ? "Both supplier purchase safeguards are enabled. Confirm spending caps and end-to-end tests before live orders."
      : "Automatic supplier purchasing is disabled, which is the safe default.",
    "Do not enable auto-fulfilment until test purchases, idempotency/reconciliation and supplier spending limits have been checked. Then set both VOIDMOB_FULFILMENT_ENABLED and VOIDMOB_AUTOBUY_CONFIRMED to true."
  ));

  const webhookConfirmed = isTrue(env.VERIFYFLOW_MONNIFY_WEBHOOK_CONFIRMED);
  checks.push(makeCheck(
    "webhook",
    "Monnify webhook",
    webhookConfirmed ? "review" : "needs_action",
    webhookConfirmed
      ? "The webhook confirmation flag is set; verify the exact production URL in the Monnify dashboard."
      : "The production webhook has not been marked as configured and tested.",
    "Configure https://verifyflow.us.ci/api/payments/webhook in Monnify and set VERIFYFLOW_MONNIFY_WEBHOOK_CONFIRMED=true only after a successful test."
  ));

  const businessName = hasValue(env, "VERIFYFLOW_LEGAL_BUSINESS_NAME");
  const businessAddress = hasValue(env, "VERIFYFLOW_BUSINESS_ADDRESS");
  checks.push(makeCheck(
    "business_identity",
    "Business identity",
    businessName && businessAddress ? "review" : "needs_action",
    businessName && businessAddress
      ? "Legal business name and business address variables are present. Check that they match the registered operating business."
      : "The legal business name or business address is missing.",
    "Set VERIFYFLOW_LEGAL_BUSINESS_NAME and VERIFYFLOW_BUSINESS_ADDRESS to the real operating-business details; do not use sample or invented details."
  ));

  const supportEmail = String(env.VERIFYFLOW_SUPPORT_EMAIL || "").trim();
  const validSupportEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail);
  checks.push(makeCheck(
    "support",
    "Customer support contact",
    validSupportEmail ? "review" : "needs_action",
    validSupportEmail ? "A support email is configured; confirm it is monitored." : "A valid customer support email is not configured.",
    "Set VERIFYFLOW_SUPPORT_EMAIL to an inbox that is actively monitored for order and refund requests."
  ));

  checks.push(makeCheck(
    "policies",
    "Terms and privacy review",
    isTrue(env.VERIFYFLOW_POLICIES_REVIEWED) ? "review" : "needs_action",
    isTrue(env.VERIFYFLOW_POLICIES_REVIEWED)
      ? "The policy-review confirmation flag is set. Confirm the published documents contain the actual business details and lawful terms."
      : "The published policy pages are still templates and have not been marked as reviewed.",
    "Have the Terms, Privacy Policy and Acceptable Use Policy reviewed for the operating business and each target market before setting VERIFYFLOW_POLICIES_REVIEWED=true."
  ));

  checks.push(makeCheck(
    "tax",
    "Tax and invoicing",
    isTrue(env.VERIFYFLOW_TAX_SETUP_CONFIRMED) ? "review" : "needs_action",
    isTrue(env.VERIFYFLOW_TAX_SETUP_CONFIRMED)
      ? "Tax setup is marked confirmed. Keep evidence of the applicable tax and invoicing treatment."
      : "Tax collection and invoicing arrangements have not been confirmed.",
    "Confirm registration, VAT/sales-tax treatment, invoice requirements and the checkout disclosure for every country you plan to serve before setting VERIFYFLOW_TAX_SETUP_CONFIRMED=true."
  ));

  checks.push(makeCheck(
    "refunds",
    "Refund operations",
    isTrue(env.VERIFYFLOW_REFUND_PROCESS_CONFIRMED) ? "review" : "needs_action",
    isTrue(env.VERIFYFLOW_REFUND_PROCESS_CONFIRMED)
      ? "A manual refund process is marked as documented. Automated refunds are not implemented."
      : "There is no confirmed operational refund process. Failed supplier orders may need a manual Monnify refund.",
    "Document who reviews failed/unknown orders, how refunds are approved and processed in Monnify, and how customers are notified. Then set VERIFYFLOW_REFUND_PROCESS_CONFIRMED=true."
  ));

  for (const [id, label, envName, fulfilmentEnv, confirmEnv] of [
    ["peakerr", "Peakerr supplier connection", "PEAKERR_API_KEY", "PEAKERR_FULFILMENT_ENABLED", "PEAKERR_AUTOBUY_CONFIRMED"],
    ["justanotherpanel", "JustAnotherPanel supplier connection", "JUSTANOTHERPANEL_API_KEY", "JUSTANOTHERPANEL_FULFILMENT_ENABLED", "JUSTANOTHERPANEL_AUTOBUY_CONFIRMED"]
  ]) {
    const configured = hasValue(env, envName);
    checks.push(makeCheck(
      id,
      label,
      configured ? "review" : "optional",
      configured
        ? "The server-side supplier key is present. The Admin product manager can load services and publish owner-priced listings."
        : "Optional supplier connection. Add its server-side API key before choosing services from this provider.",
      "Use the protected Social Media Boosters product manager to load the supplier catalogue and create storefront listings.",
      false
    ));
    const autoBuyEnabled = isTrue(env[fulfilmentEnv]) && isTrue(env[confirmEnv]);
    checks.push(makeCheck(
      id + "_autobuy",
      label.replace(" connection", "") + " order fulfilment",
      autoBuyEnabled ? "review" : "optional",
      autoBuyEnabled
        ? "Supplier auto-buy switches are enabled. Confirm test orders, wallet funding, spend limits and reconciliation procedures before live sales."
        : "Supplier auto-buy is disabled by default. Products can be published, but paid orders will remain queued until both switches are deliberately enabled.",
      "After confirming supplier permissions, end-to-end order/status tests and spending controls, set " + fulfilmentEnv + "=true and " + confirmEnv + "=true.",
      false
    ));
  }

  return checks;
}

module.exports = {
  REQUIRED_MIGRATIONS,
  REQUIRED_TABLES,
  buildLaunchChecks
};
