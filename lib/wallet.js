"use strict";

async function ensureWalletAccount(client, userId) {
  await client.query(
    "INSERT INTO vf_wallet_accounts (user_id, currency, balance_minor) VALUES ($1, 'USD', 0) ON CONFLICT (user_id) DO NOTHING",
    [userId]
  );
}

async function postWalletTransaction(client, input) {
  const amountMinor = Number(input.amountMinor);
  if (!Number.isSafeInteger(amountMinor) || amountMinor === 0) {
    const error = new Error("A valid wallet ledger amount is required.");
    error.code = "WALLET_AMOUNT_INVALID";
    throw error;
  }
  await ensureWalletAccount(client, input.userId);
  const inserted = await client.query(
    "INSERT INTO vf_wallet_transactions " +
    "(user_id, amount_minor, currency, transaction_type, reference_type, reference_id, description, metadata) " +
    "VALUES ($1, $2, 'USD', $3, $4, $5, $6, $7::jsonb) " +
    "ON CONFLICT (user_id, reference_type, reference_id) DO NOTHING RETURNING id",
    [input.userId, amountMinor, input.type, input.referenceType, String(input.referenceId),
      String(input.description || "Wallet transaction").slice(0, 240), JSON.stringify(input.metadata || {})]
  );
  if (!inserted.rowCount) return { applied: false };
  const updated = await client.query(
    "UPDATE vf_wallet_accounts SET balance_minor = balance_minor + $2, updated_at = NOW() " +
    "WHERE user_id = $1 RETURNING balance_minor",
    [input.userId, amountMinor]
  );
  return { applied: true, balanceMinor: Number(updated.rows[0]?.balance_minor || 0), transactionId: inserted.rows[0].id };
}

async function refundFailedOrder(client, orderId, reason) {
  const result = await client.query(
    "SELECT user_id, total_minor, currency, metadata FROM vf_orders WHERE id = $1 FOR UPDATE",
    [orderId]
  );
  if (!result.rowCount) return { applied: false, reason: "order_not_found" };
  const order = result.rows[0];
  const checkout = order.metadata?.checkout || {};
  // The catalogue and wallet are denominated in USD cents. The checkout
  // stores the original USD retail price alongside the converted amount.
  const amountMinor = Number(checkout.retailTotalCents ?? checkout.retailPriceCents ??
    (String(order.currency || "").toUpperCase() === "USD" ? order.total_minor : 0));
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    return { applied: false, reason: "original_usd_price_unavailable" };
  }
  const refund = await postWalletTransaction(client, {
    userId: order.user_id,
    amountMinor,
    type: "refund",
    referenceType: "order_refund",
    referenceId: orderId,
    description: "Wallet refund for failed order",
    metadata: { orderId, reason: String(reason || "Supplier could not complete the service").slice(0, 180) }
  });
  if (refund.applied) {
    await client.query(
      "UPDATE vf_orders SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{walletRefund}', $2::jsonb, true), updated_at = NOW() WHERE id = $1",
      [orderId, JSON.stringify({ status: "credited", amountMinor, currency: "USD", createdAt: new Date().toISOString() })]
    );
  }
  return refund.applied ? { ...refund, amountMinor } : refund;
}

module.exports = { ensureWalletAccount, postWalletTransaction, refundFailedOrder };
