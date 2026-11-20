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
              EXISTS (SELECT 1 FROM vf_fulfilment_jobs delivery_job WHERE delivery_job.order_id = o.id AND delivery_job.status IN ('submitted','completed')) AS has_active_delivery,
              o.metadata->'fulfilment'->'customerDelivery' AS customer_delivery,
              jsonb_strip_nulls(jsonb_build_object(
                'status', o.metadata->'fulfilment'->>'status',
                'phone_number', COALESCE(o.metadata#>>'{fulfilment,customerDelivery,phoneNumber}', o.metadata#>>'{fulfilment,serviceData,phoneNumber}', o.metadata#>>'{fulfilment,serviceData,phone_number}', o.metadata#>>'{fulfilment,serviceData,phone}', o.metadata#>>'{fulfilment,serviceData,number}'),
                'code', o.metadata#>>'{fulfilment,customerDelivery,code}',
                'expires_at', COALESCE(o.metadata#>>'{fulfilment,serviceData,expires_at}', o.metadata#>>'{fulfilment,serviceData,activationEndTime}', o.metadata#>>'{fulfilment,serviceData,endDate}'),
                'activation_code', COALESCE(o.metadata#>>'{fulfilment,serviceData,activation_code}', o.metadata#>>'{fulfilment,serviceData,activationCode}', o.metadata#>>'{fulfilment,serviceData,qr_code}'),
                'smdp_address', COALESCE(o.metadata#>>'{fulfilment,serviceData,smdp_address}', o.metadata#>>'{fulfilment,serviceData,smdpAddress}'),
                'gateway', o.metadata#>'{fulfilment,serviceData,gateway}',
                'remains', o.metadata#>>'{fulfilment,serviceData,remains}',
                'startCount', COALESCE(o.metadata#>>'{fulfilment,serviceData,start_count}', o.metadata#>>'{fulfilment,serviceData,startCount}'),
                'quantity', o.metadata#>>'{checkout,productSnapshot,quantity}',
                'targetUrl', o.metadata#>>'{checkout,productSnapshot,targetUrl}',
                'message', o.metadata#>>'{fulfilment,customerDelivery,message}'
              )) AS customer_service,
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
