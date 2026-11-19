const { getPool, getSessionUser, sendJson } = require("../lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }
  try {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { ok: false, error: "Please sign in to view your orders." });
    const result = await getPool().query(
      `SELECT o.id, o.order_number, o.product_type, o.product_name, o.status, o.currency,
              o.total_minor, o.created_at, o.updated_at,
              (SELECT j.status FROM vf_fulfilment_jobs j WHERE j.order_id = o.id LIMIT 1) AS fulfilment_status,
              COALESCE((
                SELECT json_agg(
                  json_build_object(
                    'eventType', e.event_type,
                    'message', e.message,
                    'createdAt', e.created_at
                  ) ORDER BY e.created_at DESC
                )
                FROM vf_order_events e
                WHERE e.order_id = o.id
              ), '[]'::json) AS events,
              (
                SELECT json_build_object(
                  'status', p.status,
                  'currency', p.currency,
                  'amountMinor', p.amount_minor,
                  'createdAt', p.created_at,
                  'updatedAt', p.updated_at
                )
                FROM vf_payments p
                WHERE p.order_id = o.id
                ORDER BY p.created_at DESC
                LIMIT 1
              ) AS latest_payment
         FROM vf_orders o
        WHERE o.user_id = $1
        ORDER BY o.created_at DESC
        LIMIT 25`,
      [user.id]
    );
    return sendJson(res, 200, { ok: true, orders: result.rows });
  } catch (error) {
    console.error("[orders/list]", error.code || error.message);
    return sendJson(res, 503, { ok: false, error: "Your order history is temporarily unavailable." });
  }
};
