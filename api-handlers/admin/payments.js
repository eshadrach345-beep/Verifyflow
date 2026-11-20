"use strict";
const { getPool,getSessionUser,sendJson }=require("../../lib/auth");
function admins(){return String(process.env.VERIFYFLOW_ADMIN_EMAILS||"").split(",").map(v=>v.trim().toLowerCase()).filter(Boolean);}
module.exports=async function handler(req,res){
 if(req.method!=="GET"){res.setHeader("Allow","GET");return sendJson(res,405,{ok:false,error:"Method not allowed."});}
 try{
  const user=await getSessionUser(req);if(!user)return sendJson(res,401,{ok:false,error:"Please sign in."});
  const allow=admins();if(!allow.length)return sendJson(res,503,{ok:false,error:"Admin access is not configured."});
  if(!allow.includes(String(user.email||"").toLowerCase()))return sendJson(res,403,{ok:false,error:"You do not have admin access."});
  const rows=await getPool().query(
   "SELECT t.payment_reference,t.provider,t.payment_currency AS currency,t.payment_amount_minor AS amount_minor,t.wallet_amount_minor AS wallet_amount_minor,t.status,t.provider_status,t.created_at,u.email AS customer_email,'wallet_deposit' AS payment_type FROM vf_wallet_topups t JOIN vf_users u ON u.id=t.user_id "+
   "UNION ALL "+
   "SELECT p.payment_reference,p.provider,p.currency,p.amount_minor,NULL AS wallet_amount_minor,p.status,p.provider_status,p.created_at,u.email AS customer_email,'product_order' AS payment_type FROM vf_payments p JOIN vf_orders o ON o.id=p.order_id JOIN vf_users u ON u.id=o.user_id "+
   "ORDER BY created_at DESC LIMIT 300"
  );
  const events=await getPool().query("SELECT provider,event_type,payment_reference,received_at AS created_at FROM vf_payment_webhook_events ORDER BY created_at DESC LIMIT 100");
  return sendJson(res,200,{
   ok:true,
   payments:rows.rows.map(r=>({...r,amountMinor:Number(r.amount_minor),walletAmountMinor:r.wallet_amount_minor==null?null:Number(r.wallet_amount_minor)})),
   webhookEvents:events.rows
  });
 }catch(error){console.error("[admin/payments]",error.code||error.message);return sendJson(res,503,{ok:false,error:"Payment records are temporarily unavailable."});}
};
