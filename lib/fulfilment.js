"use strict";

const { getPool } = require("./auth");
const { purchase, getOrder, getProxyCredentials } = require("./voidmob");
const { buyNumber: buyHeroSmsNumber, buyRentalNumber: buyHeroSmsRental, getActivation: getHeroSmsActivation, getRentalStatus: getHeroSmsRentalStatus } = require("./herosms");
const { placeSmmOrder, getSmmOrderStatus } = require("./smm-service");
const { refundFailedOrder } = require("./wallet");

function eventDetails(values) {
  return JSON.stringify(values || {});
}

function fulfilmentEnabledForOrder(provider, metadata = {}, env = process.env) {
  // Final supplier-purchase gate: sandbox and unapproved live orders never buy inventory.
  if (metadata?.sandboxTest === true || metadata?.noFulfilment === true) return false;
  if (String(env.MONNIFY_ENVIRONMENT || "").toUpperCase() !== "LIVE") return false;
  if (env.VERIFYFLOW_LIVE_ORDERS_ENABLED !== "true") return false;
  if (provider === "herosms") {
    return env.HEROSMS_FULFILMENT_ENABLED === "true" &&
      env.HEROSMS_AUTOBUY_CONFIRMED === "true";
  }
  if (provider === "voidmob") {
    return env.VOIDMOB_FULFILMENT_ENABLED === "true" &&
      env.VOIDMOB_AUTOBUY_CONFIRMED === "true";
  }
  if (provider === "peakerr") {
    return env.PEAKERR_FULFILMENT_ENABLED === "true" &&
      env.PEAKERR_AUTOBUY_CONFIRMED === "true";
  }
  if (provider === "justanotherpanel") {
    return env.JUSTANOTHERPANEL_FULFILMENT_ENABLED === "true" &&
      env.JUSTANOTHERPANEL_AUTOBUY_CONFIRMED === "true";
  }
  return false;
}

function mapSupplierState(productType, supplierStatus) {
  const status = String(supplierStatus || "").toLowerCase();
  if (productType === "sms_otp") {
    if (status === "code_received" || status === "received" || status === "completed" || status === "success") return "completed";
    if (status === "cancelled" || status === "expired") return "failed";
    return "submitted";
  }
  if (productType === "long_term_number" || productType === "dedicated_number") {
    if (status === "active" || status === "expired") return "completed";
    if (status === "cancelled") return "failed";
    return "submitted";
  }
  if (productType === "esim") {
    if (status === "completed" || status === "expired") return "completed";
    if (status === "refunded" || status === "cancelled") return "failed";
    return "submitted";
  }
  if (productType === "mobile_proxy") {
    if (status === "active" || status === "expired" || status === "exhausted") return "completed";
    if (status === "refunded" || status === "cancelled") return "failed";
    return "submitted";
  }
  if (productType === "smm_service") {
    if (status === "completed") return "completed";
    if (status === "cancelled" || status === "canceled" || status === "failed" || status === "refunded") return "failed";
    return "submitted";
  }
  return "failed";
}

function extractOtpCode(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^[A-Za-z0-9]{4,10}$/.test(text)) return text;
  const labelled = text.match(/(?:\botp(?:\s+code)?\b|one[ -]?time(?: password)?|verification(?:\s+|-)code|security code|passcode|\bcode\b)\s*(?:(?:is|:|=|#|-)\s*)?([A-Z0-9]{4,10})\b/i);
  if (labelled) return labelled[1];
  const numeric = text.match(/\b(\d{4,8})\b/);
  return numeric ? numeric[1] : null;
}

function customerOtpDelivery(serviceData = {}, fallbackStatus = "") {
  const payload = serviceData && typeof serviceData === "object" ? serviceData : {};
  const smsSource = payload.sms ?? payload.messages ?? payload.sms_messages ?? payload.message ?? payload.text ?? null;
  const messages = Array.isArray(smsSource) ? smsSource : (smsSource && typeof smsSource === "object" ? [smsSource] : []);
  const latest = messages.length ? messages[messages.length - 1] : null;
  const messageText = typeof smsSource === "string" ? smsSource :
    typeof latest === "string" ? latest :
    latest && typeof latest === "object" ? String(latest.text ?? latest.body ?? latest.message ?? latest.sms ?? "") : "";
  const explicitCode = payload.code ?? payload.otp ?? payload.verificationCode ??
    (latest && typeof latest === "object" ? latest.code ?? latest.otp ?? latest.verificationCode : null);
  const code = extractOtpCode(explicitCode) || extractOtpCode(messageText) || extractOtpCode(typeof smsSource === "string" ? smsSource : "");
  const phoneRaw = payload.phoneNumber ?? payload.phone_number ?? payload.phone ?? payload.number ?? payload.msisdn ??
    (latest && typeof latest === "object" ? latest.phoneNumber ?? latest.phone ?? null : null);
  const phoneNumber = phoneRaw && /^\+?[0-9 ()-]{6,24}$/.test(String(phoneRaw).trim()) ? String(phoneRaw).trim() : null;
  const stateRaw = String(payload.status ?? payload.statusCode ?? fallbackStatus ?? "").toLowerCase();
  const received = Boolean(code) || /code_received|status_ok|received|completed|success/.test(stateRaw);
  return {
    phoneNumber, code,
    message: messageText && messageText !== code ? messageText.slice(0, 1500) : null,
    received, status: received ? "received" : /cancel|expired|failed/.test(stateRaw) ? "expired" : "waiting"
  };
}
async function enqueuePaidOrder(client, orderId) {
  const result = await client.query(
    "SELECT id, provider, status, metadata FROM vf_orders WHERE id = $1 FOR UPDATE",
    [orderId]
  );
  if (!result.rowCount) return false;
  const order = result.rows[0];
  const metadata = order.metadata || {};
  if (!["voidmob", "herosms", "peakerr", "justanotherpanel"].includes(order.provider) || order.status !== "paid" ||
      metadata.sandboxTest === true || metadata.noFulfilment === true) return false;
  const supplierInput = metadata.checkout?.supplierInput;
  if (!supplierInput || typeof supplierInput !== "object") {
    await client.query(
      "INSERT INTO vf_order_events (order_id, event_type, message, details) " +
      "VALUES ($1, 'fulfilment_blocked', 'The order is missing its verified server-side supplier quote.', '{}'::jsonb)",
      [orderId]
    );
    return false;
  }
  const key = "vf-order-" + String(orderId).replace(/-/g, "");
  await client.query(
    "UPDATE vf_orders SET idempotency_key = COALESCE(idempotency_key, $2) WHERE id = $1",
    [orderId, key]
  );
  const job = await client.query(
    "INSERT INTO vf_fulfilment_jobs (order_id, provider, idempotency_key, supplier_cost_minor, supplier_currency) " +
    "VALUES ($1, $2, $3, $4, $5) ON CONFLICT (order_id) DO NOTHING RETURNING id",
    [orderId, order.provider, key,
      metadata.checkout.supplierPriceCents == null ? null : Number(metadata.checkout.supplierPriceCents),
      String(metadata.checkout.supplierCurrency || "USD").slice(0, 3).toUpperCase()]
  );
  if (job.rowCount) {
    await client.query(
      "INSERT INTO vf_order_events (order_id, event_type, message, details) " +
      "VALUES ($1, 'fulfilment_queued', 'Payment verified. Supplier fulfilment has been queued.', '{}'::jsonb)",
      [orderId]
    );
  }
  return true;
}

async function processFulfilmentForOrder(orderId, options = {}) {
  const pool = getPool();
  const client = await pool.connect();
  let job;
  try {
    await client.query("BEGIN");
    const found = await client.query(
      "SELECT j.id AS job_id, j.status AS job_status, j.idempotency_key, " +
      "o.id AS order_id, o.provider, o.product_type, o.status AS order_status, o.metadata, " +
      "p.status AS payment_status " +
      "FROM vf_fulfilment_jobs j JOIN vf_orders o ON o.id = j.order_id " +
      "LEFT JOIN LATERAL (SELECT status FROM vf_payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1) p ON TRUE " +
      "WHERE j.order_id = $1 FOR UPDATE OF j, o",
      [orderId]
    );
    if (!found.rowCount) {
      await client.query("COMMIT");
      return { status: "not_queued" };
    }
    const row = found.rows[0];
    const enabled = fulfilmentEnabledForOrder(row.provider, row.metadata, process.env);
    if (!enabled) {
      await client.query("COMMIT");
      return { status: "pending", disabled: true };
    }
    if (row.payment_status !== "paid" || row.order_status === "failed" ||
        row.metadata?.sandboxTest === true || row.metadata?.noFulfilment === true) {
      await client.query("COMMIT");
      return { status: "not_eligible" };
    }
    if (["submitted", "completed", "failed", "skipped"].includes(row.job_status) ||
        (row.job_status === "unknown" && options.retryUnknown !== true)) {
      await client.query("COMMIT");
      return { status: row.job_status };
    }
    if (row.job_status === "submitting") {
      const lease = await client.query(
        "SELECT locked_at < NOW() - INTERVAL '3 minutes' AS expired " +
        "FROM vf_fulfilment_jobs WHERE id = $1",
        [row.job_id]
      );
      if (!lease.rows[0]?.expired) {
        await client.query("COMMIT");
        return { status: "submitting" };
      }
    }

    const claimed = await client.query(
      "UPDATE vf_fulfilment_jobs SET status = 'submitting', attempts = attempts + 1, " +
      "locked_at = NOW(), last_error_code = NULL, last_error_message = NULL, updated_at = NOW() " +
      "WHERE id = $1 RETURNING idempotency_key, attempts",
      [row.job_id]
    );
    job = { ...row, ...claimed.rows[0] };
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const supplierInput = job.metadata?.checkout?.supplierInput;
  if (!supplierInput) {
    await markFailure(orderId, "SUPPLIER_SNAPSHOT_MISSING", "The saved supplier product details are missing.", false);
    return { status: "failed" };
  }

  try {
    const result = job.product_type === "smm_service"
      ? await placeSmmOrder(job.provider, supplierInput)
      : job.provider === "herosms"
        ? job.product_type === "long_term_number"
          ? await buyHeroSmsRental(supplierInput.service, supplierInput.countryId, supplierInput.durationHours, supplierInput.maxPriceCents)
          : await buyHeroSmsNumber(supplierInput.service, supplierInput.countryId, job.idempotency_key, supplierInput.maxPriceCents)
        : await purchase(job.product_type, supplierInput, job.idempotency_key);
    let supplierData = result.supplierData;
    const customerDelivery = ["sms_otp", "long_term_number"].includes(job.product_type)
      ? customerOtpDelivery(supplierData, result.status) : null;
    if (job.product_type === "mobile_proxy" &&
        job.metadata?.checkout?.productSnapshot?.planType === "shared" &&
        String(result.status).toLowerCase() === "active" &&
        !supplierData.gateway) {
      const credentialKey = "vf-proxy-credentials-" + String(orderId).replace(/-/g, "");
      const credentials = await getProxyCredentials(result.supplierOrderId, credentialKey);
      supplierData = { ...supplierData, ...credentials };
    }
    const state = mapSupplierState(job.product_type, result.status);
    const poolClient = await pool.connect();
    try {
      await poolClient.query("BEGIN");
      await poolClient.query(
        "UPDATE vf_fulfilment_jobs SET status = $2, supplier_order_id = $3, " +
        "supplier_cost_minor = COALESCE($4, supplier_cost_minor), supplier_status = $5, " +
        "supplier_response = $6::jsonb, locked_at = NULL, completed_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE NULL END, updated_at = NOW() " +
        "WHERE order_id = $1",
        [orderId, state, result.supplierOrderId, result.chargedPriceCents,
          result.status, JSON.stringify(supplierData)]
      );
      await poolClient.query(
        "UPDATE vf_orders SET supplier_order_id = $2, status = $3, " +
        "metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{fulfilment}', $4::jsonb, true), updated_at = NOW() " +
        "WHERE id = $1",
        [orderId, result.supplierOrderId, state === "completed" ? "completed" : state === "failed" ? "failed" : "processing",
          JSON.stringify({ status: state, supplierStatus: result.status, serviceData: supplierData, ...(customerDelivery ? { customerDelivery } : {}), updatedAt: new Date().toISOString() })]
      );
      await poolClient.query(
        "INSERT INTO vf_order_events (order_id, event_type, message, details) VALUES ($1, $2, $3, $4::jsonb)",
        [orderId, state === "completed" ? "fulfilment_completed" : state === "failed" ? "fulfilment_failed" : "supplier_order_submitted",
          state === "completed" ? "Supplier service is ready." : state === "failed" ? "Supplier could not complete this service. Support review is required." : "Supplier accepted the order and is preparing the service.",
          eventDetails({ supplierOrderId: result.supplierOrderId, supplierStatus: result.status })]
      );
      if (state === "failed") {
        const refund = await refundFailedOrder(poolClient, orderId, "Supplier marked the purchased service as failed or refunded.");
        if (refund.applied) {
          await poolClient.query(
            "INSERT INTO vf_order_events (order_id, event_type, message, details) VALUES ($1, 'wallet_refund_credited', 'Your failed order amount has been returned to your VerifyFlow wallet.', $2::jsonb)",
            [orderId, JSON.stringify({ amountMinor: refund.balanceMinor, currency: "USD" })]
          );
        }
      }
      await poolClient.query("COMMIT");
    } catch (error) {
      await poolClient.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      poolClient.release();
    }
    return { status: state, supplierOrderId: result.supplierOrderId };
  } catch (error) {
    const uncertain = ["SUPPLIER_OUTCOME_UNKNOWN", "SUPPLIER_RESPONSE_UNCLEAR",
      "IDEMPOTENCY_REPLAY_IN_FLIGHT", "IDEMPOTENCY_CONFLICT"].includes(error.code);
    await markFailure(orderId, error.code || "SUPPLIER_PURCHASE_FAILED",
      uncertain ? "Supplier result is uncertain. Reconciliation is required before another attempt." :
        "Supplier purchase failed. A manual payment review or refund may be required.", uncertain);
    return { status: uncertain ? "unknown" : "failed", errorCode: error.code || "SUPPLIER_PURCHASE_FAILED" };
  }
}

async function markFailure(orderId, code, message, uncertain) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE vf_fulfilment_jobs SET status = $2, last_error_code = $3, last_error_message = $4, " +
      "locked_at = NULL, updated_at = NOW() WHERE order_id = $1",
      [orderId, uncertain ? "unknown" : "failed", String(code).slice(0, 100), message]
    );
    if (!uncertain) {
      await client.query("UPDATE vf_orders SET status = 'failed', updated_at = NOW() WHERE id = $1 AND status <> 'completed'", [orderId]);
      const refund = await refundFailedOrder(client, orderId, message);
      if (refund.applied) {
        await client.query(
          "INSERT INTO vf_order_events (order_id, event_type, message, details) VALUES ($1, 'wallet_refund_credited', 'Your failed order amount has been returned to your VerifyFlow wallet.', $2::jsonb)",
          [orderId, JSON.stringify({ balanceMinor: refund.balanceMinor, currency: "USD" })]
        );
      }
    } else {
      await client.query("UPDATE vf_orders SET status = 'processing', updated_at = NOW() WHERE id = $1 AND status = 'paid'", [orderId]);
    }
    await client.query(
      "INSERT INTO vf_order_events (order_id, event_type, message, details) VALUES ($1, $2, $3, $4::jsonb)",
      [orderId, uncertain ? "fulfilment_unknown" : "fulfilment_failed", message, eventDetails({ code })]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function refreshOrderFromSupplier(orderId, userId) {
  const result = await getPool().query(
    "SELECT o.id, o.provider, o.product_type, o.status, o.supplier_order_id, o.metadata " +
    "FROM vf_orders o WHERE o.id = $1 AND o.user_id = $2 AND o.provider IN ('voidmob', 'herosms', 'peakerr', 'justanotherpanel') LIMIT 1",
    [orderId, userId]
  );
  if (!result.rowCount) {
    const error = new Error("Order not found.");
    error.code = "ORDER_NOT_FOUND";
    throw error;
  }
  const order = result.rows[0];
  if (!order.supplier_order_id) return { orderStatus: order.status, delivery: null };
  let supplierData = order.product_type === "smm_service"
    ? await getSmmOrderStatus(order.provider, order.supplier_order_id)
    : order.provider === "herosms"
      ? order.product_type === "long_term_number"
        ? await getHeroSmsRentalStatus(order.supplier_order_id)
        : await getHeroSmsActivation(order.supplier_order_id)
      : await getOrder(order.product_type, order.supplier_order_id);
  if (["sms_otp", "long_term_number"].includes(order.product_type)) {
    const previousServiceData = order.metadata?.fulfilment?.serviceData || {};
    supplierData = { ...previousServiceData, ...(supplierData && typeof supplierData === "object" ? supplierData : {}) };
  }
  const supplierStatus = supplierData.status;
  const customerDelivery = ["sms_otp", "long_term_number"].includes(order.product_type)
    ? customerOtpDelivery(supplierData, supplierStatus) : null;
  if (order.product_type === "mobile_proxy" &&
      order.metadata?.checkout?.productSnapshot?.planType === "shared" &&
      String(supplierStatus).toLowerCase() === "active" &&
      !supplierData.gateway) {
    const credentialKey = "vf-proxy-credentials-" + String(orderId).replace(/-/g, "");
    const credentials = await getProxyCredentials(order.supplier_order_id, credentialKey);
    supplierData = { ...supplierData, ...credentials };
  }
  const state = mapSupplierState(order.product_type, supplierStatus);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE vf_fulfilment_jobs SET status = $2, supplier_status = $3, supplier_response = $4::jsonb, " +
      "completed_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE completed_at END, updated_at = NOW() WHERE order_id = $1",
      [orderId, state, supplierStatus || null, JSON.stringify(supplierData)]
    );
    await client.query(
      "UPDATE vf_orders SET status = $2, metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{fulfilment}', $3::jsonb, true), updated_at = NOW() WHERE id = $1",
      [orderId, state === "completed" ? "completed" : state === "failed" ? "failed" : "processing",
        JSON.stringify({ status: state, supplierStatus: supplierStatus || null, serviceData: supplierData, ...(customerDelivery ? { customerDelivery } : {}), updatedAt: new Date().toISOString() })]
    );
    if (state === "failed") {
      const refund = await refundFailedOrder(client, orderId, "Supplier status changed to a failed or refunded state.");
      if (refund.applied) {
        await client.query(
          "INSERT INTO vf_order_events (order_id, event_type, message, details) VALUES ($1, 'wallet_refund_credited', 'Your failed order amount has been returned to your VerifyFlow wallet.', $2::jsonb)",
          [orderId, JSON.stringify({ balanceMinor: refund.balanceMinor, currency: "USD" })]
        );
      }
    }
    await client.query(
      "INSERT INTO vf_order_events (order_id, event_type, message, details) VALUES ($1, 'supplier_status_refreshed', 'Supplier service status was refreshed.', $2::jsonb)",
      [orderId, eventDetails({ supplierStatus: supplierStatus || null })]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { orderStatus: state === "completed" ? "completed" : state === "failed" ? "failed" : "processing", delivery: customerDelivery };
}

module.exports = { enqueuePaidOrder, processFulfilmentForOrder, refreshOrderFromSupplier, mapSupplierState, fulfilmentEnabledForOrder, customerOtpDelivery, extractOtpCode };
