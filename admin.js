const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let plans=[],features=[];
function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function toast(title,msg=""){const t=$("#toast");t.querySelector("strong").textContent=title;t.querySelector("small").textContent=msg;t.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove("show"),3000)}
async function api(path,options={}){
  const r=await fetch(path,{...options,headers:{"Content-Type":"application/json","x-admin-token":$("#adminToken").value,...(options.headers||{})}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||"Request failed.");
  return d;
}
function groupFeatures(items){
  return items.reduce((acc,f)=>{(acc[f.category] ||= []).push(f);return acc},{});
}
async function loadPlans(){
  const d=await api("/api/admin/plans");
  plans=d.items;
  $("#userPlan").innerHTML=plans.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");
  $("#featurePlan").innerHTML=plans.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");
}
async function loadFeatures(){
  const d=await api("/api/admin/features");
  features=d.items;
  renderFeatureMatrix();
}
function renderFeatureMatrix(){
  const plan=plans.find(p=>p.id===Number($("#featurePlan").value))||plans[0];
  if(!plan){$("#featureMatrix").innerHTML="<p>No plans yet.</p>";return}
  const enabled=new Set(plan.features||[]);
  const groups=groupFeatures(features);
  $("#featureMatrix").innerHTML=Object.entries(groups).map(([category,items])=>`
    <section class="feature-group">
      <h3>${esc(category)}</h3>
      ${items.map(f=>`<label class="feature-check"><input type="checkbox" value="${f.id}" data-key="${esc(f.key)}" ${enabled.has(f.key)?"checked":""}><span><strong>${esc(f.name)}</strong><small>${esc(f.key)}${f.description?` — ${esc(f.description)}`:""}</small></span></label>`).join("")}
    </section>`).join("");
}
async function loadUsers(){
  const d=await api("/api/admin/users");
  $("#users").innerHTML=d.items.map(u=>`
    <tr>
      <td><strong>${esc(u.email)}</strong><small>${esc(u.name||"")}</small></td>
      <td>${esc(u.planName)}</td>
      <td><span class="feature-count">${(u.features||[]).length} enabled</span><small>${esc((u.features||[]).slice(0,4).join(", "))}${(u.features||[]).length>4?"...":""}</small></td>
      <td>${u.used} generated<small>history only, not credit</small></td>
      <td><select data-status="${u.id}"><option ${u.status==="active"?"selected":""}>active</option><option ${u.status==="paused"?"selected":""}>paused</option></select></td>
      <td><code>${esc(u.token)}</code></td>
      <td><button data-copy="${esc(u.token)}">Copy</button><button data-save="${u.id}">Save</button></td>
    </tr>`).join("");
  $$("[data-copy]").forEach(b=>b.addEventListener("click",async()=>{await navigator.clipboard.writeText(b.dataset.copy);toast("Token copied")}));
  $$("[data-save]").forEach(b=>b.addEventListener("click",async()=>{const id=b.dataset.save;const status=document.querySelector(`[data-status="${id}"]`).value;await api(`/api/admin/users/${id}`,{method:"PATCH",body:JSON.stringify({status})});toast("User updated");await loadUsers()}));
}
async function loadUsage(){
  const d=await api("/api/admin/usage");
  $("#usage").innerHTML=d.items.map(x=>`<tr><td>${esc(x.createdAt)}</td><td>${esc(x.email)}</td><td>${x.units}</td><td>${esc(x.metadata.activityType||"")}</td><td>${esc(x.metadata.theme||"")}</td></tr>`).join("");
}
async function refresh(){try{await loadPlans();await loadFeatures();await loadUsers();await loadUsage()}catch(e){toast("Admin error",e.message)}}
$("#createUser").addEventListener("click",async()=>{
  try{
    const body={email:$("#userEmail").value,name:$("#userName").value,planId:Number($("#userPlan").value)};
    const d=await api("/api/admin/users",{method:"POST",body:JSON.stringify(body)});
    toast("User created",`Token: ${d.token}`);
    await refresh();
  }catch(e){toast("Unable to create user",e.message)}
});
$("#createPlan").addEventListener("click",async()=>{
  try{
    const body={name:$("#planName").value,monthlyPromptLimit:Number($("#planLimit").value||0),priceCents:Number($("#planPrice").value||0)};
    await api("/api/admin/plans",{method:"POST",body:JSON.stringify(body)});
    toast("Plan created");
    await refresh();
  }catch(e){toast("Unable to create plan",e.message)}
});
$("#createFeature").addEventListener("click",async()=>{
  try{
    const body={key:$("#featureKey").value,name:$("#featureName").value,category:$("#featureCategory").value,description:$("#featureDescription").value};
    await api("/api/admin/features",{method:"POST",body:JSON.stringify(body)});
    toast("Feature created");
    await refresh();
  }catch(e){toast("Unable to create feature",e.message)}
});
$("#savePlanFeatures").addEventListener("click",async()=>{
  try{
    const planId=Number($("#featurePlan").value);
    const featureIds=$$("#featureMatrix input:checked").map(x=>Number(x.value));
    await api("/api/admin/plan-features",{method:"POST",body:JSON.stringify({planId,featureIds})});
    toast("Plan features saved");
    await refresh();
  }catch(e){toast("Unable to save features",e.message)}
});
$("#featurePlan").addEventListener("change",renderFeatureMatrix);
$("#refresh").addEventListener("click",refresh);
refresh();
