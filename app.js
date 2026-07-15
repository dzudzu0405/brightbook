const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let current=null,currentSettings=null;
let accountFeatures=new Set();
let accountUser=null;
let catalog={themes:[],activities:[]};
const views={creator:$("#creatorView"),projects:$("#projectsView"),templates:$("#templatesView")};
const titles={creator:"Activity Book Product Kit Creator",projects:"Saved Projects",templates:"Template Library"};
const typeNames={"word-search":"Word Search","coloring":"Coloring","educational-story":"Educational Story","maze":"Maze","tracing":"Tracing & Handwriting","matching":"Matching","counting":"Counting","simple-math":"Math Practice","spot-difference":"Spot the Difference","puzzle":"Children's Puzzle","learning-worksheet":"Educational Worksheet"};
const initialActivities=$$("#activityType option").map(o=>({value:o.value,label:o.textContent}));
const initialGenres=$$("#genreType option").map(o=>o.value);
const initialPageCounts=$$("#pageCount option").map(o=>o.value);
function userToken(){const qs=new URLSearchParams(location.search);const t=qs.get("token");if(t){localStorage.setItem("brightbookUserToken",t);return t}return localStorage.getItem("brightbookUserToken")||"demo-token"}
async function api(path,options={}){const r=await fetch(path,{...options,headers:{"Content-Type":"application/json","x-user-token":userToken(),...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Something went wrong.");return d}
function hasFeature(key){return accountFeatures.has(key)}
function themeInfo(name){return catalog.themes.find(t=>t.name===name)}
function genreInfo(name){return catalog.genres?.find(g=>g.name===name)}
function styleFromGenre(genreType){
  const map={
    "Classic Educational":"clean modern educational workbook illustration",
    "Cinematic Adventure":"cinematic children's adventure illustration with dynamic composition",
    "Fantasy Storybook":"whimsical fantasy storybook illustration",
    "Documentary Style":"clear educational documentary-style illustration",
    "Whimsical Cartoon":"cute whimsical cartoon illustration with bold clean shapes",
    "Cozy Storybook":"soft cozy children's storybook illustration",
    "Science Explorer":"bright science explorer educational illustration",
    "Magical World":"magical child-friendly fantasy illustration",
    "Realistic Classroom":"realistic clean classroom worksheet illustration",
    "Vintage Workbook":"vintage educational workbook illustration"
  };
  return map[genreType]||map["Classic Educational"];
}
function initials(name="",email=""){
  const source=(name||email||"BB").trim();
  const parts=source.split(/\s+/).filter(Boolean);
  return (parts.length>1?`${parts[0][0]}${parts[1][0]}`:source.slice(0,2)).toUpperCase();
}
function renderAccount(user){
  accountUser=user;
  if(!$("#accountButton"))return;
  const label=user.name||user.email||"BrightBook User";
  const init=initials(user.name,user.email);
  $("#accountAvatar").textContent=init;
  $("#accountName").textContent=label;
  $("#accountPlan").textContent=`${user.planName||"Creator"} plan`;
  $("#accountMenuName").textContent=label;
  $("#accountEmail").textContent=user.email||"";
  $("#accountMenuPlan").textContent=user.planName||"Creator";
  $("#accountStatus").textContent=user.status==="active"?"Active account":"Paused account";
}
async function loadAccount(){try{catalog=await api("/api/catalog");const d=await api("/api/me");accountFeatures=new Set(d.user.features||[]);renderAccount(d.user);applyFeatureGates()}catch(e){toast("Account unavailable",e.message)}}
function setPlainOptions(select,items,current){
  select.innerHTML=items.map(item=>`<option value="${esc(item.value)}">${esc(item.label)}</option>`).join("");
  if(items.some(item=>item.value===current))select.value=current;
  else if(items[0])select.value=items[0].value;
}
function setThemeOptions(items,current){
  const groups=items.reduce((acc,t)=>{(acc[t.category] ||= []).push(t);return acc},{});
  $("#theme").innerHTML=Object.entries(groups).map(([category,themes])=>`<optgroup label="${esc(category)}">${themes.map(t=>`<option value="${esc(t.name)}">${esc(t.name)}</option>`).join("")}</optgroup>`).join("");
  if(items.some(t=>t.name===current))$("#theme").value=current;
  else if(items[0])$("#theme").value=items[0].name;
}
function applyFeatureGates(){
  const previous={activity:$("#activityType").value,theme:$("#theme").value,genre:$("#genreType").value,pageCount:$("#pageCount").value};
  const planActivities=initialActivities.filter(a=>hasFeature(`activity.${a.value}`));
  setPlainOptions($("#activityType"),planActivities,previous.activity);

  let activity=$("#activityType").value;
  let genres=initialGenres.filter(name=>{
    const info=genreInfo(name);
    return info ? info.compatibleActivityTypes.includes(activity) : true;
  });
  setPlainOptions($("#genreType"),genres.map(value=>({value,label:value})),previous.genre);

  let genre=$("#genreType").value;
  let g=genreInfo(genre);
  let themes=(catalog.themes||[]).filter(t=>{
    const allowedByPlan=hasFeature(t.featureKey);
    const activityCompatible=t.compatibleActivityTypes.includes(activity);
    const genreCompatible=g ? g.compatibleThemes.includes(t.name) : true;
    return allowedByPlan&&activityCompatible&&genreCompatible;
  });
  setThemeOptions(themes,previous.theme);

  let theme=$("#theme").value;
  genres=initialGenres.filter(name=>{
    const info=genreInfo(name);
    return info ? info.compatibleActivityTypes.includes(activity)&&info.compatibleThemes.includes(theme) : true;
  });
  setPlainOptions($("#genreType"),genres.map(value=>({value,label:value})),genre);

  genre=$("#genreType").value;
  g=genreInfo(genre);
  const finalActivities=planActivities.filter(a=>{
    const t=themeInfo(theme);
    const activityThemeCompatible=t ? t.compatibleActivityTypes.includes(a.value) : true;
    const genreCompatible=g ? g.compatibleActivityTypes.includes(a.value) : true;
    return activityThemeCompatible&&genreCompatible;
  });
  setPlainOptions($("#activityType"),finalActivities.length?finalActivities:planActivities,$("#activityType").value);
  activity=$("#activityType").value;
  themes=(catalog.themes||[]).filter(t=>{
    const allowedByPlan=hasFeature(t.featureKey);
    const activityCompatible=t.compatibleActivityTypes.includes(activity);
    const genreCompatible=g ? g.compatibleThemes.includes(t.name) : true;
    return allowedByPlan&&activityCompatible&&genreCompatible;
  });
  setThemeOptions(themes,$("#theme").value);

  const pageCounts=initialPageCounts.filter(value=>hasFeature(`quantity.${value}`)).map(value=>({value,label:value}));
  setPlainOptions($("#pageCount"),pageCounts,previous.pageCount);
  $("#saveProject").disabled=!hasFeature("export.save-project");
  $("#exportJson").disabled=!hasFeature("export.json");
  $("#exportTxt").disabled=!hasFeature("export.txt");
  const canListing=hasFeature("kit.listing-assets");
  const canQuality=hasFeature("kit.quality-check")||hasFeature("kit.series-builder")||hasFeature("kit.launch-checklist");
  document.querySelector('[data-tab="listing"]')?.classList.toggle("hidden",!canListing);
  document.querySelector('[data-tab="quality"]')?.classList.toggle("hidden",!canQuality);
}
function toast(title,msg=""){const t=$("#toast");t.querySelector("strong").textContent=title;t.querySelector("small").textContent=msg;t.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove("show"),3000)}
function showView(name){Object.values(views).forEach(v=>v.classList.remove("active"));views[name].classList.add("active");$("#pageTitle").textContent=titles[name];$$("nav button").forEach(b=>b.classList.toggle("active",b.dataset.view===name));$(".sidebar").classList.remove("open");if(name==="projects")loadProjects();window.scrollTo({top:0,behavior:"smooth"})}
$$("nav button").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));$(".menu").addEventListener("click",()=>$(".sidebar").classList.toggle("open"));$("#newBook").addEventListener("click",()=>{reset();showView("creator")});
$("#activityType").addEventListener("change",applyFeatureGates);
$("#theme").addEventListener("change",applyFeatureGates);
$("#genreType").addEventListener("change",applyFeatureGates);
$("#accountButton")?.addEventListener("click",e=>{e.stopPropagation();$("#accountMenu")?.classList.toggle("hidden")});
document.addEventListener("click",e=>{if(!e.target.closest?.("#accountDock"))$("#accountMenu")?.classList.add("hidden")});
$("#copyAccountToken")?.addEventListener("click",async()=>{if(!accountUser?.token)return;await navigator.clipboard.writeText(accountUser.token);toast("Access token copied")});
$$("[data-template]").forEach(b=>b.addEventListener("click",()=>{$("#theme").value=b.dataset.theme;showView("creator");applyFeatureGates()}));
async function health(){try{const d=await api("/api/health");$("#generate").disabled=!d.ollama;if(!d.ollama)toast("Creator unavailable","The content engine is not ready yet.")}catch{$("#generate").disabled=true;toast("Connection unavailable","Please start the BrightBook service and try again.")}}
function settings(){const theme=$("#theme").value,activityType=$("#activityType").value,genreType=$("#genreType").value;return{topic:theme,theme,customDirection:"",activityType,activityTypes:[activityType],age:$("#age").value,language:$("#language").value,pageCount:Number($("#pageCount").value),genreType,difficulty:genreType,size:"A4",style:styleFromGenre(genreType),learningGoal:"",guideCharacter:""}}
$("#generate").addEventListener("click",async()=>{currentSettings=settings();$("#emptyPreview").classList.add("hidden");$("#result").classList.add("hidden");$("#loading").classList.remove("hidden");const btn=$("#generate");btn.classList.add("loading");btn.querySelector("strong").textContent="Generating...";const msgs=["Preparing the first product kit batch","Building unique concepts for your theme","Writing consistent image prompts","Creating answer keys and learning goals","Drafting listing assets and keywords","Checking the complete publishing kit"];let i=0;const timer=setInterval(()=>$("#loadingText").textContent=msgs[++i%msgs.length],5000);try{const d=await api("/api/generate",{method:"POST",body:JSON.stringify(currentSettings)});current=d.book;if(!current.pages||current.pages.length!==currentSettings.pageCount)throw new Error(`Expected ${currentSettings.pageCount} prompts, but received ${current.pages?.length||0}. Please generate again.`);render(current);toast("Your product kit is ready",`${current.pages.length} pages were created.`)}catch(e){$("#loading").classList.add("hidden");$("#emptyPreview").classList.remove("hidden");toast("Unable to create your product kit",e.message)}finally{clearInterval(timer);btn.classList.remove("loading");btn.querySelector("strong").textContent="Generate Product Kit"}});
function listHtml(items=[]){return items.length?items.map(item=>`<li>${esc(item)}</li>`).join(""):"<li>No issues found.</li>"}
function tagHtml(items=[]){return items.map(item=>`<span>${esc(item)}</span>`).join("")}
function renderPublishingKit(book){
  const listing=book.listing_assets||{};
  const quality=book.quality_check||{};
  $("#kdpTitle").textContent=listing.kdp_title||book.book_title||"";
  $("#kdpSubtitle").textContent=listing.kdp_subtitle||book.subtitle||"";
  $("#kdpDescription").textContent=listing.kdp_description||book.description||"";
  $("#backendKeywords").innerHTML=tagHtml(listing.backend_keywords||[]);
  $("#etsyTitle").textContent=listing.etsy_title||book.book_title||"";
  $("#etsyTags").innerHTML=tagHtml(listing.etsy_tags||[]);
  $("#aPlusSections").innerHTML=listHtml(listing.a_plus_sections||[]);
  $("#qualityScore").textContent=quality.score ?? 0;
  $("#passedChecks").innerHTML=listHtml(quality.passed_checks||[]);
  $("#warnings").innerHTML=listHtml(quality.warnings||[]);
  $("#fixSuggestions").innerHTML=listHtml(quality.fix_suggestions||[]);
  $("#seriesIdeas").innerHTML=listHtml(book.series_ideas||[]);
  $("#publishingChecklist").innerHTML=listHtml(book.publishing_checklist||[]);
}
function render(book){$("#loading").classList.add("hidden");$("#result").classList.remove("hidden");$("#bookTitle").textContent=book.book_title;$("#bookSubtitle").textContent=book.subtitle;$("#bookDescription").textContent=book.description;$("#metaAge").textContent=currentSettings.age;$("#metaPages").textContent=`${book.pages.length} pages`;$("#metaGenre").textContent=currentSettings.genreType||currentSettings.difficulty;$("#coverPrompt").textContent=book.cover_prompt;$("#keywords").innerHTML=tagHtml(book.keywords||[]);renderPublishingKit(book);$("#pageList").innerHTML=book.pages.map((p,n)=>`<article class="page-card"><header><b>${n+1}</b><div><strong>${esc(p.title)}</strong><small>${esc(typeNames[p.activity_type]||p.activity_type)} ? ${esc(p.learning_goal)}</small></div><button data-copy-page="${n}" title="Copy image prompt">Copy</button></header><p>${esc(p.instruction)}</p><details><summary>View content, image prompt, and answer</summary><div class="page-details"><span>PAGE CONTENT</span><p>${p.content_items.map(esc).join(" ? ")}</p><span>IMAGE PROMPT</span><p>${esc(p.image_prompt)}</p><span>ANSWER KEY</span><p class="answer">${esc(p.answer)}</p></div></details></article>`).join("");$$("[data-copy-page]").forEach(b=>b.addEventListener("click",async()=>{await navigator.clipboard.writeText(book.pages[Number(b.dataset.copyPage)].image_prompt);toast("Image prompt copied")}))}
$$(".tabs button").forEach(b=>b.addEventListener("click",()=>{$$(".tabs button").forEach(x=>x.classList.remove("active"));b.classList.add("active");["pages","cover","listing","quality"].forEach(tab=>$(`#${tab}Tab`).classList.toggle("hidden",b.dataset.tab!==tab))}));
$("[data-copy=cover]").addEventListener("click",async()=>{if(current){await navigator.clipboard.writeText(current.cover_prompt);toast("Cover prompt copied")}});
$("[data-copy=kdpDescription]")?.addEventListener("click",async()=>{if(current?.listing_assets?.kdp_description){await navigator.clipboard.writeText(current.listing_assets.kdp_description);toast("KDP description copied")}});
$("#saveProject").addEventListener("click",async()=>{if(!current)return;try{await api("/api/projects",{method:"POST",body:JSON.stringify({book:current,settings:currentSettings})});toast("Project saved","Your project is ready in Saved Projects.")}catch(e){toast("Unable to save",e.message)}});
async function loadProjects(){try{const d=await api("/api/projects");$("#projectGrid").innerHTML=d.items.length?d.items.map(p=>`<article class="project-card"><span class="eyebrow">ACTIVITY BOOK</span><h3>${esc(p.title)}</h3><p>${esc(p.settings.topic||"")} ? ${p.book.pages.length} pages</p><footer><span>${new Date((p.createdAt+"Z").replace(" ","T")).toLocaleDateString("en-US")}</span><button data-open="${p.id}">Open -></button></footer></article>`).join(""):`<p>No saved projects yet.</p>`;$$("[data-open]").forEach(b=>b.addEventListener("click",()=>{const p=d.items.find(x=>x.id===Number(b.dataset.open));current=p.book;currentSettings=p.settings;render(current);showView("creator")}))}catch(e){toast("Unable to load projects",e.message)}}
function download(name,text,type="text/plain"){const blob=new Blob([text],{type:`${type};charset=utf-8`}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href)}
$("#exportJson").addEventListener("click",()=>current&&download("activity-book.json",JSON.stringify(current,null,2),"application/json"));$("#exportTxt").addEventListener("click",()=>{if(!current)return;const listing=current.listing_assets||{},quality=current.quality_check||{};let t=`${current.book_title}\n${current.subtitle}\n\n${current.description}\n\n`;t+=`KDP TITLE\n${listing.kdp_title||current.book_title}\n\nKDP SUBTITLE\n${listing.kdp_subtitle||current.subtitle}\n\nKDP DESCRIPTION\n${listing.kdp_description||current.description}\n\nBACKEND KEYWORDS\n${(listing.backend_keywords||[]).join("\n")}\n\nETSY TITLE\n${listing.etsy_title||current.book_title}\n\nETSY TAGS\n${(listing.etsy_tags||[]).join(", ")}\n\nA+ CONTENT IDEAS\n${(listing.a_plus_sections||[]).map(x=>`- ${x}`).join("\n")}\n\nQUALITY SCORE\n${quality.score??0}/100\n\nWARNINGS\n${(quality.warnings||[]).map(x=>`- ${x}`).join("\n")||"- No issues found."}\n\nSERIES IDEAS\n${(current.series_ideas||[]).map(x=>`- ${x}`).join("\n")}\n\nPUBLISHING CHECKLIST\n${(current.publishing_checklist||[]).map(x=>`- ${x}`).join("\n")}\n\n`;current.pages.forEach(p=>t+=`PAGE ${p.page_number}: ${p.title}\n${p.instruction}\nContent: ${p.content_items.join(", ")}\nImage prompt: ${p.image_prompt}\nAnswer: ${p.answer}\n\n`);download("activity-book-publishing-kit.txt",t)});
function reset(){current=null;currentSettings=null;$("#activityType").value="coloring";$("#theme").value="Ocean Animals";$("#pageCount").value="25";$("#genreType").value="Classic Educational";$("#result").classList.add("hidden");$("#loading").classList.add("hidden");$("#emptyPreview").classList.remove("hidden");applyFeatureGates()}
function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
health();loadAccount();


