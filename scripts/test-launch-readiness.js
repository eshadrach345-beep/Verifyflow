const assert = require("node:assert/strict");
const { REQUIRED_MIGRATIONS, REQUIRED_TABLES, buildLaunchChecks } = require("../lib/launch-readiness");

function makeEnv(overrides = {}) {
  return {
    VERIFYFLOW_ADMIN_EMAILS: "owner@example.com",
    SQUAD_SECRET_KEY: "squad-secret-present",
    SQUAD_API_BASE_URL: "https://sandbox-api-d.squadco.com",
    SQUAD_WEBHOOK_URL: "https://verifyflow.us.ci/api/payments/squad-webhook",
    MONNIFY_API_KEY: "key-present",
    MONNIFY_SECRET_KEY: "secret-present",
    MONNIFY_CONTRACT_CODE: "contract-present",
    MONNIFY_INTERNATIONAL_ENABLED: "true",
    MONNIFY_ENVIRONMENT: "LIVE",
    MONNIFY_LIVE_ENABLED: "true",
    MONNIFY_PRODUCT_APPROVAL_CONFIRMED: "true",
    VERIFYFLOW_LIVE_ORDERS_ENABLED: "true",
    VOIDMOB_API_KEY: "voidmob-key-present",
    VOIDMOB_FULFILMENT_ENABLED: "true",
    VOIDMOB_AUTOBUY_CONFIRMED: "true",
    VERIFYFLOW_MONNIFY_WEBHOOK_CONFIRMED: "true",
    VERIFYFLOW_LEGAL_BUSINESS_NAME: "Example Trading Ltd",
    VERIFYFLOW_BUSINESS_ADDRESS: "Business address supplied by owner",
    VERIFYFLOW_SUPPORT_EMAIL: "support@example.com",
    VERIFYFLOW_POLICIES_REVIEWED: "true",
    VERIFYFLOW_TAX_SETUP_CONFIRMED: "true",
    VERIFYFLOW_REFUND_PROCESS_CONFIRMED: "true",
    ...overrides
  };
}

function readyDatabase() {
  return {
    connected: true,
    tables: REQUIRED_TABLES.slice(),
    migrations: REQUIRED_MIGRATIONS.slice()
  };
}

function get(checks, id) {
  return checks.find(item => item.id === id);
}

const complete = buildLaunchChecks(makeEnv(), readyDatabase());
assert.equal(complete.some(item => item.required && item.status === "needs_action"), true);
assert.equal(get(complete, "database").status, "ready");
assert.equal(get(complete, "squad_credentials").status, "review");
assert.equal(get(complete, "squad_webhook").status, "review");
assert.equal(get(complete, "schema").status, "ready");
assert.equal(get(complete, "email_security").status, "needs_action");
assert.equal(get(complete, "peakerr").required, false);
assert.equal(get(complete, "justanotherpanel").required, false);
assert.equal(get(complete, "peakerr_autobuy").required, false);
assert.equal(get(complete, "justanotherpanel_autobuy").status, "optional");

const incomplete = buildLaunchChecks({}, { connected: false, tables: [], migrations: [] });
assert.equal(get(incomplete, "database").status, "needs_action");
assert.equal(get(incomplete, "schema").status, "needs_action");
assert.equal(get(incomplete, "monnify_credentials").status, "needs_action");
assert.equal(get(incomplete, "squad_credentials").status, "needs_action");
assert.equal(get(incomplete, "voidmob_autobuy").status, "needs_action");
assert.equal(get(incomplete, "peakerr_autobuy").status, "optional");
assert.equal(get(incomplete, "justanotherpanel_autobuy").status, "optional");

const safeDefaults = buildLaunchChecks(makeEnv({
  VOIDMOB_FULFILMENT_ENABLED: "false",
  VOIDMOB_AUTOBUY_CONFIRMED: "false",
  VERIFYFLOW_LIVE_ORDERS_ENABLED: "false"
}), readyDatabase());
assert.equal(get(safeDefaults, "voidmob_autobuy").status, "needs_action");
assert.equal(get(safeDefaults, "live_orders").status, "needs_action");

const smmApproved = buildLaunchChecks(makeEnv({
  PEAKERR_FULFILMENT_ENABLED: "true",
  PEAKERR_AUTOBUY_CONFIRMED: "true",
  JUSTANOTHERPANEL_FULFILMENT_ENABLED: "true",
  JUSTANOTHERPANEL_AUTOBUY_CONFIRMED: "true"
}), readyDatabase());
assert.equal(get(smmApproved, "peakerr_autobuy").status, "review");
assert.equal(get(smmApproved, "justanotherpanel_autobuy").status, "review");

const noSecretsReturned = JSON.stringify(complete);
assert.equal(noSecretsReturned.includes("key-present"), false);
assert.equal(noSecretsReturned.includes("squad-secret-present"), false);
assert.equal(noSecretsReturned.includes("secret-present"), false);
assert.equal(noSecretsReturned.includes("voidmob-key-present"), false);

console.log("Launch readiness checks passed (database, migrations, launch gates and secret redaction).");
