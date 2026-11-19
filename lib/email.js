"use strict";
const { createHash } = require("node:crypto");
function htmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
function emailConfiguration() {
  const apiKey=String(process.env.RESEND_API_KEY||"").trim();
  const from=String(process.env.VERIFYFLOW_EMAIL_FROM||"").trim();
  if(!apiKey||!from){const e=new Error("Transactional email is not configured.");e.code="EMAIL_NOT_CONFIGURED";throw e;}
  const mailbox=from.includes("<")?((from.match(/<([^<>]+)>/)||[])[1]||""):from;
  if(from.length>254||!/^[^\s<>@]+@[^\s@]+\.[^\s@]+$/.test(mailbox)){const e=new Error("Invalid sender address.");e.code="EMAIL_SENDER_INVALID";throw e;}
  return {apiKey,from};
}
function publicAppUrl(){
  const value=String(process.env.PUBLIC_APP_URL||"https://verifyflow.us.ci").trim();
  try{const url=new URL(value);if(url.protocol!=="https:"||url.username||url.password)throw new Error("invalid");return url.origin;}
  catch{const e=new Error("The public application URL must be a valid HTTPS origin.");e.code="EMAIL_APP_URL_INVALID";throw e;}
}
async function sendTransactionalEmail({to,subject,html,text,idempotencyKey}){
  const {apiKey,from}=emailConfiguration();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to||""))||!subject||!html||!text||typeof idempotencyKey!=="string"||!/^[A-Za-z0-9._:-]{8,256}$/.test(idempotencyKey)){
    const e=new Error("Invalid transactional email request.");e.code="EMAIL_REQUEST_INVALID";throw e;
  }
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{
      Authorization:"Bearer "+apiKey,"Content-Type":"application/json",Accept:"application/json","Idempotency-Key":idempotencyKey
    },body:JSON.stringify({from,to:[to],subject,html,text}),signal:controller.signal});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||!payload.id){const e=new Error("The email provider did not accept the message.");e.code=response.status===401?"EMAIL_PROVIDER_AUTH_FAILED":response.status===403?"EMAIL_SENDER_NOT_AUTHORIZED":response.status===429?"EMAIL_PROVIDER_RATE_LIMITED":"EMAIL_PROVIDER_ERROR";throw e;}
    return {id:String(payload.id)};
  }finally{clearTimeout(timer);}
}
function idem(kind,token){return "verifyflow-"+kind+"-"+createHash("sha256").update(kind+":"+token).digest("hex").slice(0,48);}
async function sendVerificationEmail({email,name,token}){
  const link=publicAppUrl()+"/verify-email.html?token="+encodeURIComponent(token),safeName=htmlEscape(name||"there");
  const html="<div style=\"font-family:Arial,sans-serif;max-width:560px;margin:32px auto;color:#172033;line-height:1.6\"><h1>Verify your VerifyFlow email</h1><p>Hello "+safeName+",</p><p>Confirm this email address to activate your account.</p><p><a href=\""+htmlEscape(link)+"\">Verify email address</a></p><p>This link expires in 24 hours. If you did not create this account, ignore this message.</p><p>"+htmlEscape(link)+"</p></div>";
  const text="Hello "+(name||"there")+",\n\nVerify your VerifyFlow email address: "+link+"\n\nThis link expires in 24 hours. If you did not create this account, ignore this message.";
  return sendTransactionalEmail({to:email,subject:"Verify your VerifyFlow email",html,text,idempotencyKey:idem("verify",token)});
}
async function sendPasswordResetEmail({email,name,token}){
  const link=publicAppUrl()+"/reset-password.html?token="+encodeURIComponent(token),safeName=htmlEscape(name||"there");
  const html="<div style=\"font-family:Arial,sans-serif;max-width:560px;margin:32px auto;color:#172033;line-height:1.6\"><h1>Reset your VerifyFlow password</h1><p>Hello "+safeName+",</p><p>We received a request to reset your password.</p><p><a href=\""+htmlEscape(link)+"\">Choose a new password</a></p><p>This link expires in 1 hour. If you did not request this change, ignore this email.</p><p>"+htmlEscape(link)+"</p></div>";
  const text="Hello "+(name||"there")+",\n\nReset your VerifyFlow password: "+link+"\n\nThis link expires in 1 hour. If you did not request this change, ignore this message.";
  return sendTransactionalEmail({to:email,subject:"Reset your VerifyFlow password",html,text,idempotencyKey:idem("reset",token)});
}
function isEmailConfigured(){try{emailConfiguration();publicAppUrl();return true;}catch{return false;}}
module.exports={sendTransactionalEmail,sendVerificationEmail,sendPasswordResetEmail,isEmailConfigured,htmlEscape};
