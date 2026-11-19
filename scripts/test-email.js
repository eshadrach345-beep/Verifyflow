const assert=require("node:assert/strict");
const {sendTransactionalEmail,sendVerificationEmail,sendPasswordResetEmail,isEmailConfigured}=require("../lib/email");
async function main(){
 const old={fetch:global.fetch,key:process.env.RESEND_API_KEY,from:process.env.VERIFYFLOW_EMAIL_FROM,url:process.env.PUBLIC_APP_URL},calls=[];
 process.env.RESEND_API_KEY="re_test_secret";process.env.VERIFYFLOW_EMAIL_FROM="VerifyFlow <accounts@example.com>";process.env.PUBLIC_APP_URL="https://verifyflow.example";
 global.fetch=async(url,options)=>{calls.push({url:String(url),options});return new Response(JSON.stringify({id:"email_test_123"}),{status:200});};
 try{
  assert.equal(isEmailConfigured(),true);const token="a".repeat(64);
  const result=await sendVerificationEmail({email:"customer@example.com",name:"<Customer>",token});
  assert.equal(result.id,"email_test_123");assert.equal(calls[0].url,"https://api.resend.com/emails");
  assert.equal(calls[0].options.headers.Authorization,"Bearer re_test_secret");
  assert(calls[0].options.headers["Idempotency-Key"].startsWith("verifyflow-verify-"));
  const verify=JSON.parse(calls[0].options.body);assert.equal(verify.to[0],"customer@example.com");assert(verify.html.includes("&lt;Customer&gt;"));
  assert(verify.text.includes("https://verifyflow.example/verify-email.html?token="+token));
  await sendPasswordResetEmail({email:"customer@example.com",name:"Customer",token:"b".repeat(64)});
  const reset=JSON.parse(calls[1].options.body);assert(calls[1].options.headers["Idempotency-Key"].startsWith("verifyflow-reset-"));
  assert(reset.text.includes("https://verifyflow.example/reset-password.html?token="+"b".repeat(64)));
  global.fetch=async()=>new Response(JSON.stringify({message:"forbidden"}),{status:403});
  await assert.rejects(()=>sendTransactionalEmail({to:"customer@example.com",subject:"x",html:"<p>x</p>",text:"x",idempotencyKey:"test-email-123"}),{code:"EMAIL_SENDER_NOT_AUTHORIZED"});
  process.env.RESEND_API_KEY="";assert.equal(isEmailConfigured(),false);
 }finally{
  global.fetch=old.fetch;
  if(old.key===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=old.key;
  if(old.from===undefined)delete process.env.VERIFYFLOW_EMAIL_FROM;else process.env.VERIFYFLOW_EMAIL_FROM=old.from;
  if(old.url===undefined)delete process.env.PUBLIC_APP_URL;else process.env.PUBLIC_APP_URL=old.url;
 }
 console.log("Email service tests passed (API request, idempotency, escaping, links and safe errors).");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
