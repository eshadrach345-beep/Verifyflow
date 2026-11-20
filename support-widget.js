"use strict";
(() => {
 const root=document.getElementById("vf-support-widget");
 if(!root)return;
 const panel=root.querySelector(".vf-support-panel"),toggle=root.querySelector(".vf-support-toggle");
 const messages=root.querySelector(".vf-support-messages"),form=root.querySelector("form"),input=root.querySelector("textarea"),status=root.querySelector(".vf-support-status"),human=root.querySelector(".vf-support-human");
 let busy=false,guestMode=false;
 const add=(role,text)=>{const el=document.createElement("div");el.className="vf-support-message "+role;el.textContent=text;messages.append(el);messages.scrollTop=messages.scrollHeight;};
 const request=async(url,options={})=>{const r=await fetch(url,{credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json",Accept:"application/json",...(options.headers||{})},...options});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok){const error=new Error(d.error||"Support is temporarily unavailable.");error.signInUrl=d.signInUrl||null;throw error;}return d;};
 const showSignInPrompt=()=>{
  status.replaceChildren(document.createTextNode("To chat with a human support agent, "));
  const link=document.createElement("a");link.href="/account.html";link.textContent="sign in or create an account";
  status.append(link,document.createTextNode("."));
 };
 async function load(){
  try{
   const d=await request("/api/support/chat");
   guestMode=Boolean(d.guest);
   messages.replaceChildren();
   if(!d.conversation){
    add("assistant","Hi! I'm VerifyFlow's help assistant. Ask me about creating an account, email verification, SMS orders, rentals, eSIM, proxies, Social Media Boosters, checkout or tracking an order.");
    status.textContent=guestMode?"Instant help is available without signing in. Sign in to request a human reply.":"Help assistant is ready.";
    return;
   }
   d.messages.forEach(m=>add(m.sender_role==="customer"?"customer":"assistant",m.message));
   status.textContent=d.conversation.status==="human"?"A human support agent will reply here.":"Help assistant is ready";
  }catch(e){status.textContent=e.message;}
 }
 async function send(message,handoff=false){
  if(busy)return;
  busy=true;form.querySelector("button[type=submit]").disabled=true;
  try{
   const d=await request("/api/support/chat",{method:"POST",body:JSON.stringify({message,handoff})});
   if(message)add("customer",message);
   if(d.reply)add("assistant",d.reply);
   if(d.handedOff)add("assistant","Your conversation has been handed to customer support. An admin will reply here.");
   if(d.status==="human")status.textContent="Waiting for a human support reply";
   else if(d.status==="guest")status.textContent="Instant help only. Sign in to save a conversation and request a human reply.";
   input.value="";
  }catch(e){
   status.textContent=e.message;
   if(e.signInUrl)showSignInPrompt();
  }finally{busy=false;form.querySelector("button[type=submit]").disabled=false;}
 }
 toggle.addEventListener("click",()=>{const open=panel.hidden;panel.hidden=!open;toggle.setAttribute("aria-expanded",String(open));if(open)load();});
 setInterval(()=>{if(!panel.hidden&&!busy&&!guestMode)load();},12000);
 form.addEventListener("submit",e=>{e.preventDefault();const value=input.value.trim();if(value)send(value);});
 human.addEventListener("click",()=>{if(guestMode){showSignInPrompt();return;}send("Please connect me to a human customer support agent.",true);});
})();
