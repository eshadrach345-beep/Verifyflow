const assert=require("node:assert/strict");
const {readProvider,serviceIsEligible,currencyCode,numericValue}=require("../lib/smm-catalog");
async function main(){
 assert.equal(serviceIsEligible({name:"Professional video editing"}),true);
 assert.equal(serviceIsEligible({name:"Instagram followers"}),false);
 assert.equal(serviceIsEligible({name:"SEO audit and bought traffic"}),false);
 assert.equal(currencyCode("usd"),"USD");
 assert.equal(currencyCode("US"),null);
 assert.equal(numericValue("12.5"),12.5);
 assert.equal(numericValue("not-a-number"),null);
 const old={fetch:global.fetch,peak:process.env.PEAKERR_API_KEY,jap:process.env.JUSTANOTHERPANEL_API_KEY};
 process.env.PEAKERR_API_KEY="test-peakerr";process.env.JUSTANOTHERPANEL_API_KEY="test-jap";
 const requests=[];
 global.fetch=async(url,options)=>{
  const form=new URLSearchParams(options.body),action=form.get("action");
  requests.push({url:String(url),action});
  const payload=action==="balance"?{balance:"123.45",currency:"NGN"}:[
   {service:10,name:"Professional video editing",category:"Creative",rate:"25.50",min:"1",max:"10"},
   {service:11,name:"Instagram followers",category:"Growth",rate:"0.80",min:"50",max:"50000"},
   {service:12,name:"Social media audit",category:"Consulting",rate:"90",min:"1",max:"1"}
  ];
  return new Response(JSON.stringify(payload),{status:200,headers:{"Content-Type":"application/json"}});
 };
 try{
  const provider=await readProvider("peakerr");
  assert.equal(provider.connected,true);
  assert.equal(provider.balance,123.45);
  assert.equal(provider.currency,"NGN");
  assert.equal(provider.totalServices,3);
  assert.equal(provider.eligibleCount,2);
  assert.equal(provider.eligibleServices[0].supplierRateReported,"25.50");
  assert.equal(provider.eligibleServices[0].rateUnitConfirmed,false);
  assert.equal(provider.eligibleServices[0].rateCurrencyConfirmed,false);
  assert.equal(Object.hasOwn(provider.eligibleServices[0],"retailRatePerThousandCents"),false);
  assert(requests.every(x=>x.url==="https://peakerr.com/api/v2"));
 }finally{
  global.fetch=old.fetch;
  if(old.peak===undefined)delete process.env.PEAKERR_API_KEY;else process.env.PEAKERR_API_KEY=old.peak;
  if(old.jap===undefined)delete process.env.JUSTANOTHERPANEL_API_KEY;else process.env.JUSTANOTHERPANEL_API_KEY=old.jap;
 }
 console.log("SMM supplier monitor tests passed (safe catalogue allowlist and unassumed rate units/currency).");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
