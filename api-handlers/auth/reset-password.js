"use strict";
const {getPool,sendJson,readJson,sameOrigin,hashToken,hashPassword,issueSession,publicUser}=require("../../lib/auth");
module.exports=async function handler(req,res){
 if(req.method!=="POST"){res.setHeader("Allow","POST");return sendJson(res,405,{ok:false,error:"Method not allowed."});}
 if(!sameOrigin(req))return sendJson(res,403,{ok:false,error:"Request could not be verified."});
 let body;try{body=await readJson(req);}catch{return sendJson(res,400,{ok:false,error:"Please submit a valid password reset."});}
 const token=String(body.token||"").trim(),password=typeof body.password==="string"?body.password:"";
 if(!/^[a-f0-9]{64}$/i.test(token))return sendJson(res,400,{ok:false,error:"This password reset link is invalid or has expired."});
 if(password.length<10||password.length>128)return sendJson(res,400,{ok:false,error:"Use a password with at least 10 characters."});
 let client;
 try{
  const passwordHash=await hashPassword(password);client=await getPool().connect();await client.query("BEGIN");
  const found=await client.query("SELECT t.id AS token_id,u.id,u.email,u.full_name,u.created_at FROM vf_password_reset_tokens t JOIN vf_users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.consumed_at IS NULL AND t.expires_at>NOW() AND u.status='active' FOR UPDATE OF t,u",[hashToken(token)]);
  if(!found.rowCount){await client.query("ROLLBACK");return sendJson(res,400,{ok:false,error:"This password reset link is invalid or has expired."});}
  const user=found.rows[0];
  await client.query("UPDATE vf_users SET password_hash=$2,updated_at=NOW() WHERE id=$1",[user.id,passwordHash]);
  await client.query("UPDATE vf_password_reset_tokens SET consumed_at=NOW() WHERE user_id=$1 AND consumed_at IS NULL",[user.id]);
  await client.query("DELETE FROM vf_sessions WHERE user_id=$1",[user.id]);
  await issueSession(client,user.id,res);await client.query("COMMIT");
  return sendJson(res,200,{ok:true,user:publicUser(user),message:"Your password has been updated."});
 }catch(error){if(client)await client.query("ROLLBACK").catch(()=>{});console.error("[auth/reset-password]",error.code||"PASSWORD_RESET_FAILED");return sendJson(res,503,{ok:false,error:"Your password could not be updated right now. Please try again."});}
 finally{client?.release();}
};
