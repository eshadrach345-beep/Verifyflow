const { createHash } = require("node:crypto");
const { getPool, sendJson } = require("../../lib/auth");
const { getMonnifyConfig, verifyWebhookSignature } = require("../../lib/monnify");
const { verifyAndApplyPayment } = require("../../lib/payment-service");

async function readRawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) {
      const error = new Error("Webhook body is too large.");
      error.code = "WEBHOOK_BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }

  try {
    const config = getMonnifyConfig();
    const rawBody = await readRawBody(req);
    const signature = String(req.headers["monnify-signature"] || "");

    // Monnify does not include a signature header in Sandbox. The referenced
    // transaction is still verified server-to-server before its status changes.
    if (config.environment === "LIVE") {
      if (!verifyWebhookSignature(rawBody, signature, config.secretKey)) {
        return sendJson(res, 401, { ok: false, error: "Invalid webhook signature." });
      }
    } else if (signature && !verifyWebhookSignature(rawBody, signature, config.secretKey)) {
      return sendJson(res, 401, { ok: false, error: "Invalid webhook signature." });
    }

    let payload;
    try { payload = JSON.parse(rawBody.toString("utf8")); }
    catch { return sendJson(res, 400, { ok: false, error: "Invalid webhook payload." }); }

    const eventType = String(payload.eventType || "").toUpperCase();
    const data = payload.eventData || {};
    const paymentReference = String(data.paymentReference || "").trim();
    if (eventType !== "SUCCESSFUL_TRANSACTION" || !paymentReference) {
      return sendJson(res, 200, { ok: true, ignored: true });
    }

    const payment = await getPool().query(
      "SELECT payment_reference FROM vf_payments WHERE payment_reference = $1 LIMIT 1",
      [paymentReference]
    );
    if (!payment.rowCount) {
      return sendJson(res, 200, { ok: true, ignored: true });
    }

    const identity = [eventType, paymentReference, String(data.transactionReference || "")].join(":");
    const eventKey = createHash("sha256").update(identity).digest("hex");
    const safePayload = {
      eventType,
      eventData: {
        paymentReference,
        transactionReference: data.transactionReference || null,
        paymentStatus: data.paymentStatus || null,
        amountPaid: data.amountPaid ?? null,
        currency: data.currency || null,
        paymentMethod: data.paymentMethod || null
      }
    };
    await getPool().query(
      "INSERT INTO vf_payment_webhook_events (event_key, event_type, payment_reference, payload) " +
      "VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (provider, event_key) DO NOTHING",
      [eventKey, eventType, paymentReference, JSON.stringify(safePayload)]
    );

    // Never act on webhook amount/status fields alone.
    await verifyAndApplyPayment(paymentReference);
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error("[payments/webhook]", error.code || error.message);
    return sendJson(res, 500, { ok: false, error: "Webhook processing failed. Monnify may retry." });
  }
};

module.exports.config = { api: { bodyParser: false } };
