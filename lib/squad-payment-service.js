"use strict";
const { verifySquadTransaction, verifySquadWebhook } = require("./squad");
const { getPool } = require("./auth");
const { postWalletTransaction } = require("./wallet");
const { enqueuePaidOrder, processFulfilmentForOrder } = require("./fulfilment");

async function verifyAndApplySquadPayment(reference) {
  const verified = await verifySquadTransaction(reference);
  if (verified.reference !== reference) throw Object.assign(new Error("Squad reference mismatch."), { code:"PAYMENT_REFERENCE_MISMATCH" });
  const client = await getPool().connect();
  let fulfilOrderId = null, orderProvider = null;
  try {
    await client.query("BEGIN");
    const topupResult = await client.query("SELECT * FROM vf_wallet_topups WHERE payment_reference=$1 AND provider='squad' FOR UPDATE", [reference]);
    if (topupResult.rowCount) {
      const topup = topupResult.rows[0];
      const validPaid = verified.status === "success" &&
        verified.amountMinor === Number(topup.payment_amount_minor) &&
        verified.currency === String(topup.payment_currency).trim().toUpperCase();
      const next = validPaid ? "paid" : verified.status === "success" ? "amount_mismatch" : verified.status === "failed" || verified.status === "abandoned" ? "failed" : "pending";
      if (topup.status !== "paid" || next === "paid") {
        await client.query("UPDATE vf_wallet_topups SET status=$2, provider_status=$3, transaction_reference=$4, provider_response=$5::jsonb, verified_at=NOW(), updated_at=NOW() WHERE id=$1",
          [topup.id, topup.status === "paid" ? "paid" : (validPaid ? "paid" : next), verified.status, verified.gatewayReference, JSON.stringify({ status:verified.status, amountMinor:verified.amountMinor, currency:verified.currency })]);
      }
      if (validPaid && topup.status !== "paid") {
        await postWalletTransaction(client, { userId:topup.user_id, amountMinor:Number(topup.wallet_amount_minor), type:"deposit", referenceType:"wallet_topup", referenceId:topup.id, description:"Squad wallet deposit", metadata:{ paymentReference:reference, gatewayReference:verified.gatewayReference } });
      }
      const account = await client.query("SELECT balance_minor FROM vf_wallet_accounts WHERE user_id=$1", [topup.user_id]);
      await client.query("COMMIT");
      return { paymentReference:reference, status:validPaid || topup.status==="paid" ? "paid" : next, walletBalanceMinor:Number(account.rows[0]?.balance_minor || 0) };
    }
    const result = await client.query(
      "SELECT p.id AS payment_id,p.order_id,p.currency,p.amount_minor,p.status AS payment_status,o.status AS order_status,o.provider AS order_provider FROM vf_payments p JOIN vf_orders o ON o.id=p.order_id WHERE p.payment_reference=$1 AND p.provider='squad' FOR UPDATE OF p,o",
      [reference]
    );
    if (!result.rowCount) throw Object.assign(new Error("Payment not found."), { code:"PAYMENT_NOT_FOUND" });
    const p=result.rows[0];
    const paid=verified.status==="success" && verified.amountMinor===Number(p.amount_minor) && verified.currency===String(p.currency).trim().toUpperCase();
    const status=paid?"paid":verified.status==="success"?"amount_mismatch":verified.status==="failed"||verified.status==="abandoned"?"failed":"pending";
    await client.query("UPDATE vf_payments SET status=$2,provider_status=$3,transaction_reference=$4,provider_response=$5::jsonb,verified_at=NOW(),updated_at=NOW() WHERE id=$1",
      [p.payment_id,p.payment_status==="paid"?"paid":status,verified.status,verified.gatewayReference,JSON.stringify({status:verified.status,amountMinor:verified.amountMinor,currency:verified.currency})]);
    if(paid && p.payment_status!=="paid" && p.order_status==="awaiting_payment"){
      await client.query("UPDATE vf_orders SET status='paid',updated_at=NOW() WHERE id=$1 AND status='awaiting_payment'",[p.order_id]);
      await client.query("INSERT INTO vf_order_events(order_id,event_type,message,details) VALUES($1,'payment_confirmed','Payment verified with Squad.',$2::jsonb)",[p.order_id,JSON.stringify({paymentReference:reference,gatewayReference:verified.gatewayReference})]);
      await enqueuePaidOrder(client,p.order_id); fulfilOrderId=p.order_id; orderProvider=p.order_provider;
    }
    await client.query("COMMIT");
    if(fulfilOrderId && ["voidmob","herosms","peakerr","justanotherpanel"].includes(orderProvider)){
      if(process.env.SQUAD_ENVIRONMENT!=="sandbox") {
        try { await processFulfilmentForOrder(fulfilOrderId); } catch(e){ console.error("[squad fulfilment]",e.code||e.message); }
      }
    }
    return { paymentReference:reference, status:paid?"paid":status, providerStatus:verified.status };
  } catch(error) { await client.query("ROLLBACK").catch(()=>{}); throw error; }
  finally { client.release(); }
}
module.exports = { verifyAndApplySquadPayment, verifySquadWebhook };
