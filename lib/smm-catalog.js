"use strict";

const PROVIDERS = {
  peakerr: { label: "Peakerr", url: "https://peakerr.com/api/v2", keyEnv: "PEAKERR_API_KEY" },
  justanotherpanel: { label: "JustAnotherPanel", url: "https://justanotherpanel.com/api/v2", keyEnv: "JUSTANOTHERPANEL_API_KEY" }
};

// Only clearly described creative/marketing work is included in this monitor.
// Purchased engagement, artificial traffic and metric manipulation are excluded.
const SAFE_SERVICE_TERMS = [
  "content creation", "video editing", "graphic design", "creative design",
  "social media ads", "advertising campaign", "ad campaign management",
  "analytics report", "social media audit", "seo audit", "marketing consultation",
  "content strategy", "brand strategy"
];
const BLOCKED_SERVICE_TERMS = [
  "follower", "subscriber", "like", "view", "watch time", "member",
  "reaction", "comment", "review", "rating", "traffic", "impression",
  "share", "save", "vote", "backlink", "boost", "engagement"
];

function serviceIsEligible(service) {
  const haystack=[service?.name,service?.category,service?.description,service?.type]
    .filter(value=>typeof value==="string").join(" ").toLowerCase();
  if(!haystack||BLOCKED_SERVICE_TERMS.some(term=>haystack.includes(term)))return false;
  return SAFE_SERVICE_TERMS.some(term=>haystack.includes(term));
}
function currencyCode(value) {
  const code=String(value||"").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code)?code:null;
}
function numericValue(value) {
  if(value===null||value===undefined||value==="")return null;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:null;
}
async function panelRequest(provider,key,action) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);
  try {
    const body=new URLSearchParams({key,action});
    const response=await fetch(provider.url,{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},
      body,signal:controller.signal
    });
    const payload=await response.json().catch(()=>null);
    if(!response.ok||!payload||payload.error){
      const error=new Error("Supplier API request failed");
      error.code=response.status===401?"INVALID_SUPPLIER_KEY":"SUPPLIER_API_ERROR";
      throw error;
    }
    return payload;
  }finally{clearTimeout(timeout);}
}
async function readProvider(providerKey) {
  const provider=PROVIDERS[providerKey];
  if(!provider)throw new Error("Unknown supplier provider.");
  const key=process.env[provider.keyEnv];
  if(!key){
    return {provider:providerKey,label:provider.label,connected:false,message:"API key not configured.",
      balance:null,currency:null,eligibleServices:[],eligibleCount:0,totalServices:null};
  }
  try {
    const [balanceData,servicesData]=await Promise.all([
      panelRequest(provider,key,"balance"),
      panelRequest(provider,key,"services")
    ]);
    const services=Array.isArray(servicesData)?servicesData:
      Array.isArray(servicesData?.services)?servicesData.services:[];
    const walletBalance=numericValue(balanceData?.balance);
    const walletCurrency=currencyCode(balanceData?.currency);
    const eligibleServices=services.filter(serviceIsEligible).map(service=>{
      const rawRate=service.rate===undefined||service.rate===null?"":String(service.rate).trim().slice(0,40);
      const min=numericValue(service.min),max=numericValue(service.max);
      return {
        id:String(service.service??service.id??""),
        name:String(service.name||"Marketing service").slice(0,180),
        category:String(service.category||service.type||"Marketing").slice(0,100),
        supplierRateReported:rawRate||null,
        rateUnitConfirmed:false,
        rateCurrencyConfirmed:false,
        min:min===null?1:min,
        max:max===null?1:max,
        refill:Boolean(service.refill),
        cancel:Boolean(service.cancel)
      };
    }).filter(service=>service.id&&Number.isFinite(service.min)&&Number.isFinite(service.max)&&service.max>=service.min);
    return {
      provider:providerKey,label:provider.label,connected:true,message:null,
      balance:walletBalance,currency:walletCurrency,
      eligibleServices,eligibleCount:eligibleServices.length,totalServices:services.length
    };
  }catch(error){
    console.error("[smm-provider]",providerKey,error.code||error.message);
    return {
      provider:providerKey,label:provider.label,connected:false,
      message:error.code==="INVALID_SUPPLIER_KEY"?"Supplier rejected the API key.":"Supplier API could not be reached.",
      balance:null,currency:null,eligibleServices:[],eligibleCount:0,totalServices:null
    };
  }
}
module.exports={readProvider,serviceIsEligible,currencyCode,numericValue};
