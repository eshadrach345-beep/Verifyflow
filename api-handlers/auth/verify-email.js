"use strict";
const {getPool,sendJson,readJson,sameOrigin,hashToken,issueSession,publicUser}=require("../../lib/auth");
module.exports=async function handler(req,res){
 if(req.method!=="POST"){res.setHeader("Allow","POST");return sendJson(res,405,{ok:false,error:"Method not allowed."});}
 if(!sameOrigin(req))return sendJson(res,403,{ok:false,error:"Request could not be verified."});
 let body;try{body=await readJson(req);}catch{return sendJson(res,400,{ok:false,error:"Please submit a valid verification request."});}
 const token=String(body.token||"").trim();
 if(!/^[a-f0-9]{64}$/i.test(token))return sendJson(res,400,{ok:false,error:"This verification link is invalid or has expired. Request a new link."});
 let client;
 try{
  client=await getPool().connect();await client.query("BEGIN");
  const found=await client.query("SELECT t.id AS token_id,u.id,u.email,u.full_name,u.status,u.created_at FROM vf_email_verification_tokens t JOIN vf_users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.consumed_at IS NULL AND t.expires_at>NOW() FOR UPDATE OF t,u",[hashToken(token)]);
  if(!found.rowCount||found.rows[0].status!=="pending_verification"){await client.query("ROLLBACK");return sendJson(res,400,{ok:false,error:"This verification link is invalid or has expired. Request a new link."});}
  const user=found.rows[0];
  await client.query("UPDATE vf_email_verification_tokens SET consumed_at=NOW() WHERE user_id=$1 AND consumed_at IS NULL",[user.id]);
  await client.query("UPDATE vf_users SET status='active',email_verified_at=NOW(),updated_at=NOW() WHERE id=$1",[user.id]);
  await issueSession(client,user.id,res);await client.query("COMMIT");
  return sendJson(res,200,{ok:true,verified:true,user:publicUser(user),message:"Your email is verified. Your account is ready."});
 }catch(error){if(client)await client.query("ROLLBACK").catch(()=>{});console.error("[auth/verify-email]",error.code||"VERIFY_EMAIL_FAILED");return sendJson(res,503,{ok:false,error:"Email verification is temporarily unavailable. Please try again."});}
 finally{client?.release();}
};
