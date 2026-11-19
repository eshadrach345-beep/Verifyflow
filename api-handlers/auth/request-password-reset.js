"use strict";
const {randomBytes}=require("node:crypto");
const {getPool,sendJson,readJson,sameOrigin,hashToken}=require("../../lib/auth");
const {enforceAuthRateLimit,pruneExpiredRateLimits}=require("../../lib/rate-limit");
const {sendPasswordResetEmail,isEmailConfigured}=require("../../lib/email");
module.exports=async function handler(req,res){
 if(req.method!=="POST"){res.setHeader("Allow","POST");return sendJson(res,405,{ok:false,error:"Method not allowed."});}
 if(!sameOrigin(req))return sendJson(res,403,{ok:false,error:"Request could not be verified."});
 let body;try{body=await readJson(req);}catch{return sendJson(res,400,{ok:false,error:"Please submit a valid request."});}
 const email=String(body.email||"").trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return sendJson(res,400,{ok:false,error:"Enter a valid email address."});
 try{
  if(await enforceAuthRateLimit(req,res,{scope:"password-reset",identifier:email,ipLimit:10,identityLimit:3,windowSeconds:3600}))return;
  await pruneExpiredRateLimits();const db=getPool();
  const found=await db.query("SELECT id,email,full_name FROM vf_users WHERE email=$1 AND status='active' LIMIT 1",[email]);
  if(found.rowCount&&isEmailConfigured()){
   const user=found.rows[0],token=randomBytes(32).toString("hex"),client=await db.connect();
   try{await client.query("BEGIN");
    await client.query("UPDATE vf_password_reset_tokens SET consumed_at=NOW() WHERE user_id=$1 AND consumed_at IS NULL",[user.id]);
    await client.query("INSERT INTO vf_password_reset_tokens(user_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 hour')",[user.id,hashToken(token)]);
    await client.query("COMMIT");
   }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
   try{await sendPasswordResetEmail({email:user.email,name:user.full_name,token});}catch(error){console.error("[auth/password-reset-email]",error.code||"EMAIL_SEND_FAILED");}
  }
  return sendJson(res,200,{ok:true,message:"If an active account exists for that address, password reset instructions will be sent."});
 }catch(error){console.error("[auth/request-password-reset]",error.code||"RESET_REQUEST_FAILED");return sendJson(res,503,{ok:false,error:"We could not process that request right now. Please try again."});}
};
