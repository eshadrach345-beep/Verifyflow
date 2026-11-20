"use strict";
(() => {
 const input=document.getElementById("faq-search");
 const items=[...document.querySelectorAll(".faq-item")];
 const sections=[...document.querySelectorAll("[data-faq-section]")];
 const empty=document.getElementById("faq-no-results");
 if(!input)return;
 input.addEventListener("input",()=>{
  const query=input.value.trim().toLowerCase();
  let visibleTotal=0;
  sections.forEach(section=>{
   let sectionVisible=0;
   section.querySelectorAll(".faq-item").forEach(item=>{
    const visible=!query||item.textContent.toLowerCase().includes(query);
    item.hidden=!visible;
    if(visible)sectionVisible++;
   });
   section.hidden=sectionVisible===0;
   visibleTotal+=sectionVisible;
  });
  empty.style.display=visibleTotal?"none":"block";
 });
 items.forEach(item=>item.addEventListener("toggle",()=>{
  if(!item.open)return;
  items.filter(other=>other!==item&&other.open).forEach(other=>{other.open=false;});
 }));
})();
