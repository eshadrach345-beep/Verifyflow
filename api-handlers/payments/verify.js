const { getPool, getSessionUser, sendJson, readJson, sameOrigin } = require("../../lib/auth");
const { verifyAndApplyPayment, verifyAndApplyWalletDeposit } = require("../../lib/payment-service");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }
  if (!sameOrigin(req)) {
    return sendJson(res, 403, { ok: false, error: "Request could not be verified." });
  }

  let body;
  try { body = await readJson(req); }
  catch { return sendJson(res, 400, { ok: false, error: "Please submit a valid request." }); }

  const paymentReference = String(body.paymentReference || "").trim();
  if (!/^(?:VFTEST_[A-F0-9]{20}|VF_[A-F0-9]{24}|VFWALLET_[A-F0-9]{24})$/.test(paymentReference)) {
    return sendJson(res, 400, { ok: false, error: "The payment reference is invalid." });
  }

  try {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { ok: false, error: "Please sign in to verify this payment." });
    if (paymentReference.startsWith("VFWALLET_")) {
      const ownedTopup = await getPool().query(
        "SELECT payment_reference FROM vf_wallet_topups WHERE payment_reference = $1 AND user_id = $2 LIMIT 1",
        [paymentReference, user.id]
      );
      if (!ownedTopup.rowCount) {
        return sendJson(res, 404, { ok: false, error: "This wallet deposit could not be found in your account." });
      }
      const payment = await verifyAndApplyWalletDeposit(paymentReference);
      return sendJson(res, 200, { ok: true, payment, wallet: { balanceMinor: payment.walletBalanceMinor, currency: "USD" } });
    }
    const owned = await getPool().query(
      "SELECT p.payment_reference FROM vf_payments p " +
      "JOIN vf_orders o ON o.id = p.order_id " +
      "WHERE p.payment_reference = $1 AND o.user_id = $2 LIMIT 1",
      [paymentReference, user.id]
    );
    if (!owned.rowCount) {
      return sendJson(res, 404, { ok: false, error: "This payment could not be found in your account." });
    }
    const result = await verifyAndApplyPayment(paymentReference);
    return sendJson(res, 200, { ok: true, payment: result });
  } catch (error) {
    console.error("[payments/verify]", error.code || error.message);
    if (error.code === "PAYMENT_NOT_FOUND") {
      return sendJson(res, 404, { ok: false, error: "This payment could not be found." });
    }
    return sendJson(res, 502, {
      ok: false,
      error: "We could not confirm the payment with Monnify yet. Please refresh in a moment."
    });
  }
};
