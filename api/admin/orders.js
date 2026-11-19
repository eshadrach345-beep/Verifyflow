const { getPool, getSessionUser, sendJson } = require("../../lib/auth");

function adminEmails() {
  return String(process.env.VERIFYFLOW_ADMIN_EMAILS || "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }

  try {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { ok: false, error: "Please sign in." });

    const allowed = adminEmails();
    if (!allowed.length) {
      return sendJson(res, 503, {
        ok: false,
        error: "Admin access has not been configured. Set VERIFYFLOW_ADMIN_EMAILS in the server environment."
      });
    }
    if (!allowed.includes(String(user.email || "").toLowerCase())) {
      return sendJson(res, 403, { ok: false, error: "You do not have admin access." });
    }

    const result = await getPool().query(
      `SELECT
         o.id, o.order_number, o.product_type, o.product_name, o.provider,
         COALESCE(NULLIF(o.metadata->>'platform', ''), CASE o.product_type
           WHEN 'sms_otp' THEN 'SMS'
           WHEN 'long_term_number' THEN 'Long-term numbers'
           WHEN 'dedicated_number' THEN 'Dedicated numbers'
           WHEN 'esim' THEN 'eSIM'
           WHEN 'mobile_proxy' THEN 'Mobile proxies'
           ELSE 'Other'
         END) AS platform,
         o.status, o.currency, o.subtotal_minor, o.total_minor,
         o.supplier_order_id, o.created_at, o.updated_at,
         u.email AS customer_email,
         p.status AS payment_status,
         p.amount_minor AS payment_amount_minor,
         p.payment_reference
       FROM vf_orders o
       JOIN vf_users u ON u.id = o.user_id
       LEFT JOIN LATERAL (
         SELECT status, amount_minor, payment_reference
         FROM vf_payments
         WHERE order_id = o.id
         ORDER BY created_at DESC
         LIMIT 1
       ) p ON TRUE
       ORDER BY o.created_at DESC
       LIMIT 200`
    );

    const orders = result.rows.map(row => ({
      id: row.id,
      orderNumber: row.order_number,
      productType: row.product_type,
      productName: row.product_name,
      supplier: row.provider,
      platform: row.platform,
      status: row.status,
      currency: row.currency,
      subtotalMinor: Number(row.subtotal_minor || 0),
      totalMinor: Number(row.total_minor || 0),
      supplierOrderId: row.supplier_order_id,
      customerEmail: row.customer_email,
      paymentStatus: row.payment_status || "not_started",
      paymentAmountMinor: row.payment_amount_minor == null ? null : Number(row.payment_amount_minor),
      paymentReference: row.payment_reference,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    const fundingMap = new Map();
    for (const order of orders) {
      if (!["paid", "processing"].includes(order.status) || order.paymentStatus !== "paid") continue;
      const key = order.supplier + "::" + order.platform;
      const current = fundingMap.get(key) || {
        supplier: order.supplier,
        platform: order.platform,
        currency: order.currency,
        orders: 0,
        amountMinor: 0,
        awaitingSupplierSubmission: 0
      };
      current.orders += 1;
      if (current.currency === order.currency) current.amountMinor += order.totalMinor;
      if (!order.supplierOrderId) current.awaitingSupplierSubmission += 1;
      fundingMap.set(key, current);
    }

    return sendJson(res, 200, {
      ok: true,
      updatedAt: new Date().toISOString(),
      orders,
      fundingSummary: Array.from(fundingMap.values()).sort((a, b) =>
        b.awaitingSupplierSubmission - a.awaitingSupplierSubmission ||
        b.amountMinor - a.amountMinor
      ),
      note: "Funding figures are customer order totals, not supplier costs. Supplier purchase and funding are not automated."
    });
  } catch (error) {
    console.error("[admin/orders]", error.code || error.message);
    return sendJson(res, 503, { ok: false, error: "The admin order report is temporarily unavailable." });
  }
};
