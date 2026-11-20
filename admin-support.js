"use strict";
(() => {
 const list=document.getElementById("vf-support-list"),thread=document.getElementById("vf-support-thread"),form=document.getElementById("vf-support-reply-form");
 if(!list||!thread||!form)return;
 let selected=null, threadBusy=false;
 const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
 const request=async(url,options={})=>{const r=await fetch(url,{credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json",Accept:"application/json",...(options.headers||{})},...options});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||"Support inbox unavailable.");return d;};
 async function loadList(){try{const d=await request("/api/admin/support");list.innerHTML=d.conversations.length?d.conversations.map(c=>'<button type="button" class="vf-support-ticket '+(c.id===selected?"active":"")+'" data-ticket="'+esc(c.id)+'"><b>'+esc(c.full_name||c.email)+'</b><span>'+esc(c.email)+'</span><small><strong>'+esc(c.status==="human"?"Needs human reply":"AI handled")+'</strong> · '+esc(c.last_message||"No messages")+'</small></button>').join(""):'<p class="empty">No open support conversations.</p>';}catch(e){list.textContent=e.message;}}
 async function loadThread(id=selected){
  if(!id||threadBusy)return;
  threadBusy=true;
  try{
   const d=await request("/api/admin/support?conversationId="+encodeURIComponent(id));
   if(selected!==id)return;
   const box=thread.querySelector(".vf-support-admin-messages");
   const oldCount=box?.children.length||0;
   thread.innerHTML='<header><b>'+esc(d.conversation.full_name||d.conversation.email)+'</b><small>'+esc(d.conversation.email)+' · '+esc(d.conversation.status)+'</small></header><div class="vf-support-admin-messages" aria-live="polite">'+d.messages.map(m=>'<article class="'+esc(m.sender_role)+'"><b>'+esc(m.sender_role==="admin"?"You":m.sender_role==="assistant"?"Site assistant":"Customer")+'</b><p>'+esc(m.message)+'</p><small>'+esc(new Date(m.created_at).toLocaleString())+'</small></article>').join("")+'</div>';
   const messages=thread.querySelector(".vf-support-admin-messages");
   if(messages&&(messages.children.length!==oldCount||!box))messages.scrollTop=messages.scrollHeight;
  }catch(e){thread.textContent=e.message;}
  finally{threadBusy=false;}
 }
 async function open(id){selected=id;await loadList();await loadThread(id);}
 list.addEventListener("click",e=>{const button=e.target.closest("[data-ticket]");if(button)open(button.dataset.ticket);});
 form.addEventListener("submit",async e=>{e.preventDefault();const message=form.querySelector("textarea").value.trim();if(!selected||!message)return;const button=form.querySelector("button");button.disabled=true;try{await request("/api/admin/support",{method:"POST",body:JSON.stringify({conversationId:selected,message})});form.querySelector("textarea").value="";await loadThread(selected);await loadList();}catch(err){alert(err.message);}finally{button.disabled=false;}});
 loadList();
 setInterval(()=>{loadList();loadThread();},8000);
})();
