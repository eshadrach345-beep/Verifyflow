"use strict";
const { randomBytes } = require("node:crypto");
const { getPool, getSessionUser, sendJson, readJson, sameOrigin } = require("../../lib/auth");
const { getCheckoutAmount } = require("../../lib/checkout-currency");
const { initiateSquadPayment } = require("../../lib/squad");

module.exports = async function handler(req,res) {
  if(req.method!=="POST"){res.setHeader("Allow","POST");return sendJson(res,405,{ok:false,error:"Method not allowed."});}
  if(!sameOrigin(req)) return sendJson(res,403,{ok:false,error:"Request could not be verified."});
  let body; try{body=await readJson(req);}catch{return sendJson(res,400,{ok:false,error:"Enter a valid wallet amount."});}
  try{
    const user=await getSessionUser(req);
    if(!user) return sendJson(res,401,{ok:false,error:"Please sign in to fund your wallet."});
    const walletAmountMinor=Number(body.amountUsdCents);
    if(!Number.isSafeInteger(walletAmountMinor)||walletAmountMinor<500||walletAmountMinor>100000)
      return sendJson(res,400,{ok:false,error:"Wallet funding must be between $5 and $1,000 per deposit."});
    const checkout=getCheckoutAmount(walletAmountMinor);
    if(checkout.currency!=="NGN") return sendJson(res,503,{ok:false,error:"Squad wallet deposits currently require NGN checkout conversion."});
    const paymentReference="VFWALLET_"+randomBytes(12).toString("hex").toUpperCase();
    const base=(process.env.PUBLIC_APP_URL||"https://verifyflow.us.ci").replace(/\/+$/,"");
    const callbackUrl=base+"/payment-return.html?paymentReference="+encodeURIComponent(paymentReference);
    const pool=getPool();
    await pool.query(
      "INSERT INTO vf_wallet_topups (user_id,payment_reference,payment_currency,payment_amount_minor,wallet_amount_minor,status,provider) VALUES ($1,$2,$3,$4,$5,'initiated','squad')",
      [user.id,paymentReference,checkout.currency,checkout.amountMinor,walletAmountMinor]
    );
    try{
      const initialized=await initiateSquadPayment({
        email:user.email, customerName:user.full_name, amountMinor:checkout.amountMinor,
        currency:checkout.currency, reference:paymentReference, callbackUrl,
        metadata:{type:"wallet_deposit",userId:user.id,walletAmountMinor}
      });
      await pool.query("UPDATE vf_wallet_topups SET checkout_url=$2,status='pending',provider_response=$3::jsonb,updated_at=NOW() WHERE payment_reference=$1",
        [paymentReference,initialized.checkoutUrl,JSON.stringify({provider:"squad",environment:process.env.SQUAD_ENVIRONMENT||"sandbox"})]);
      return sendJson(res,200,{ok:true,checkoutUrl:initialized.checkoutUrl,paymentReference,walletAmountMinor,paymentAmountMinor:checkout.amountMinor,currency:checkout.currency,usdNgnRate:checkout.usdNgnRate,provider:"squad",note:"Wallet funds are credited only after server-side Squad verification."});
    }catch(error){
      await pool.query("UPDATE vf_wallet_topups SET status='failed',provider_status='INITIALIZATION_FAILED',updated_at=NOW() WHERE payment_reference=$1",[paymentReference]).catch(()=>{});
      console.error("[wallet/deposit/squad]",error.code||error.message);
      return sendJson(res,502,{ok:false,error:"Squad could not start wallet funding. No wallet balance has been added."});
    }
  }catch(error){
    console.error("[wallet/deposit]",error.code||error.message);
    const messages={
      CHECKOUT_EXCHANGE_RATE_MISSING:"Local NGN wallet funding is not configured yet. Please contact support.",
      CHECKOUT_EXCHANGE_RATE_INVALID:"The local checkout exchange rate is invalid. Please contact support.",
      SQUAD_CONFIG_MISSING:"Squad sandbox credentials are not configured in Vercel yet."
    };
    return sendJson(res,503,{ok:false,error:messages[error.code]||"Wallet funding is temporarily unavailable."});
  }
};
