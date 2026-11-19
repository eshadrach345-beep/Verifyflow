"use strict";
(() => {
 const root=document.getElementById("vf-support-widget");
 if(!root)return;
 const panel=root.querySelector(".vf-support-panel"),toggle=root.querySelector(".vf-support-toggle");
 const messages=root.querySelector(".vf-support-messages"),form=root.querySelector("form"),input=root.querySelector("textarea"),status=root.querySelector(".vf-support-status"),human=root.querySelector(".vf-support-human");
 let busy=false;
 const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
 const add=(role,text)=>{const el=document.createElement("div");el.className="vf-support-message "+role;el.textContent=text;messages.append(el);messages.scrollTop=messages.scrollHeight;};
 const request=async(url,options={})=>{const r=await fetch(url,{credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json",Accept:"application/json",...(options.headers||{})},...options});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||"Support is temporarily unavailable.");return d;};
 async function load(){try{const d=await request("/api/support/chat");messages.replaceChildren();if(!d.conversation){add("assistant","Hi! I'm VerifyFlow's AI assistant. Tell me what you're having trouble with, and I'll try to help. You can ask for a human support agent at any time.");return;}d.messages.forEach(m=>add(m.sender_role==="customer"?"customer":"assistant",m.message));status.textContent=d.conversation.status==="human"?"A human support agent will reply here.":"AI assistant is ready";}catch(e){status.textContent=e.message;}}
 async function send(message,handoff=false){if(busy)return;busy=true;form.querySelector("button[type=submit]").disabled=true;try{const d=await request("/api/support/chat",{method:"POST",body:JSON.stringify({message,handoff})});if(message)add("customer",message);if(d.reply)add("assistant",d.reply);if(d.handedOff)add("assistant","Your conversation has been handed to customer support. An admin will reply here.");if(d.status==="human")status.textContent="Waiting for a human support reply";input.value="";}catch(e){status.textContent=e.message;}finally{busy=false;form.querySelector("button[type=submit]").disabled=false;}}
 toggle.addEventListener("click",()=>{const open=panel.hidden;panel.hidden=!open;toggle.setAttribute("aria-expanded",String(open));if(open)load();});
 form.addEventListener("submit",e=>{e.preventDefault();const value=input.value.trim();if(value)send(value);});
 human.addEventListener("click",()=>send("Please connect me to a human customer support agent.",true));
})();
