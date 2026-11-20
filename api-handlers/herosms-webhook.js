"use strict";

const { timingSafeEqual } = require("node:crypto");
const { getPool, sendJson, readJson } = require("../lib/auth");
const { customerOtpDelivery } = require("../lib/fulfilment");

function constantTimeMatch(expected, supplied) {
  if (!expected || !supplied) return false;
  const left = Buffer.from(String(expected));
  const right = Buffer.from(String(supplied));
  return left.length === right.length && timingSafeEqual(left, right);
}

function webhookSecret(req) {
  const url = new URL(String(req.url || "/"), "https://verifyflow.invalid");
  return req.headers?.["x-herosms-webhook-secret"] || url.searchParams.get("token") || req.query?.token || "";
}

function normalizeWebhookPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const activationId = String(payload.activationId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(activationId)) return null;
  const text = typeof payload.text === "string" ? payload.text.slice(0, 1500) : "";
  const code = typeof payload.code === "string" || typeof payload.code === "number"
    ? String(payload.code).trim().slice(0, 32) : "";
  const service = typeof payload.service === "string" ? payload.service.slice(0, 80) : null;
  const country = Number.isInteger(Number(payload.country)) ? Number(payload.country) : null;
  const receivedAt = payload.receivedAt && !Number.isNaN(Date.parse(payload.receivedAt))
    ? new Date(payload.receivedAt).toISOString() : new Date().toISOString();
  return { activationId, text, code, service, country, receivedAt };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }

  const expectedSecret = process.env.HEROSMS_WEBHOOK_SECRET;
  if (!expectedSecret || !constantTimeMatch(expectedSecret, webhookSecret(req))) {
    return sendJson(res, 401, { ok: false, error: "Webhook authentication failed." });
  }

  let body;
  try { body = await readJson(req); }
  catch { return sendJson(res, 400, { ok: false, error: "Invalid webhook payload." }); }
  const event = normalizeWebhookPayload(body);
  if (!event) return sendJson(res, 400, { ok: false, error: "Invalid webhook payload." });

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      "SELECT o.id, o.status AS order_status, o.metadata, j.status AS job_status, j.supplier_response " +
      "FROM vf_fulfilment_jobs j JOIN vf_orders o ON o.id = j.order_id " +
      "WHERE j.provider = 'herosms' AND j.supplier_order_id = $1 AND o.product_type = 'sms_otp' " +
      "LIMIT 1 FOR UPDATE OF j, o",
      [event.activationId]
    );

    // HeroSMS webhooks are account-wide. Acknowledge events for unrelated activations
    // so they are not retried indefinitely against this VerifyFlow endpoint.
    if (!found.rowCount) {
      await client.query("COMMIT");
      return sendJson(res, 200, { status: "accepted", ignored: true });
    }

    const row = found.rows[0];
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const fulfilment = metadata.fulfilment && typeof metadata.fulfilment === "object" ? metadata.fulfilment : {};
    const oldServiceData = fulfilment.serviceData && typeof fulfilment.serviceData === "object" ? fulfilment.serviceData : {};
    const previousWebhook = oldServiceData.webhook && typeof oldServiceData.webhook === "object" ? oldServiceData.webhook : {};
    const serviceData = {
      ...oldServiceData,
      webhook: {
        ...previousWebhook,
        service: event.service,
        country: event.country,
        text: event.text || previousWebhook.text || null,
        code: event.code || previousWebhook.code || null,
        receivedAt: event.receivedAt
      }
    };
    const delivery = customerOtpDelivery({
      ...serviceData,
      phoneNumber: oldServiceData.phoneNumber || oldServiceData.phone || null,
      status: event.code || event.text ? "STATUS_OK" : "STATUS_WAIT_CODE",
      sms: { text: event.text, code: event.code }
    });
    const receivedCode = Boolean(delivery.code);
    const alreadyRecorded = Boolean(
      fulfilment.customerDelivery?.code &&
      delivery.code &&
      String(fulfilment.customerDelivery.code) === String(delivery.code)
    );
    const nextFulfilment = {
      ...fulfilment,
      status: receivedCode ? "completed" : (fulfilment.status || "submitted"),
      supplierStatus: receivedCode ? "STATUS_OK" : "STATUS_WAIT_CODE",
      serviceData,
      ...(delivery.code || delivery.message ? { customerDelivery: delivery } : {}),
      updatedAt: event.receivedAt
    };
    const nextMetadata = { ...metadata, fulfilment: nextFulfilment };

    await client.query(
      "UPDATE vf_fulfilment_jobs SET status = CASE WHEN $2 THEN 'completed' ELSE status END, " +
      "supplier_status = $3, supplier_response = $4::jsonb, " +
      "completed_at = CASE WHEN $2 THEN COALESCE(completed_at, NOW()) ELSE completed_at END, " +
      "updated_at = NOW() WHERE order_id = $1",
      [row.id, receivedCode, nextFulfilment.supplierStatus, JSON.stringify({
        ...row.supplier_response,
        ...serviceData,
        status: nextFulfilment.supplierStatus
      })]
    );
    await client.query(
      "UPDATE vf_orders SET status = CASE WHEN $2 THEN 'completed' ELSE status END, " +
      "metadata = $3::jsonb, updated_at = NOW() WHERE id = $1",
      [row.id, receivedCode, JSON.stringify(nextMetadata)]
    );
    if (receivedCode && !alreadyRecorded) {
      await client.query(
        "INSERT INTO vf_order_events (order_id, event_type, message, details) " +
        "VALUES ($1, 'herosms_otp_received', 'HeroSMS delivered the verification code to VerifyFlow.', $2::jsonb)",
        [row.id, JSON.stringify({ receivedAt: event.receivedAt, service: event.service, country: event.country })]
      );
    }
    await client.query("COMMIT");
    return sendJson(res, 200, { status: "accepted" });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[herosms/webhook]", error.code || error.message);
    return sendJson(res, 503, { status: "retry" });
  } finally {
    client.release();
  }
};

module.exports.normalizeWebhookPayload = normalizeWebhookPayload;
