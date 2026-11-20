"use strict";
(() => {
 const form=document.getElementById("admin-login-form");
 const message=document.getElementById("admin-login-message");
 const existing=document.getElementById("admin-login-existing");
 const existingMessage=document.getElementById("admin-login-existing-message");
 const switchButton=document.getElementById("admin-login-switch");
 const submit=document.getElementById("admin-login-submit");
 const params=new URLSearchParams(window.location.search);
 const destination=params.get("next")==="/admin.html"?"/admin.html":"/admin.html";
 const request=async(url,options={})=>{
  const response=await fetch(url,{credentials:"same-origin",cache:"no-store",headers:{Accept:"application/json",...(options.headers||{})},...options});
  const data=await response.json().catch(()=>({}));
  return {response,data};
 };
 async function checkSession(){
  try{
   const {response,data}=await request("/api/admin/access");
   if(response.ok&&data.ok){window.location.replace(destination);return;}
   if(response.status===403){
    form.hidden=false;existing.hidden=false;
    existingMessage.textContent="This signed-in account does not have admin permission. Enter the email and password for the account assigned VerifyFlow admin access, or sign out first.";
   }else if(response.status===503){
    message.textContent=data.error||"Admin access is not configured. Ask the site owner to check the server admin access setting.";
   }
  }catch{message.textContent="Could not check admin access. Please try again.";}
 }
 switchButton.addEventListener("click",async()=>{
  switchButton.disabled=true;
  try{
   await request("/api/auth/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
   existing.hidden=true;form.hidden=false;message.textContent="You are signed out. Sign in with your admin account.";
  }catch{existingMessage.textContent="Could not sign out. Please refresh and try again.";}
  finally{switchButton.disabled=false;}
 });
 form.addEventListener("submit",async event=>{
  event.preventDefault();
  const email=document.getElementById("admin-email").value.trim();
  const password=document.getElementById("admin-password").value;
  if(!email||!password){message.textContent="Enter your admin email and password.";return;}
  submit.disabled=true;submit.textContent="Checking admin account…";message.textContent="";
  try{
   const login=await request("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password})});
   if(!login.response.ok||!login.data.ok){
    message.textContent=login.data.error||"Sign-in failed. Check your details and try again.";
    return;
   }
   const access=await request("/api/admin/access");
   if(!access.response.ok||!access.data.ok){
    await request("/api/auth/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).catch(()=>{});
    message.textContent=access.data.error==="Not authorized."?"This account is signed in but is not assigned VerifyFlow admin access.":"Admin access could not be verified. Please contact the site owner.";
    return;
   }
   window.location.replace(destination);
  }catch(error){message.textContent="Sign-in is temporarily unavailable. Please try again.";}
  finally{submit.disabled=false;submit.textContent="Sign in to admin";}
 });
 checkSession();
})();
