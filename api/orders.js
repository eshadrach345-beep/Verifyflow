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
      `SELECT order_number, product_type, product_name, status, currency,
              total_minor, created_at
         FROM vf_orders
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 25`,
      [user.id]
    );
    return sendJson(res, 200, { ok: true, orders: result.rows });
  } catch (error) {
    console.error("[orders/list]", error.code || error.message);
    return sendJson(res, 503, { ok: false, error: "Your order history is temporarily unavailable." });
  }
};
