const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let current=null,currentSettings=null,selectedPageIndex=0,generationController=null;
let accountFeatures=new Set();
let accountUser=null;
let accountLoaded=false;
let accountLoadPromise=null;
let catalog={themes:[],activities:[]};
let engineReady=null;
const views={creator:$("#creatorView"),projects:$("#projectsView"),templates:$("#templatesView")};
const titles={creator:"Activity Book Product Kit Creator",projects:"Saved Projects",templates:"Template Library"};
const typeNames={"word-search":"Word Search","coloring":"Coloring","maze":"Maze","tracing":"Tracing & Handwriting","matching":"Matching","counting":"Counting","learning-worksheet":"Educational Worksheet"};
const initialActivities=$$("#activityType option").map(o=>({value:o.value,label:o.textContent}));
const initialGenres=$$("#genreType option").map(o=>o.value);
const initialPageCounts=$$("#pageCount option").map(o=>o.value);
const WORD_SEARCH_MODE_TYPES=[
  "Standard Word Search",
  "Easy Horizontal Only",
  "Challenge Diagonal Mix",
  "Advanced All Directions"
];
const DEFAULT_MAZE_LAYOUT_TYPES=[
  "Mixed Marketplace Variety",
  "Classic Rectangle Maze",
  "Circular Ring Maze",
  "Triangle Pyramid Maze",
  "Object-Shaped Maze",
  "House or Barn Maze",
  "Animal Silhouette Maze",
  "Adventure Path Maze"
];
const THEME_GROUP_FALLBACK=$$("#theme option").map(o=>({
  name:o.value||o.textContent,
  category:o.closest("optgroup")?.label||"Themes",
  featureKey:`theme.${(o.value||o.textContent).toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")}`,
  compatibleActivityTypes:initialActivities.map(a=>a.value)
}));
const THEME_ALIASES={
  "Ocean Animals":["ocean","sea","marine","underwater","dolphin","turtle","whale","shark","fish","coral"],
  "Farm Animals":["farm","barn","cow","sheep","pig","chicken","horse","duck","goat","rooster","calf","lamb"],
  "Safari Animals":["safari","lion","elephant","giraffe","zebra","rhino","hippo","savanna"],
  "Woodland Animals":["woodland","forest animal","fox","deer","bear","rabbit","squirrel","raccoon"],
  "Rainforest Animals":["rainforest","jungle","monkey","parrot","jaguar","toucan","tropical"],
  "Arctic Animals":["arctic","polar","penguin","seal","walrus","snow animal"],
  "Dinosaurs":["dinosaur","dino","t rex","triceratops","stegosaurus"],
  "Insects & Butterflies":["insect","bug","butterfly","bee","ladybug","dragonfly"],
  "Birds":["bird","owl","eagle","parrot","sparrow"],
  "Pets":["pet","dog","cat","puppy","kitten","hamster","goldfish"],
  "Community Helpers":["community helper","helper","mail carrier","librarian","worker"],
  "Doctors & Nurses":["doctor","nurse","hospital","clinic","medical"],
  "Firefighters":["firefighter","fire truck","fire station"],
  "Police Officers":["police","officer","safety patrol"],
  "Teachers & School":["teacher","school","classroom","student"],
  "Construction Workers":["construction","builder","crane","bulldozer"],
  "Farmers":["farmer","farming","tractor","harvest"],
  "Chefs & Bakers":["chef","baker","bakery","cooking"],
  "Scientists":["scientist","science lab","experiment","microscope"],
  "Astronauts":["astronaut","space suit","moon explorer"],
  "Outer Space":["outer space","space","rocket","alien","galaxy"],
  "Solar System":["solar system","planet","sun","moon","orbit"],
  "Weather":["weather","rain","storm","cloud","wind","snow"],
  "Seasons":["season","spring","summer","fall","autumn","winter"],
  "Human Body":["human body","body","skeleton","heart","brain"],
  "Plants & Gardens":["plant","garden","flower","seed","tree"],
  "Volcanoes":["volcano","lava","eruption"],
  "Oceans & Coral Reefs":["coral reef","reef","coral","ocean reef"],
  "Camping Adventure":["camping","campfire","tent","hiking"],
  "Treasure Hunt":["treasure","pirate map","hidden treasure"],
  "Alphabet":["alphabet","letter","abc"],
  "Numbers 1-20":["number","numbers","count 1 20","1-20"],
  "Shapes":["shape","circle","square","triangle"],
  "Colors":["color","colors","rainbow color"],
  "Opposites":["opposite","big and small","hot and cold"],
  "Healthy Habits":["healthy habit","brush teeth","exercise","hygiene"],
  "Emotions & Feelings":["emotion","feeling","happy","sad","angry"],
  "Friendship & Kindness":["friendship","kindness","sharing","friend"],
  "Safety Rules":["safety","rules","crosswalk","helmet"],
  "Daily Routines":["daily routine","morning routine","bedtime"],
  "Unicorns & Rainbows":["unicorn","rainbow"],
  "Dragons & Castles":["dragon","castle","knight"],
  "Fairies & Magical Forests":["fairy","magical forest","magic forest"],
  "Pirates":["pirate","ship","captain"],
  "Robots":["robot","machine"],
  "Cars & Trucks":["car","truck","vehicle","monster truck"],
  "Trains":["train","railway","locomotive"],
  "Airplanes":["airplane","plane","airport"],
  "Christmas":["christmas","santa","reindeer"],
  "Halloween":["halloween","pumpkin","ghost","witch"]
};
function userToken(){const qs=new URLSearchParams(location.search);const t=qs.get("token");if(t){localStorage.setItem("brightbookUserToken",t);return t}return localStorage.getItem("brightbookUserToken")||"demo-token"}
async function api(path,options={}){const r=await fetch(path,{...options,headers:{"Content-Type":"application/json","x-user-token":userToken(),...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Something went wrong.");return d}
function hasFeature(key){return accountFeatures.has(key)}
function themeInfo(name){return catalog.themes.find(t=>t.name===name)}
function genreInfo(name){return catalog.genres?.find(g=>g.name===name)}
function normText(value=""){return String(value).toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").trim()}
function textHasTerm(text,term){
  const normalized=normText(term);
  if(!normalized)return false;
  if(normalized.includes(" "))return text.includes(normalized);
  return text.split(/\s+/).includes(normalized);
}
function activityGenreOptions(activity){
  if(activity==="word-search")return catalog.wordSearchModes?.length?catalog.wordSearchModes:WORD_SEARCH_MODE_TYPES;
  if(activity==="maze")return catalog.mazeLayouts?.length?catalog.mazeLayouts:DEFAULT_MAZE_LAYOUT_TYPES;
  if(activity==="coloring")return initialGenres;
  return initialGenres;
}
function effectiveGenreForActivity(activity,genre){
  if(activity==="maze"||activity==="word-search")return "Classic Educational";
  return genre||"Classic Educational";
}
function allowedThemesFor(activity,genre){
  const hasLoadedFeatures=accountFeatures.size>0;
  const g=genreInfo(effectiveGenreForActivity(activity,genre));
  const allThemes=catalog.themes?.length?catalog.themes:THEME_GROUP_FALLBACK;
  return allThemes.filter(t=>{
    const allowedByPlan=hasFeature(t.featureKey);
    const activityCompatible=t.compatibleActivityTypes.includes(activity);
    const genreCompatible=g ? g.compatibleThemes.includes(t.name) : true;
    return (allowedByPlan||!hasLoadedFeatures)&&activityCompatible&&genreCompatible;
  });
}
function detectThemeFromIdea(idea,themes){
  const text=normText(idea);
  if(!themes.length)return "";
  if(!text)return themes.find(t=>t.name===$("#theme").value)?.name||themes[0].name;
  const scored=themes.map(t=>{
    const name=normText(t.name);
    const tokens=name.split(" ").filter(token=>token.length>2);
    let score=textHasTerm(text,name)?12:0;
    for(const token of tokens)if(textHasTerm(text,token))score+=2;
    for(const alias of THEME_ALIASES[t.name]||[]){
      const normalized=normText(alias);
      if(textHasTerm(text,normalized))score+=normalized.includes(" ")?8:5;
    }
    return {theme:t.name,score};
  }).sort((a,b)=>b.score-a.score);
  return scored[0]?.score>0?scored[0].theme:"Custom Idea";
}
function updateDetectedTheme(theme,source=""){
  $("#detectedThemeName").textContent=theme||"Waiting for idea";
  $("#detectedThemeHelp").textContent=source==="custom"
    ? "No exact theme matched. BrightBook will use your book idea as the main niche."
    : source==="idea"
    ? "Matched from your book idea. BrightBook will keep every prompt anchored to this theme."
    : "Type a book idea and BrightBook will match it to the closest available theme.";
}
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
async function loadAccount(){
  accountLoadPromise=(async()=>{
    try{
      catalog=await api("/api/catalog");
      const d=await api("/api/me");
      accountFeatures=new Set(d.user.features||[]);
      accountLoaded=true;
      renderAccount(d.user);
      applyFeatureGates();
    }catch(e){
      accountLoaded=false;
      toast("Account unavailable",e.message);
    }
  })();
  return accountLoadPromise;
}
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
  const hasLoadedFeatures=accountFeatures.size>0;
  const planActivitiesByFeature=initialActivities.filter(a=>hasFeature(`activity.${a.value}`));
  const planActivities=hasLoadedFeatures?planActivitiesByFeature:initialActivities;
  setPlainOptions($("#activityType"),planActivities,previous.activity);

  let activity=$("#activityType").value;
  let genreOptions=activityGenreOptions(activity);
  let genres=genreOptions.filter(name=>{
    const info=genreInfo(name);
    return info ? info.compatibleActivityTypes.includes(activity) : true;
  });
  setPlainOptions($("#genreType"),genres.map(value=>({value,label:value})),previous.genre);

  let genre=$("#genreType").value;
  let themes=allowedThemesFor(activity,genre);
  if(!themes.length&&!hasLoadedFeatures)themes=THEME_GROUP_FALLBACK.filter(t=>t.compatibleActivityTypes.includes(activity));
  setThemeOptions(themes,previous.theme);
  const detectedTheme=detectThemeFromIdea($("#bookIdea")?.value||"",themes);
  if(detectedTheme&&detectedTheme!=="Custom Idea")$("#theme").value=detectedTheme;
  updateDetectedTheme(detectedTheme==="Custom Idea"?"Custom Idea":$("#theme").value,$("#bookIdea")?.value.trim()?(detectedTheme==="Custom Idea"?"custom":"idea"):"default");

  let theme=$("#theme").value;
  genreOptions=activityGenreOptions(activity);
  genres=genreOptions.filter(name=>{
    const info=genreInfo(name);
    return info ? info.compatibleActivityTypes.includes(activity)&&info.compatibleThemes.includes(theme) : true;
  });
  setPlainOptions($("#genreType"),genres.map(value=>({value,label:value})),genre);

  genre=$("#genreType").value;
  let g=genreInfo(effectiveGenreForActivity(activity,genre));
  const finalActivities=planActivities.filter(a=>{
    const t=themeInfo(theme);
    const activityThemeCompatible=t ? t.compatibleActivityTypes.includes(a.value) : true;
    const genreCompatible=g ? g.compatibleActivityTypes.includes(a.value) : true;
    return activityThemeCompatible&&genreCompatible;
  });
  setPlainOptions($("#activityType"),finalActivities.length?finalActivities:planActivities,$("#activityType").value);
  activity=$("#activityType").value;
  themes=allowedThemesFor(activity,genre);
  if(!themes.length&&!hasLoadedFeatures)themes=THEME_GROUP_FALLBACK.filter(t=>t.compatibleActivityTypes.includes(activity));
  setThemeOptions(themes,$("#theme").value);
  const finalDetectedTheme=detectThemeFromIdea($("#bookIdea")?.value||"",themes);
  if(finalDetectedTheme&&finalDetectedTheme!=="Custom Idea")$("#theme").value=finalDetectedTheme;
  updateDetectedTheme(finalDetectedTheme==="Custom Idea"?"Custom Idea":$("#theme").value,$("#bookIdea")?.value.trim()?(finalDetectedTheme==="Custom Idea"?"custom":"idea"):"default");
  const finalGenreOptions=activityGenreOptions(activity);
  if(!finalGenreOptions.includes($("#genreType").value)){
    setPlainOptions($("#genreType"),finalGenreOptions.map(value=>({value,label:value})),finalGenreOptions[0]);
  }

  const pageCountsByFeature=initialPageCounts.filter(value=>hasFeature(`quantity.${value}`)).map(value=>({value,label:value}));
  const pageCounts=hasLoadedFeatures?pageCountsByFeature:initialPageCounts.map(value=>({value,label:value}));
  setPlainOptions($("#pageCount"),pageCounts,previous.pageCount);
  $("#saveProject").disabled=!hasFeature("export.save-project");
  $("#exportJson").disabled=false;
  $("#exportTxt").disabled=!hasFeature("export.txt");
  const canUseAdvancedDirection=hasFeature("advanced.custom-direction");
  $("#advancedInputs")?.classList.toggle("locked",!canUseAdvancedDirection);
  $("#customDirection").disabled=!canUseAdvancedDirection;
  $("#avoidTerms").disabled=!canUseAdvancedDirection;
  if(!canUseAdvancedDirection){
    $("#customDirection").value="";
    $("#avoidTerms").value="";
  }
  const canListing=hasFeature("kit.listing-assets");
  const canQuality=hasFeature("kit.quality-check")||hasFeature("kit.series-builder")||hasFeature("kit.launch-checklist");
  document.querySelector('[data-tab="listing"]')?.classList.toggle("hidden",!canListing);
  document.querySelector('[data-tab="quality"]')?.classList.toggle("hidden",!canQuality);
}
function selectedActivityAllowed(){
  const activity=$("#activityType").value;
  return !accountLoaded || hasFeature(`activity.${activity}`);
}
function toast(title,msg="",duration=3000){const t=$("#toast");t.querySelector("strong").textContent=title;t.querySelector("small").textContent=msg;t.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove("show"),duration)}
function showView(name){Object.values(views).forEach(v=>v.classList.remove("active"));views[name].classList.add("active");$("#pageTitle").textContent=titles[name];$$("nav button").forEach(b=>b.classList.toggle("active",b.dataset.view===name));$(".sidebar").classList.remove("open");if(name==="projects")loadProjects();window.scrollTo({top:0,behavior:"smooth"})}
$$("nav button").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));$(".menu").addEventListener("click",()=>$(".sidebar").classList.toggle("open"));$("#newBook").addEventListener("click",()=>{reset();showView("creator")});
$("#activityType").addEventListener("change",applyFeatureGates);
$("#genreType").addEventListener("change",applyFeatureGates);
$("#bookIdea")?.addEventListener("input",applyFeatureGates);
$("#accountButton")?.addEventListener("click",e=>{e.stopPropagation();$("#accountMenu")?.classList.toggle("hidden")});
document.addEventListener("click",e=>{if(!e.target.closest?.("#accountDock"))$("#accountMenu")?.classList.add("hidden")});
$$("[data-template]").forEach(b=>b.addEventListener("click",()=>{$("#bookIdea").value=`${b.dataset.theme}: ${b.dataset.template}`;showView("creator");applyFeatureGates()}));
async function health(){try{const d=await api("/api/health");engineReady=!!d.ollama;if(!engineReady)toast("Creator unavailable","The content engine is not ready yet.",8000)}catch{engineReady=false;toast("Connection unavailable","Please start the BrightBook service and try again.",8000)}finally{$("#generate").disabled=false}}
function settings(){
  const activityType=$("#activityType").value,genreType=$("#genreType").value;
  const mazeLayout=activityType==="maze"?genreType:"";
  const wordSearchMode=activityType==="word-search"?genreType:"";
  const effectiveGenre=effectiveGenreForActivity(activityType,genreType);
  const bookIdea=$("#bookIdea")?.value.trim()||"";
  const isCustomIdea=$("#detectedThemeName")?.textContent==="Custom Idea";
  const theme=isCustomIdea?"Custom Idea":$("#theme").value;
  const topic=isCustomIdea&&bookIdea?bookIdea:theme;
  const customDirection=$("#customDirection")?.disabled?"":($("#customDirection")?.value.trim()||"");
  const avoidTerms=$("#avoidTerms")?.disabled?"":($("#avoidTerms")?.value.trim()||"");
  return{topic,theme,bookIdea,customDirection,avoidTerms,activityType,activityTypes:[activityType],age:$("#age").value,language:$("#language").value,pageCount:Number($("#pageCount").value),genreType:effectiveGenre,difficulty:effectiveGenre,displayGenre:genreType,mazeLayout,wordSearchMode,size:"A4",style:styleFromGenre(effectiveGenre),learningGoal:"",guideCharacter:""};
}
function normalizeSelections(){
  applyFeatureGates();
  if(!$("#activityType").value&&$("#activityType option"))$("#activityType").value=$("#activityType option").value;
  if(!$("#theme").value&&$("#theme option"))$("#theme").value=$("#theme option").value;
  if(!$("#pageCount").value&&$("#pageCount option"))$("#pageCount").value=$("#pageCount option").value;
  if(!$("#genreType").value&&$("#genreType option"))$("#genreType").value=$("#genreType option").value;
}
async function generateProductKit(){
  if(generationController)return;
  if(!accountLoaded&&accountLoadPromise)await accountLoadPromise;
  normalizeSelections();
  if(!selectedActivityAllowed()){
    const locked=$("#activityType").value;
    applyFeatureGates();
    toast("Activity locked",`${typeNames[locked]||locked} is not included in your current plan.`,7000);
    return;
  }
  currentSettings=settings();
  generationController=new AbortController();
  $("#emptyPreview").classList.add("hidden");
  $("#result").classList.add("hidden");
  $("#loading").classList.remove("hidden");
  $("#loadingText").textContent="Starting the product kit generator";
  $("#cancelGenerate").disabled=false;
  const btn=$("#generate");
  btn.disabled=true;
  btn.classList.add("loading");
  btn.querySelector("strong").textContent="Generating...";
  const msgs=["Preparing the first product kit batch","Building unique concepts for your theme","Writing consistent image prompts","Creating answer keys and learning goals","Drafting listing assets and keywords","Checking the complete publishing kit"];
  let i=0;
  const timer=setInterval(()=>$("#loadingText").textContent=msgs[++i%msgs.length],5000);
  try{
    if(engineReady===false)await health();
    if(engineReady===false)throw new Error("The local content engine is not ready. Please start Ollama and make sure the selected model is installed.");
    const d=await api("/api/generate",{method:"POST",body:JSON.stringify(currentSettings),signal:generationController.signal});
    current=d.book;
    if(!current.pages||current.pages.length!==currentSettings.pageCount)throw new Error(`Expected ${currentSettings.pageCount} prompts, but received ${current.pages?.length||0}. Please generate again.`);
    render(current);
    toast("Your product kit is ready",`${current.pages.length} pages were created.`);
  }catch(e){
    $("#loading").classList.add("hidden");
    if(e.name==="AbortError"){
      if(current)$("#result").classList.remove("hidden");
      else $("#emptyPreview").classList.remove("hidden");
      toast("Generation stopped","No new product kit was created.",5000);
    }else{
      $("#emptyPreview").classList.remove("hidden");
      toast("Unable to create your product kit",e.message,9000);
    }
  }finally{
    clearInterval(timer);
    generationController=null;
    $("#cancelGenerate").disabled=false;
    btn.disabled=false;
    btn.classList.remove("loading");
    btn.querySelector("strong").textContent="Generate Product Kit";
  }
}
$("#generate").addEventListener("click",generateProductKit);
$("#cancelGenerate")?.addEventListener("click",()=>{
  if(!generationController)return;
  $("#cancelGenerate").disabled=true;
  $("#loadingText").textContent="Stopping generation...";
  generationController.abort();
});
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
function mazePageData(page){
  const rows=(page.content_items||[]).map(item=>String(item).match(/^MAZE ROW \d+:\s*([S.G#]+)/i)?.[1]).filter(Boolean);
  if(rows.length!==9)return null;
  const findCell=char=>{
    for(let row=0;row<rows.length;row++){
      const col=rows[row].indexOf(char);
      if(col>=0)return {row,col};
    }
    return null;
  };
  return {rows,start:findCell("S"),goal:findCell("G")};
}
function mazeExitSide(cell){
  if(!cell)return "right";
  if(cell.col===0)return "left";
  if(cell.col===8)return "right";
  if(cell.row===0)return "top";
  return "bottom";
}
function mazeSvg(page){
  const maze=mazePageData(page);
  if(!maze)throw new Error("This maze page does not include a valid 9 by 9 blueprint.");
  const w=816,h=1056,x0=120,y0=230,cell=64,stroke=8;
  const open=(row,col)=>row>=0&&row<9&&col>=0&&col<9&&maze.rows[row][col]!=="#";
  const entrance=mazeExitSide(maze.start),exit=mazeExitSide(maze.goal);
  const isOpenEdge=(row,col,side)=>(maze.start?.row===row&&maze.start?.col===col&&side===entrance)||(maze.goal?.row===row&&maze.goal?.col===col&&side===exit);
  const segments=new Set();
  const add=(x1,y1,x2,y2)=>{
    const a=`${x1},${y1}`,b=`${x2},${y2}`;
    segments.add(a<b?`${a},${b}`:`${b},${a}`);
  };
  for(let row=0;row<9;row++){
    for(let col=0;col<9;col++){
      if(!open(row,col))continue;
      const x=x0+col*cell,y=y0+row*cell;
      if(!open(row-1,col)&&!isOpenEdge(row,col,"top"))add(x,y,x+cell,y);
      if(!open(row,col+1)&&!isOpenEdge(row,col,"right"))add(x+cell,y,x+cell,y+cell);
      if(!open(row+1,col)&&!isOpenEdge(row,col,"bottom"))add(x,y+cell,x+cell,y+cell);
      if(!open(row,col-1)&&!isOpenEdge(row,col,"left"))add(x,y,x,y+cell);
    }
  }
  const lineSvg=[...segments].map(segment=>{
    const [x1,y1,x2,y2]=segment.split(",").map(Number);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
  }).join("");
  const s=maze.start||{row:0,col:0},g=maze.goal||{row:8,col:8};
  const startX=x0+s.col*cell+cell/2,startY=y0+s.row*cell+cell/2;
  const goalX=x0+g.col*cell+cell/2,goalY=y0+g.row*cell+cell/2;
  const title=esc(page.title||"Solvable Maze");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="64" y="72" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#111827">Name:</text>
  <line x1="150" y1="66" x2="360" y2="66" stroke="#111827" stroke-width="3"/>
  <text x="476" y="72" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#111827">Date:</text>
  <line x1="548" y1="66" x2="748" y2="66" stroke="#111827" stroke-width="3"/>
  <text x="${w/2}" y="140" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" font-weight="800" fill="#17352d">${title}</text>
  <text x="${w/2}" y="176" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" fill="#4b5563">${esc(page.instruction||"Find the path from START to GOAL.")}</text>
  <g stroke="#111827" stroke-width="${stroke}" stroke-linecap="square" fill="none">${lineSvg}</g>
  <circle cx="${startX}" cy="${startY}" r="15" fill="#22c55e"/>
  <text x="${Math.max(56,startX-42)}" y="${Math.max(206,startY-30)}" font-family="Arial, sans-serif" font-size="18" font-weight="800" fill="#15803d">START</text>
  <circle cx="${goalX}" cy="${goalY}" r="15" fill="#ef4444"/>
  <text x="${Math.min(w-120,goalX-28)}" y="${Math.min(h-70,goalY+52)}" font-family="Arial, sans-serif" font-size="18" font-weight="800" fill="#b91c1c">GOAL</text>
  <path d="M96 900 C170 850 230 920 320 880 C390 850 470 910 560 875 C630 848 690 870 760 835" fill="none" stroke="#bbf7d0" stroke-width="34" stroke-linecap="round"/>
  <text x="${w/2}" y="1000" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" fill="#94a3b8">Generated from a solvable BrightBook maze blueprint</text>
</svg>`;
}
function renderPageWorkspace(book){
  selectedPageIndex=0;
  $("#pageList").innerHTML=book.pages.map((p,n)=>{
    const mazeButton=p.activity_type==="maze"?`<button data-download-maze="${n}" title="Download a guaranteed-solvable SVG maze">SVG Maze</button>`:"";
    return `<article class="page-card" data-page-card="${n}"><header><b>${n+1}</b><div><strong>${esc(p.title)}</strong><small>${esc(typeNames[p.activity_type]||p.activity_type)} · ${esc(p.learning_goal)}</small></div><div class="page-actions">${mazeButton}<button data-copy-page="${n}" title="Copy image prompt">Copy</button></div></header><p>${esc(p.instruction)}</p><details><summary>View content, image prompt, and answer</summary><div class="page-details"><span>PAGE CONTENT</span><p>${p.content_items.map(esc).join(" · ")}</p><span>IMAGE PROMPT</span><p>${esc(p.image_prompt)}</p><span>ANSWER KEY</span><p class="answer">${esc(p.answer)}</p></div></details></article>`;
  }).join("");
  $$("[data-copy-page]").forEach(b=>b.addEventListener("click",async()=>{
    selectedPageIndex=Number(b.dataset.copyPage);
    await navigator.clipboard.writeText(book.pages[selectedPageIndex].image_prompt);
    toast("Image prompt copied");
  }));
  $$("[data-download-maze]").forEach(b=>b.addEventListener("click",()=>{
    selectedPageIndex=Number(b.dataset.downloadMaze);
    try{
      download(`maze-page-${selectedPageIndex+1}.svg`,mazeSvg(book.pages[selectedPageIndex]),"image/svg+xml");
      toast("Maze SVG downloaded","This version is generated from a solvable blueprint.");
    }catch(e){toast("Unable to create SVG maze",e.message,7000)}
  }));
}
function render(book){$("#loading").classList.add("hidden");$("#result").classList.remove("hidden");$("#bookTitle").textContent=book.book_title;$("#bookSubtitle").textContent=book.subtitle;$("#bookDescription").textContent=book.description;$("#metaAge").textContent=currentSettings.age;$("#metaPages").textContent=`${book.pages.length} pages`;$("#metaGenre").textContent=currentSettings.displayGenre||currentSettings.genreType||currentSettings.difficulty;$("#coverPrompt").textContent=book.cover_prompt;$("#keywords").innerHTML=tagHtml(book.keywords||[]);renderPublishingKit(book);renderPageWorkspace(book)}
$$(".tabs button").forEach(b=>b.addEventListener("click",()=>{$$(".tabs button").forEach(x=>x.classList.remove("active"));b.classList.add("active");["pages","cover","listing","quality"].forEach(tab=>$(`#${tab}Tab`).classList.toggle("hidden",b.dataset.tab!==tab))}));
$("[data-copy=cover]").addEventListener("click",async()=>{if(current){await navigator.clipboard.writeText(current.cover_prompt);toast("Cover prompt copied")}});
$("[data-copy=kdpTitle]")?.addEventListener("click",async()=>{if(current?.listing_assets?.kdp_title){await navigator.clipboard.writeText(current.listing_assets.kdp_title);toast("KDP title copied")}});
$("[data-copy=etsyTitle]")?.addEventListener("click",async()=>{if(current?.listing_assets?.etsy_title){await navigator.clipboard.writeText(current.listing_assets.etsy_title);toast("Etsy title copied")}});
$("[data-copy=kdpDescription]")?.addEventListener("click",async()=>{if(current?.listing_assets?.kdp_description){await navigator.clipboard.writeText(current.listing_assets.kdp_description);toast("KDP description copied")}});
$("#saveProject").addEventListener("click",async()=>{if(!current)return;try{await api("/api/projects",{method:"POST",body:JSON.stringify({book:current,settings:currentSettings})});toast("Project saved","Your project is ready in Saved Projects.")}catch(e){toast("Unable to save",e.message)}});
async function loadProjects(){try{const d=await api("/api/projects");$("#projectGrid").innerHTML=d.items.length?d.items.map(p=>`<article class="project-card"><span class="eyebrow">ACTIVITY BOOK</span><h3>${esc(p.title)}</h3><p>${esc(p.settings.topic||"")} ? ${p.book.pages.length} pages</p><footer><span>${new Date((p.createdAt+"Z").replace(" ","T")).toLocaleDateString("en-US")}</span><button data-open="${p.id}">Open -></button></footer></article>`).join(""):`<p>No saved projects yet.</p>`;$$("[data-open]").forEach(b=>b.addEventListener("click",()=>{const p=d.items.find(x=>x.id===Number(b.dataset.open));current=p.book;currentSettings=p.settings;render(current);showView("creator")}))}catch(e){toast("Unable to load projects",e.message)}}
function download(name,text,type="text/plain"){const blob=new Blob([text],{type:`${type};charset=utf-8`}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href)}
$("#exportJson").addEventListener("click",()=>{if(!current)return toast("Nothing to export","Generate a product kit first.",5000);download("activity-book.json",JSON.stringify(current,null,2),"application/json")});$("#exportTxt").addEventListener("click",()=>{if(!current)return toast("Nothing to export","Generate a product kit first.",5000);const listing=current.listing_assets||{},quality=current.quality_check||{};let t=`${current.book_title}\n${current.subtitle}\n\n${current.description}\n\n`;t+=`KDP TITLE\n${listing.kdp_title||current.book_title}\n\nKDP SUBTITLE\n${listing.kdp_subtitle||current.subtitle}\n\nKDP DESCRIPTION\n${listing.kdp_description||current.description}\n\nBACKEND KEYWORDS\n${(listing.backend_keywords||[]).join("\n")}\n\nETSY TITLE\n${listing.etsy_title||current.book_title}\n\nETSY TAGS\n${(listing.etsy_tags||[]).join(", ")}\n\nA+ CONTENT IDEAS\n${(listing.a_plus_sections||[]).map(x=>`- ${x}`).join("\n")}\n\nQUALITY SCORE\n${quality.score??0}/100\n\nWARNINGS\n${(quality.warnings||[]).map(x=>`- ${x}`).join("\n")||"- No issues found."}\n\nSERIES IDEAS\n${(current.series_ideas||[]).map(x=>`- ${x}`).join("\n")}\n\nPUBLISHING CHECKLIST\n${(current.publishing_checklist||[]).map(x=>`- ${x}`).join("\n")}\n\n`;current.pages.forEach(p=>t+=`PAGE ${p.page_number}: ${p.title}\n${p.instruction}\nContent: ${p.content_items.join(", ")}\nImage prompt: ${p.image_prompt}\nAnswer: ${p.answer}\n\n`);download("activity-book-publishing-kit.txt",t)});
function reset(){current=null;currentSettings=null;selectedPageIndex=0;$("#activityType").value="coloring";$("#theme").value="Ocean Animals";$("#pageCount").value="25";$("#genreType").value="Classic Educational";$("#bookIdea").value="";$("#customDirection").value="";$("#avoidTerms").value="";$("#result").classList.add("hidden");$("#loading").classList.add("hidden");$("#emptyPreview").classList.remove("hidden");applyFeatureGates()}
function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
health();loadAccount();


