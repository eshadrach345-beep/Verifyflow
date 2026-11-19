"use strict";
(() => {
 const params=new URLSearchParams(window.location.search),token=params.get("token")||"",validToken=/^[a-f0-9]{64}$/i.test(token);
 if(token)window.history.replaceState({},document.title,window.location.pathname);
 const setMessage=(el,value,error=false)=>{el.textContent=value;el.classList.toggle("error",error);el.style.color=error?"#b42318":"";};
 const forgot=document.getElementById("forgot-password-form");
 if(forgot)forgot.addEventListener("submit",async event=>{
  event.preventDefault();const message=document.getElementById("forgot-message"),button=forgot.querySelector('button[type="submit"]');
  if(!forgot.reportValidity())return;button.disabled=true;button.textContent="Sending…";setMessage(message,"");
  try{
   const response=await fetch("/api/auth/request-password-reset",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({email:document.getElementById("reset-email").value.trim()})});
   const data=await response.json().catch(()=>({}));if(!response.ok||!data.ok)throw new Error(data.error||"Please try again.");
   forgot.reset();setMessage(message,data.message||"If an active account exists, reset instructions will be sent.");
  }catch(error){setMessage(message,error.message||"We could not process that request.",true);}
  finally{button.disabled=false;button.textContent="Send reset link";}
 });
 const verify=document.getElementById("verify-email-button");
 if(verify){
  const message=document.getElementById("verify-message");
  if(!validToken){verify.disabled=true;setMessage(message,"This verification link is invalid. Request a new link from the sign-in page.",true);}
  verify.addEventListener("click",async()=>{
   if(!validToken)return;verify.disabled=true;verify.textContent="Verifying…";setMessage(message,"");
   try{
    const response=await fetch("/api/auth/verify-email",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({token})});
    const data=await response.json().catch(()=>({}));if(!response.ok||!data.ok)throw new Error(data.error||"This link could not be verified.");
    setMessage(message,"Your email is verified. Your account is ready.");verify.textContent="Email verified";
    window.setTimeout(()=>window.location.assign("/account.html"),1200);
   }catch(error){setMessage(message,error.message||"This link could not be verified.",true);verify.disabled=false;verify.textContent="Try verification again";}
  });
 }
 const reset=document.getElementById("reset-password-form");
 if(reset){
  const message=document.getElementById("reset-message");
  if(!validToken){reset.querySelector('button[type="submit"]').disabled=true;setMessage(message,"This password reset link is invalid or has expired. Request another link.",true);}
  reset.addEventListener("submit",async event=>{
   event.preventDefault();if(!validToken||!reset.reportValidity())return;
   const password=document.getElementById("new-password").value;
   if(password!==document.getElementById("confirm-password").value){setMessage(message,"The passwords do not match.",true);return;}
   const button=reset.querySelector('button[type="submit"]');button.disabled=true;button.textContent="Updating…";setMessage(message,"");
   try{
    const response=await fetch("/api/auth/reset-password",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({token,password})});
    const data=await response.json().catch(()=>({}));if(!response.ok||!data.ok)throw new Error(data.error||"Your password could not be updated.");
    reset.reset();setMessage(message,"Your password has been changed. Redirecting to your account…");
    window.setTimeout(()=>window.location.assign("/account.html"),1200);
   }catch(error){setMessage(message,error.message||"Your password could not be updated.",true);button.disabled=false;button.textContent="Update password";}
  });
 }
})();
