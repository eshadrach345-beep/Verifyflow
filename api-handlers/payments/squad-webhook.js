"use strict";

const { createHash } = require("node:crypto");
const { getPool, sendJson } = require("../../lib/auth");
const { verifySquadWebhook, verifyAndApplySquadPayment } = require("../../lib/squad-payment-service");

async function readRawBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > 1024 * 1024) throw new Error("Webhook body too large.");
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return sendJson(res, 405, { ok:false, error:"Method not allowed." }); }
  try {
    const raw = await readRawBody(req);
    const signature = String(req.headers["x-squad-encrypted-body"] || "");
    if (!verifySquadWebhook(raw, signature)) return sendJson(res, 401, { ok:false, error:"Invalid webhook signature." });
    let event;
    try { event = JSON.parse(raw.toString("utf8")); } catch { return sendJson(res, 400, { ok:false, error:"Invalid webhook payload." }); }
    if (String(event.Event || "").toLowerCase() !== "charge_successful") return sendJson(res, 200, { ok:true, ignored:true });
    const body = event.Body || {};
    const reference = String(body.transaction_ref || event.TransactionRef || "").trim();
    if (!reference) return sendJson(res, 400, { ok:false, error:"Missing transaction reference." });
    const found = await getPool().query(
      "SELECT payment_reference FROM vf_wallet_topups WHERE payment_reference=$1 AND provider='squad' UNION ALL SELECT payment_reference FROM vf_payments WHERE payment_reference=$1 AND provider='squad' LIMIT 1",
      [reference]
    );
    if (!found.rowCount) return sendJson(res, 200, { ok:true, ignored:true });
    const eventKey = createHash("sha256").update(["squad", event.Event, reference, body.gateway_ref || ""].join(":")).digest("hex");
    const safePayload = {
      Event: event.Event,
      TransactionRef: reference,
      Body: {
        transaction_ref: reference,
        gateway_ref: body.gateway_ref || null,
        transaction_status: body.transaction_status || null,
        amount: body.amount ?? null,
        currency: body.currency || null,
        email: body.email || null
      }
    };
    await getPool().query(
      "INSERT INTO vf_payment_webhook_events (provider,event_key,event_type,payment_reference,payload) VALUES ('squad',$1,$2,$3,$4::jsonb) ON CONFLICT (provider,event_key) DO NOTHING",
      [eventKey, String(event.Event), reference, JSON.stringify(safePayload)]
    );
    // Never trust the webhook body as proof of payment; verify directly with Squad.
    await verifyAndApplySquadPayment(reference);
    return sendJson(res, 200, { ok:true });
  } catch (error) {
    console.error("[payments/squad-webhook]", error.code || error.message);
    return sendJson(res, 500, { ok:false, error:"Webhook processing failed; Squad may retry." });
  }
};

module.exports.config = { api: { bodyParser: false } };
