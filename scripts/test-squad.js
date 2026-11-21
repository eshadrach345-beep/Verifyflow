"use strict";
const assert=require("node:assert/strict");
const { createHmac }=require("node:crypto");
const { verifySquadWebhook,getSquadConfig,initiateSquadPayment,verifySquadTransaction }=require("../lib/squad");
process.env.SQUAD_SECRET_KEY="test_squad_secret";
process.env.SQUAD_API_BASE_URL="https://sandbox-api-d.squadco.com";
process.env.SQUAD_ENVIRONMENT="sandbox";
assert.equal(getSquadConfig().environment,"sandbox");
const raw=Buffer.from(JSON.stringify({Event:"charge_successful",TransactionRef:"VFTEST"}));
const signature=createHmac("sha512",process.env.SQUAD_SECRET_KEY).update(raw).digest("hex");
assert.equal(verifySquadWebhook(raw,signature),true);
assert.equal(verifySquadWebhook(raw,"0".repeat(128)),false);
assert.equal(verifySquadWebhook(Buffer.from(raw.toString()+" "),signature),false);
assert.equal(verifySquadWebhook(raw,""),false);

async function main(){
 let captured;
 global.fetch=async(url,options)=>{
  captured={url,options};
  const data=String(url).includes("/transaction/verify/")
   ?{success:true,data:{transaction_ref:"VF_TEST",transaction_status:"Success",transaction_amount:12500,transaction_currency_id:"NGN",email:"test@example.com",gateway_transaction_ref:"GW_1"}}
   :{success:true,data:{checkout_url:"https://sandbox-pay.squadco.com/VF_TEST"}};
  return new Response(JSON.stringify(data),{status:200,headers:{"Content-Type":"application/json"}});
 };
 const started=await initiateSquadPayment({email:"test@example.com",customerName:"Test User",amountMinor:12500,currency:"NGN",reference:"VF_TEST",callbackUrl:"https://verifyflow.us.ci/payment-return.html?paymentReference=VF_TEST",metadata:{type:"test"}});
 assert.equal(started.checkoutUrl,"https://sandbox-pay.squadco.com/VF_TEST");
 const request=JSON.parse(captured.options.body);
 assert.deepEqual(request.payment_channels,["card","bank","ussd","transfer"]);
 assert.equal(request.amount,12500);
 assert.equal(request.transaction_ref,"VF_TEST");
 const verified=await verifySquadTransaction("VF_TEST");
 assert.equal(verified.reference,"VF_TEST");
 assert.equal(verified.status,"success");
 assert.equal(verified.amountMinor,12500);
 assert.equal(verified.currency,"NGN");
 assert.equal(verified.gatewayReference,"GW_1");
 console.log("Squad helper tests passed (checkout payload, verification mapping and webhook HMAC).");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
