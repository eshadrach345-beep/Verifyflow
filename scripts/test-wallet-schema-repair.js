"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");

const migration = fs.readFileSync("db/migrations/009_wallet_smm_schema_repair.sql", "utf8");
const readiness = fs.readFileSync("lib/launch-readiness.js", "utf8");
const wallet = fs.readFileSync("lib/wallet.js", "utf8");
const walletApi = fs.readFileSync("api-handlers/wallet/index.js", "utf8");
const depositApi = fs.readFileSync("api-handlers/wallet/deposit.js", "utf8");
const smmApi = fs.readFileSync("api-handlers/admin/smm-products.js", "utf8");
const checkout = fs.readFileSync("dashboard-checkout.js", "utf8");
const account = fs.readFileSync("account.html", "utf8");

assert.match(migration, /ALTER COLUMN supplier_service_id TYPE TEXT/);
assert.match(migration, /vf_smm_products_one_active_supplier_service_uidx/);
assert.match(migration, /ORDER BY retail_rate_minor_per_1000 DESC/);
assert.match(migration, /vf_wallet_accounts_user_id_repair_uidx/);
assert.match(migration, /vf_wallet_transactions_reference_repair_uidx/);
assert.match(migration, /vf_wallet_topups_payment_reference_repair_uidx/);
assert.ok(migration.includes("CREATE TABLE IF NOT EXISTS vf_wallet_topups"));
assert.ok(readiness.includes('"009_wallet_smm_schema_repair"'));
assert.ok(readiness.includes('"vf_wallet_topups"'));
assert.ok(wallet.includes("ON CONFLICT (user_id) DO NOTHING"));
assert.ok(wallet.includes("ON CONFLICT (user_id, reference_type, reference_id) DO NOTHING"));
assert.ok(walletApi.includes('"42P01"') && walletApi.includes('"42P10"'));
assert.ok(depositApi.includes('"42P01"') && depositApi.includes('"42P10"'));
assert.ok(smmApi.includes("service_id TEXT"));
assert.ok(smmApi.includes("ON CONFLICT (provider, supplier_service_id) WHERE is_active = TRUE"));
assert.ok(checkout.includes("selectProduct") && checkout.includes("tryOpenRequestedProduct"));
assert.ok(account.includes("accountReturnTo") && account.includes("window.location.replace(accountReturnTo)"));

console.log("VerifyFlow wallet and SMM schema repair tests passed.");
