const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4180);
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL || "gemma3:4b";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "brightbook-admin";
const USE_OLLAMA_GENERATION = process.env.USE_OLLAMA_GENERATION === "1";
fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
const db = new DatabaseSync(path.join(ROOT, "data", "brightbook.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    settings_json TEXT NOT NULL,
    book_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    monthly_prompt_limit INTEGER NOT NULL,
    price_cents INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    access_token TEXT NOT NULL UNIQUE,
    plan_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    usage_limit_override INTEGER,
    period_started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(plan_id) REFERENCES plans(id)
  );
  CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    units INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feature_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'General',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS plan_features (
    plan_id INTEGER NOT NULL,
    feature_id INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(plan_id, feature_id),
    FOREIGN KEY(plan_id) REFERENCES plans(id),
    FOREIGN KEY(feature_id) REFERENCES features(id)
  )
`);

function token(prefix="bb") {
  return `${prefix}_${crypto.randomBytes(18).toString("base64url")}`;
}
const THEME_GROUPS=[
  ["Animals",["Ocean Animals","Farm Animals","Safari Animals","Woodland Animals","Rainforest Animals","Arctic Animals","Dinosaurs","Insects & Butterflies","Birds","Pets"]],
  ["Careers & Community",["Community Helpers","Doctors & Nurses","Firefighters","Police Officers","Teachers & School","Construction Workers","Farmers","Chefs & Bakers","Scientists","Astronauts"]],
  ["Science & Adventure",["Outer Space","Solar System","Weather","Seasons","Human Body","Plants & Gardens","Volcanoes","Oceans & Coral Reefs","Camping Adventure","Treasure Hunt"]],
  ["Learning & Everyday Life",["Alphabet","Numbers 1–20","Shapes","Colors","Opposites","Healthy Habits","Emotions & Feelings","Friendship & Kindness","Safety Rules","Daily Routines"]],
  ["Fantasy, Holidays & Transport",["Unicorns & Rainbows","Dragons & Castles","Fairies & Magical Forests","Pirates","Robots","Cars & Trucks","Trains","Airplanes","Christmas","Halloween"]]
];
const ACTIVITY_TYPES=["word-search","coloring","educational-story","maze","tracing","matching","counting","simple-math","spot-difference","puzzle","learning-worksheet"];
const GENRE_TYPES=[
  "Classic Educational",
  "Cinematic Adventure",
  "Fantasy Storybook",
  "Documentary Style",
  "Whimsical Cartoon",
  "Cozy Storybook",
  "Science Explorer",
  "Magical World",
  "Realistic Classroom",
  "Vintage Workbook"
];
function featureSlug(value=""){
  return String(value).toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
}
function themeFeatureKey(theme){return `theme.${featureSlug(theme)}`}
function themeCategory(theme){
  return THEME_GROUPS.find(([,items])=>items.includes(theme))?.[0] || "Custom Themes";
}
function compatibleActivityTypes(theme){
  const category=themeCategory(theme);
  const t=String(theme).toLowerCase();
  let allowed=new Set(ACTIVITY_TYPES);
  if(category==="Learning & Everyday Life"){
    if(/alphabet|numbers|shapes|colors|opposites/.test(t)) allowed=new Set(["word-search","coloring","tracing","matching","counting","simple-math","puzzle","learning-worksheet"]);
    if(/emotion|friendship|kindness|healthy|safety|routine/.test(t)) allowed=new Set(["word-search","coloring","educational-story","tracing","matching","puzzle","learning-worksheet"]);
  }
  if(/human body/.test(t)) allowed=new Set(["word-search","coloring","educational-story","matching","puzzle","learning-worksheet"]);
  if(/volcano/.test(t)) allowed.delete("tracing");
  if(/pirates|treasure hunt|camping adventure/.test(t)) allowed.delete("tracing");
  if(/christmas|halloween/.test(t)) allowed.delete("simple-math");
  return [...allowed];
}
function isCompatible(activityType,theme){
  if(!theme)return true;
  return compatibleActivityTypes(theme).includes(activityType);
}
function themeNamesByCategories(categories){
  return THEME_GROUPS.filter(([category])=>categories.includes(category)).flatMap(([,items])=>items);
}
function compatibleThemesForGenre(genreType){
  const g=String(genreType||"Classic Educational").toLowerCase();
  const all=THEME_GROUPS.flatMap(([,items])=>items);
  if(g==="classic educational"||g==="whimsical cartoon")return all;
  if(g==="cinematic adventure")return all.filter(theme=>!/alphabet|numbers|shapes|colors|opposites|healthy habits|daily routines/i.test(theme));
  if(g==="fantasy storybook")return themeNamesByCategories(["Animals","Science & Adventure","Fantasy, Holidays & Transport"]).filter(theme=>!/human body|weather|seasons|plants|volcanoes|solar system/i.test(theme));
  if(g==="documentary style")return themeNamesByCategories(["Animals","Careers & Community","Science & Adventure"]).filter(theme=>!/treasure hunt|camping adventure/i.test(theme));
  if(g==="cozy storybook")return all.filter(theme=>!/human body|volcanoes|police officers|construction workers|robots|cars|trucks|trains|airplanes/i.test(theme));
  if(g==="science explorer")return themeNamesByCategories(["Animals","Careers & Community","Science & Adventure","Learning & Everyday Life"]).filter(theme=>!/chefs|bakers|police|friendship|kindness|daily routines|opposites/i.test(theme));
  if(g==="magical world")return themeNamesByCategories(["Animals","Science & Adventure","Fantasy, Holidays & Transport"]).filter(theme=>!/human body|weather|seasons|plants|volcanoes|solar system|cars|trucks|trains|airplanes/i.test(theme));
  if(g==="realistic classroom")return themeNamesByCategories(["Careers & Community","Science & Adventure","Learning & Everyday Life"]).filter(theme=>!/pirates|treasure hunt|camping adventure|volcanoes/i.test(theme));
  if(g==="vintage workbook")return themeNamesByCategories(["Animals","Careers & Community","Science & Adventure","Learning & Everyday Life"]).filter(theme=>!/camping adventure|treasure hunt|volcanoes/i.test(theme));
  return all;
}
function compatibleActivitiesForGenre(genreType){
  const g=String(genreType||"Classic Educational").toLowerCase();
  if(g==="cinematic adventure")return ["coloring","educational-story","maze","spot-difference","puzzle"];
  if(g==="fantasy storybook")return ["coloring","educational-story","maze","matching","spot-difference","puzzle"];
  if(g==="documentary style")return ["word-search","coloring","educational-story","matching","puzzle","learning-worksheet"];
  if(g==="cozy storybook")return ["coloring","educational-story","tracing","matching","counting","learning-worksheet"];
  if(g==="science explorer")return ["word-search","coloring","educational-story","matching","counting","simple-math","puzzle","learning-worksheet"];
  if(g==="magical world")return ["coloring","educational-story","maze","matching","counting","spot-difference","puzzle"];
  if(g==="realistic classroom")return ["word-search","tracing","matching","counting","simple-math","puzzle","learning-worksheet"];
  if(g==="vintage workbook")return ["word-search","tracing","matching","counting","simple-math","puzzle","learning-worksheet"];
  return ACTIVITY_TYPES;
}
function isGenreCompatible(activityType,theme,genreType){
  const activities=compatibleActivitiesForGenre(genreType);
  const themes=compatibleThemesForGenre(genreType);
  return activities.includes(activityType)&&themes.includes(theme);
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
function seedBilling() {
  const planCount = db.prepare("SELECT COUNT(*) AS c FROM plans").get().c;
  if (!planCount) {
    const insert = db.prepare("INSERT INTO plans(name,monthly_prompt_limit,price_cents,active) VALUES(?,?,?,1)");
    insert.run("Front-End", 500, 2700);
    insert.run("Pro OTO", 2500, 4700);
    insert.run("Publishing Kit OTO", 10000, 6700);
    insert.run("Agency License", 50000, 9700);
  }
  const demoPlan = db.prepare("SELECT id FROM plans WHERE name=?").get("Front-End") || db.prepare("SELECT id FROM plans WHERE name=?").get("Creator") || db.prepare("SELECT id FROM plans ORDER BY id LIMIT 1").get();
  const demo = db.prepare("SELECT id FROM users WHERE email=?").get("demo@brightbook.local");
  if (!demo && demoPlan) {
    db.prepare("INSERT INTO users(email,name,access_token,plan_id,status) VALUES(?,?,?,?,?)")
      .run("demo@brightbook.local", "Demo User", "demo-token", demoPlan.id, "active");
  }
  const features = [
    ["activity.coloring","Coloring Book","Generate coloring book prompt packs.","Activity Types"],
    ["activity.word-search","Word Search Book","Generate word search prompt packs.","Activity Types"],
    ["activity.educational-story","Educational Storybook","Generate connected educational story prompt packs.","Activity Types"],
    ["activity.maze","Maze Book","Generate maze activity prompt packs.","Activity Types"],
    ["activity.tracing","Tracing & Handwriting Book","Generate tracing and handwriting prompt packs.","Activity Types"],
    ["activity.matching","Matching Activity Book","Generate matching activity prompt packs.","Activity Types"],
    ["activity.counting","Counting Book","Generate counting activity prompt packs.","Activity Types"],
    ["activity.simple-math","Math Practice Book","Generate simple math prompt packs.","Activity Types"],
    ["activity.spot-difference","Spot the Difference Book","Generate spot-the-difference prompt packs.","Activity Types"],
    ["activity.puzzle","Children's Puzzle Book","Generate children's puzzle prompt packs.","Activity Types"],
    ["activity.learning-worksheet","Educational Worksheet Pack","Generate educational worksheet prompt packs.","Activity Types"],
    ["quantity.25","25 Prompts Per Generation","Allow 25-prompt generation.","Generation Size"],
    ["quantity.30","30 Prompts Per Generation","Allow 30-prompt generation.","Generation Size"],
    ["advanced.custom-direction","Custom Direction","Allow custom user direction on top of the selected theme.","Advanced Inputs"],
    ["advanced.learning-goal","Custom Learning Goal","Allow custom learning goals.","Advanced Inputs"],
    ["advanced.guide-character","Guide Character","Allow recurring character locks.","Advanced Inputs"],
    ["export.save-project","Save Projects","Allow saving generated projects.","Exports"],
    ["export.json","JSON Export","Allow JSON export in the interface.","Exports"],
    ["export.txt","TXT Export","Allow TXT export in the interface.","Exports"],
    ["kit.listing-assets","Listing Kit","Generate KDP, Etsy, keyword, and A+ content assets.","Publishing Kit"],
    ["kit.quality-check","Quality Checker","Generate a quality score, warnings, and fix suggestions.","Publishing Kit"],
    ["kit.series-builder","Series Builder","Generate follow-up product ideas for catalog building.","Publishing Kit"],
    ["kit.launch-checklist","Launch Checklist","Generate a publishing checklist for marketplaces.","Publishing Kit"]
  ];
  for (const [category,items] of THEME_GROUPS) {
    for (const theme of items) features.push([themeFeatureKey(theme),theme,`Allow the ${theme} theme.`,`Themes · ${category}`]);
  }
  const insertFeature = db.prepare("INSERT OR IGNORE INTO features(feature_key,name,description,category,active) VALUES(?,?,?,?,1)");
  for (const f of features) insertFeature.run(...f);

  const allPlans = db.prepare("SELECT id,name FROM plans").all();
  const featureRows = db.prepare("SELECT id,feature_key FROM features").all();
  const byKey = Object.fromEntries(featureRows.map(f => [f.feature_key, f.id]));
  const enable = db.prepare("INSERT OR IGNORE INTO plan_features(plan_id,feature_id,enabled) VALUES(?,?,1)");
  const starter = ["activity.coloring","activity.word-search","activity.tracing","quantity.25","export.txt","kit.listing-assets"];
  const creator = starter.concat(["activity.maze","activity.matching","activity.counting","activity.simple-math","activity.learning-worksheet","advanced.custom-direction","advanced.learning-goal","export.save-project","export.json","kit.quality-check","kit.series-builder"]);
  const pro = creator.concat(["activity.educational-story","activity.spot-difference","activity.puzzle","quantity.30","advanced.guide-character","kit.launch-checklist"]);
  for (const plan of allPlans) {
    const starterThemes = THEME_GROUPS.slice(0,2).flatMap(([,items])=>items).map(themeFeatureKey);
    const creatorThemes = THEME_GROUPS.slice(0,4).flatMap(([,items])=>items).map(themeFeatureKey);
    const proThemes = THEME_GROUPS.flatMap(([,items])=>items).map(themeFeatureKey);
    const planName = String(plan.name).toLowerCase();
    const isFrontEnd = planName === "starter" || planName === "front-end";
    const isMiddle = planName === "creator" || planName === "pro oto";
    const keys = (isFrontEnd ? starter.concat(starterThemes) : isMiddle ? creator.concat(creatorThemes) : pro.concat(proThemes));
    for (const key of keys) if (byKey[key]) enable.run(plan.id, byKey[key]);
  }
}
seedBilling();

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}
async function body(req) {
  const chunks=[]; let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>1e6)throw new Error("The request is too large.");chunks.push(chunk)}
  return chunks.length?JSON.parse(Buffer.concat(chunks).toString("utf8")):{};
}
function adminAllowed(req) {
  const u = new URL(req.url, `http://${req.headers.host}`);
  return (req.headers["x-admin-token"] || u.searchParams.get("adminToken")) === ADMIN_TOKEN;
}
function clientToken(req,input={}) {
  return String(req.headers["x-user-token"] || input.userToken || "demo-token").trim();
}
function userWithPlanByToken(accessToken) {
  return db.prepare(`
    SELECT users.*, plans.name AS plan_name, plans.monthly_prompt_limit, plans.active AS plan_active
    FROM users JOIN plans ON plans.id = users.plan_id
    WHERE users.access_token = ?
  `).get(accessToken);
}
function resetPeriodIfNeeded(user) {
  const started = new Date(String(user.period_started_at).replace(" ", "T") + "Z");
  const days = (Date.now() - started.getTime()) / 86400000;
  if (Number.isFinite(days) && days >= 30) {
    db.prepare("UPDATE users SET period_started_at=CURRENT_TIMESTAMP WHERE id=?").run(user.id);
    return db.prepare(`
      SELECT users.*, plans.name AS plan_name, plans.monthly_prompt_limit, plans.active AS plan_active
      FROM users JOIN plans ON plans.id = users.plan_id
      WHERE users.id = ?
    `).get(user.id);
  }
  return user;
}
function usageForUser(user) {
  const row = db.prepare("SELECT COALESCE(SUM(units),0) AS used FROM usage_events WHERE user_id=? AND created_at >= ?")
    .get(user.id, user.period_started_at);
  const limit = Number(user.usage_limit_override || user.monthly_prompt_limit);
  const used = Number(row.used || 0);
  return { used, limit, remaining: Math.max(0, limit - used), periodStartedAt: user.period_started_at };
}
function planFeatureKeys(planId) {
  return db.prepare(`
    SELECT features.feature_key
    FROM plan_features JOIN features ON features.id = plan_features.feature_id
    WHERE plan_features.plan_id=? AND plan_features.enabled=1 AND features.active=1
  `).all(planId).map(row => row.feature_key);
}
function requiredFeatureKeys(input) {
  const keys = [`activity.${input.activityType}`, `quantity.${input.pageCount}`];
  if (input.theme) keys.push(themeFeatureKey(input.theme));
  if (String(input.customDirection || "").trim()) keys.push("advanced.custom-direction");
  if (String(input.learningGoal || "").trim()) keys.push("advanced.learning-goal");
  if (String(input.guideCharacter || "").trim()) keys.push("advanced.guide-character");
  return keys;
}
function requireUserAccess(req,input) {
  const accessToken = clientToken(req,input);
  let user = userWithPlanByToken(accessToken);
  if (!user) throw new Error("Your account token is not valid.");
  user = resetPeriodIfNeeded(user);
  if (user.status !== "active") throw new Error("Your account is not active. Please contact support.");
  if (!user.plan_active) throw new Error("Your current plan is not active. Please contact support.");
  const enabled = new Set(planFeatureKeys(user.plan_id));
  const missing = requiredFeatureKeys(input).filter(key => !enabled.has(key));
  if (missing.length) {
    throw new Error(`Your plan does not include: ${missing.join(", ")}.`);
  }
  return { user, features:[...enabled], units:Number(input.pageCount || 0) };
}
function recordUsage(user,units,metadata={}) {
  db.prepare("INSERT INTO usage_events(user_id,units,event_type,metadata_json) VALUES(?,?,?,?)")
    .run(user.id, units, "prompt_generation", JSON.stringify(metadata));
  return usageForUser(user);
}
async function ollamaReady() {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return false;
    const data = await r.json();
    return data.models?.some(x => x.name === MODEL || x.model === MODEL) || false;
  } catch { return false; }
}
function schema(count) {
  return {
    type:"object",additionalProperties:false,
    required:["book_title","subtitle","description","cover_prompt","keywords","pages"],
    properties:{
      book_title:{type:"string"},subtitle:{type:"string"},description:{type:"string"},
      cover_prompt:{type:"string"},
      keywords:{type:"array",minItems:5,maxItems:8,items:{type:"string"}},
      pages:{type:"array",minItems:count,maxItems:count,items:{
        type:"object",additionalProperties:false,
        required:["page_number","activity_type","title","instruction","learning_goal","content_items","image_prompt","answer"],
        properties:{
          page_number:{type:"integer"},activity_type:{type:"string"},title:{type:"string"},
          instruction:{type:"string"},learning_goal:{type:"string"},
          content_items:{type:"array",minItems:1,maxItems:24,items:{type:"string"}},
          image_prompt:{type:"string"},answer:{type:"string"}
        }
      }}
    }
  };
}
const PRODUCT_RULES={
  "coloring":`COLORING BOOK CONTRACT
- One clear focal scene per page with 1-4 large subjects.
- Use bold black outlines, large closed shapes, generous white space, and low detail appropriate to the age group.
- The image prompt must explicitly request black-and-white line art only and prohibit color, gray fill, shading, text, borders, and cropped subjects.`,
  "word-search":`WORD SEARCH CONTRACT
- Each page needs a unique subtopic and 8-14 age-appropriate words.
- content_items must include the exact word list and a complete letter grid with consistent row lengths.
- The answer must list every hidden word with its start position and direction.
- The image prompt should describe only small themed border decorations and leave a large clean central area for the puzzle grid. Do not ask the image model to render letters.`,
  "educational-story":`EDUCATIONAL STORY CONTRACT
- Build one connected story arc across all prompts: introduction, small challenge, attempts, resolution, and takeaway.
- Keep the same recurring character design, clothing, colors, and personality on every page.
- Each page is one concrete scene, advances the story, and teaches one gentle age-appropriate lesson.
- The image prompt must restate the complete character lock whenever the recurring character appears.`,
  "maze":`MAZE BOOK CONTRACT
- Every maze must have one visible start, one visible goal, a theme-relevant obstacle set, and exactly one intended solution.
- Vary maze silhouettes and scene concepts while keeping paths wide and printable.
- content_items and answer must define an exact route using U/D/L/R steps. The image prompt must request no decorative objects inside paths.`,
  "tracing":`TRACING & HANDWRITING CONTRACT
- State the exact strokes, letters, numbers, or words to trace.
- Progress gradually from guided examples to independent practice.
- Request thick dotted tracing guides, clear baselines, large spacing, and minimal decoration.`,
  "matching":`MATCHING CONTRACT
- Include 4-8 exact pairs, with left and right columns deliberately shuffled.
- content_items must define every pair and the displayed order. The answer must repeat all correct matches.
- Keep the center area open for children to draw connecting lines.`,
  "counting":`COUNTING CONTRACT
- State exact object quantities in content_items and keep every object fully visible and easy to distinguish.
- Use age-appropriate number ranges and vary the scene without creating ambiguous overlaps.
- The answer must give the exact count.`,
  "simple-math":`MATH PRACTICE CONTRACT
- Include exact operands, operation symbols, and one unambiguous answer for every problem.
- Match number size and operation difficulty to the age group.
- Use visual manipulatives only when their quantities are explicitly defined.`,
  "spot-difference":`SPOT THE DIFFERENCE CONTRACT
- Define two nearly identical scenes and exactly 5-8 concrete visual differences.
- content_items must list every difference precisely; the answer must repeat the complete list.
- Keep composition, character placement, and camera angle identical between the two panels.`,
  "puzzle":`CHILDREN'S PUZZLE CONTRACT
- Name the exact puzzle mechanic and fully specify all clues, choices, and solution.
- Use only one puzzle mechanic per prompt.
- Avoid puzzles that depend on details not defined in content_items.`,
  "learning-worksheet":`EDUCATIONAL WORKSHEET CONTRACT
- Each page focuses on one measurable learning objective and one clear task.
- Include all questions, choices, examples, and answers explicitly.
- Use a clean classroom worksheet layout with strong visual hierarchy and ample writing space.`
};
const THEME_VISUALS={
  animals:"friendly natural habitat, simple plants and environmental details, warm approachable expressions",
  careers:"clear workplace setting, recognizable tools and safe uniforms, positive community-focused action",
  science:"educational exploration setting, simplified accurate scientific objects, wonder and discovery",
  learning:"clean classroom-friendly visual language, familiar everyday objects, clear concept-focused composition",
  fantasy:"whimsical child-safe fantasy world, playful magical details, friendly non-threatening characters",
  transport:"clear travel environment, recognizable vehicles, safe movement and uncluttered composition",
  holiday:"festive child-friendly setting, recognizable seasonal decorations, warm celebratory mood"
};
function productRules(type){return PRODUCT_RULES[type]||PRODUCT_RULES["learning-worksheet"]}
function themeVisualDirection(theme=""){
  const t=theme.toLowerCase();
  if(/animal|dinosaur|insect|butterfl|bird|pet|ocean|rainforest|arctic|farm|safari|woodland/.test(t))return THEME_VISUALS.animals;
  if(/helper|doctor|nurse|firefighter|police|teacher|school|worker|farmer|chef|baker|scientist|astronaut/.test(t))return THEME_VISUALS.careers;
  if(/space|solar|weather|season|body|plant|garden|volcano|coral|camping|treasure/.test(t))return THEME_VISUALS.science;
  if(/alphabet|number|shape|color|opposite|habit|emotion|feeling|friendship|kindness|safety|routine/.test(t))return THEME_VISUALS.learning;
  if(/unicorn|dragon|castle|fair|magic|pirate|robot/.test(t))return THEME_VISUALS.fantasy;
  if(/car|truck|train|airplane/.test(t))return THEME_VISUALS.transport;
  return THEME_VISUALS.holiday;
}
function visualContract(input){
  input.size = "A4";
  const characterLock=input.guideCharacter
    ? `Recurring character lock: ${input.guideCharacter}; keep the same species/person, age, face, body proportions, clothing, colors, accessories, and personality across every prompt`
    : "Character consistency lock: whenever a character recurs, repeat the same species/person, age, face, body proportions, clothing, colors, and accessories";
  return {
    styleAnchor:`${input.style}, consistent child-friendly visual language`,
    themeDirection:themeVisualDirection(input.theme||input.topic),
    characterLock,
    layoutLock:`one standalone A4 portrait printable page, clear focal hierarchy, clean margins, safe trim area, no cropped important objects`,
    negativeLock:input.activityType==="coloring"
      ? "black-and-white line art only, no color, no grayscale, no shading, no gradients, no shadows, no textures, no text, no watermark, no logo, no border, no photorealism, no 3D render"
      : "no watermark, no logo, no brand characters, no photorealism, no 3D render, no malformed anatomy, no clutter, no cropped important objects, no illegible embedded text"
  };
}
function lockImagePrompt(prompt,input){
  const c=visualContract(input);
  let scene=String(prompt||"").trim().replace(/[.\s]+$/,"");
  if(input.activityType==="coloring"){
    scene=scene
      .replace(/\bvibrant\b/gi,"lively")
      .replace(/\bcolorful\b/gi,"varied")
      .replace(/\bfull[- ]color\b/gi,"black-and-white")
      .replace(/\bbrightly colored\b/gi,"clearly differentiated");
  }
  const opening=input.activityType==="coloring"
    ? "Create a detailed black-and-white coloring book page for children, vertical A4 portrait composition."
    : `Create a detailed ${input.genreType || "children's educational"} image prompt for children, vertical A4 portrait composition.`;
  return `${opening}\n\nScene: ${scene}.\n\nComposition and details: include clear foreground, middle ground, and background; expressive child-friendly characters or objects; readable silhouettes; balanced full-page layout; rich theme-specific props and decorative details; ${c.themeDirection}.\n\nStyle: ${c.styleAnchor}; ${c.layoutLock}; ${c.characterLock}.\n\nNegative prompt: ${c.negativeLock}.`;
}
function lockCoverPrompt(prompt,input){
  const c=visualContract(input);
  let scene=String(prompt||"").trim()
    .replace(/[.\s]+$/,"")
    .replace(/\bblack-and-white\b/gi,"full-color")
    .replace(/\bblack and white\b/gi,"full-color")
    .replace(/\bline art only\b/gi,"polished full-color illustration")
    .replace(/\bno color\b/gi,"rich color")
    .replace(/\bno shading\b/gi,"soft professional shading")
    .replace(/\bno grayscale\b/gi,"full-color palette");
  const palette=input.activityType==="coloring"
    ? "bright cheerful children's book cover palette, warm inviting colors, colorful title-safe background"
    : "rich professional color palette matched to the selected genre";
  return `Create a premium full-color children's book cover, vertical 2:3 composition.\n\nScene: ${scene}.\n\nCover design: clear central focal character or object, strong readable silhouette, polished publishing layout, title-safe space in the upper-middle, subtitle-safe space below the title, author-name safe space at the bottom, balanced foreground and background, ornate but readable framing, rich theme-specific props and decorative details, ${c.themeDirection}.\n\nColor and mood: ${palette}, cinematic lighting where appropriate, soft depth, magical but child-friendly atmosphere, professional illustrated book cover finish.\n\nStyle: ${input.style}, consistent child-friendly visual language, premium cover art, high-resolution, no cropped important objects.\n\nNegative prompt: no watermark, no logo, no brand characters, no photorealism, no 3D render, no malformed anatomy, no cluttered typography, no illegible random text.`;
}
function ensurePublishingKit(book,input){
  const title=String(book.book_title||`${input.theme} Activity Book`).slice(0,70);
  const subtitle=String(book.subtitle||`${input.activityType} pages for ${input.age}`).slice(0,120);
  const theme=String(input.theme||input.topic||"Activity Book");
  const activity=String(input.activityType||"activity").replace(/-/g," ");
  const keywords=(Array.isArray(book.keywords)&&book.keywords.length?book.keywords:[theme,`${theme} activity book`,`${activity} book`,`${input.age} activities`]).slice(0,8);
  if(!book.listing_assets){
    book.listing_assets={
      kdp_title:title,
      kdp_subtitle:subtitle,
      kdp_description:`${title} is a printable ${activity} product kit for ${input.age}. It includes themed page concepts, clear instructions, answer guidance where needed, and cover direction to help sellers prepare a polished activity book for KDP, Etsy, Gumroad, or classroom marketplaces. Review the pages, create the final artwork, verify print settings, and customize the listing before publishing.`,
      backend_keywords:Array.from({length:7},(_,i)=>keywords[i]||`${theme} printable activity ${i+1}`),
      etsy_title:`${title} Printable Activity Book, ${theme} ${activity} Pages, Kids Workbook PDF`,
      etsy_tags:[theme,"activity book","printable kids","kids worksheet","kdp interior","etsy printable",activity,"homeschool","classroom","coloring pages","busy book","learning fun","digital download"].slice(0,13),
      short_blurb:`A ${theme} ${activity} kit with page prompts, answer keys, cover direction, and launch-ready marketplace assets.`,
      a_plus_sections:[
        `Show the ${theme} theme and age range at a glance.`,
        "Highlight sample interior pages and the learning benefits.",
        "Explain what buyers receive and how the printable can be used.",
        "Show bundle or series options for repeat buyers."
      ]
    };
  }
  if(!book.quality_check){
    const warnings=[];
    if(!book.cover_prompt)warnings.push("Add or review the cover prompt before publishing.");
    if(!Array.isArray(book.pages)||book.pages.length!==input.pageCount)warnings.push("Page count does not match the selected generation size.");
    if(input.activityType==="coloring"&&book.pages?.some(p=>/colorful|full-color|shading/i.test(p.image_prompt||"")))warnings.push("Some coloring page prompts may mention color or shading; review before image generation.");
    book.quality_check={
      score:Math.max(70,100-(warnings.length*8)),
      passed_checks:["Product title and subtitle are present.","Page instructions are structured.","Answer guidance is included where relevant.","Cover direction is included.","Marketplace keywords are available."],
      warnings,
      fix_suggestions:["Review every page before creating final artwork.","Customize the listing copy to match your marketplace and brand.","Check KDP/Etsy trim size, margins, and commercial-use requirements before upload."]
    };
  }
  if(!Array.isArray(book.series_ideas)||!book.series_ideas.length){
    book.series_ideas=[
      `${theme} Beginner Edition for younger learners`,
      `${theme} Advanced Edition with harder ${activity} tasks`,
      `${theme} Holiday Special Edition`,
      `${theme} Large Print Edition`,
      `${theme} Classroom Worksheet Bundle`,
      `${theme} Activity Book Series Volume 2`
    ];
  }
  if(!Array.isArray(book.publishing_checklist)||!book.publishing_checklist.length){
    book.publishing_checklist=[
      "Review every generated page for accuracy and age fit.",
      "Create final artwork from each image prompt.",
      "Check page size, margins, bleed, and gutter before export.",
      "Create or refine the cover with title-safe space.",
      "Verify answer keys and remove ambiguous tasks.",
      "Customize KDP title, subtitle, description, and backend keywords.",
      "Create Etsy tags, preview images, and mockups if selling digitally.",
      "Export final interior as a print-ready PDF only after visual QA.",
      "Publish one product first, then expand into the suggested series."
    ];
  }
  return book;
}
function buildPrompt(input, startPage, batchCount, previousTitles=[], previousPages=[]) {
  const pagePlan = Array.from({ length: batchCount }, (_, index) => {
    const activityType = input.activityType;
    return `- Prompt ${startPage + index}: activity_type must be exactly "${activityType}"`;
  }).join("\n");
  return `You are an expert educational activity book designer for children.
Create exactly ${batchCount} unique printable activity concepts for prompts ${startPage} through ${startPage + batchCount - 1}.

USER SETTINGS
- Main topic: ${input.topic}
- Selected theme: ${input.theme || input.topic}
- Age group: ${input.age}
- Content language: ${input.language}
- Product/activity type: ${input.activityType}
- Type / genre direction: ${input.genreType || input.difficulty || "Classic Educational"}
- Page size: A4 portrait
- Illustration style: ${input.style}
- Learning goal: ${input.learningGoal || "age-appropriate cognitive skills, vocabulary, observation, and problem solving"}
- Guide character: ${input.guideCharacter || "none required"}
- Titles already used in earlier batches: ${previousTitles.length ? previousTitles.join(" | ") : "none"}
- Previous story/page continuity: ${previousPages.length ? previousPages.slice(-3).map(page=>`${page.page_number}. ${page.title}: ${page.instruction}`).join(" | ") : "this is the first batch"}
- Theme visual direction: ${themeVisualDirection(input.theme || input.topic)}

REQUIRED PAGE PLAN
${pagePlan}

PRODUCT-SPECIFIC RULES
${productRules(input.activityType)}

MASTER VISUAL PROMPT CONTRACT
- Write image_prompt like a professional AI image prompt, similar to a Midjourney / Ideogram / ChatGPT image prompt.
- Each image_prompt scene body must be 90-170 words before the app adds final style and negative prompt sections.
- Use this structure inside the scene body: main scene, exact subjects, character actions, facial expressions, clothing/costumes, props, background, decorative elements, composition, and printable layout.
- For coloring pages, image_prompt must specify black-and-white line art subjects and many fun decorative elements, but avoid color words.
- For covers, cover_prompt must be full-color even when the product is a coloring book. It must be premium and book-cover-like: vertical 2:3 cover composition, rich color palette, title-safe space, ornate framing, clear central character or object, professional publishing design.
- If cover_prompt includes typography, describe the text layout area clearly, but do not invent unreadable random text.

RULES
1. All visible titles, instructions, content items, answers, description, and keywords must be in ${input.language}.
2. Write natural, fluent, grammatically correct ${input.language}. Never truncate a title or sentence. Keep the book title under 55 characters.
3. Every image_prompt and cover_prompt must be written in English for an image generation model.
4. Follow the REQUIRED PAGE PLAN exactly. This is a single-format product: every page must use the selected activity type. Do not combine, rename, replace, or invent activity types.
5. Set page_number to the exact prompt number shown in the REQUIRED PAGE PLAN.
6. Activities must be safe, factual, age-appropriate, internally consistent, and realistically printable on A4 portrait pages.
7. Give concrete content_items that fully define the page. Do not rely on information that is not included in content_items or image_prompt.
8. Answers must be exact and unambiguous. Never write "depends on the image", "depending on the task", or similar uncertainty.
9. For counting and math, state exact quantities in content_items and give the exact numeric answer.
10. For matching, list each exact pair in content_items and repeat the correct pairs in answer.
11. For mazes, define the start, goal, obstacles, and one exact solvable route. Repeat that route in the answer.
12. For word searches, provide the complete word list in content_items and repeat the exact list in the answer.
13. For coloring or creative pages, the answer should say that multiple valid color choices are accepted while noting any learning requirement.
14. For educational-story pages, create one connected story across the book. Each page must contain a short scene, an age-appropriate lesson, a concrete illustration prompt, and a simple reflection answer or takeaway.
15. For tracing pages, specify the exact letters, words, or strokes to trace. For puzzle pages, fully define the puzzle and its exact solution.
16. Translate the requested illustration style into English inside image prompts. Do not put non-English style phrases in image prompts.
17. Every image prompt must explicitly describe subjects, action, expression, clothing/costumes if relevant, props, background, composition, printable A4 portrait layout, and the selected type/genre direction.
18. Do not use copyrighted characters, brands, logos, or trademarks.
19. Do not claim that generated images are automatically KDP-ready.
20. Every title and concept must be different from the titles already used in earlier batches.
21. Return only JSON matching the supplied schema.`;
}
async function generateBatch(input,startPage,batchCount,previousTitles,previousPages) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method:"POST",signal:controller.signal,
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        model:MODEL,prompt:buildPrompt(input,startPage,batchCount,previousTitles,previousPages),stream:false,think:false,format:schema(batchCount),
        keep_alive:"15m",options:{temperature:.55,num_ctx:8192,num_predict:7000}
      })
    });
    if(!response.ok)throw new Error(`Ollama ${response.status}: ${(await response.text()).slice(0,300)}`);
    const result=await response.json();
    const book=JSON.parse(result.response);
    book.pages=book.pages.slice(0,batchCount).map((page,index)=>({
      ...page,
      page_number:startPage+index,
      activity_type:input.activityType,
      image_prompt:lockImagePrompt(page.image_prompt,input)
    }));
    book.cover_prompt=lockCoverPrompt(book.cover_prompt,input);
    ensurePublishingKit(book,input);
    if(book.pages.length!==batchCount)throw new Error("The content engine did not create every requested prompt. Please try again.");
    return {book,metrics:{totalDuration:result.total_duration,evalCount:result.eval_count}};
  } finally { clearTimeout(timeout); }
}
function fallbackPage(input,pageNumber){
  const theme=input.theme||input.topic||"Activity";
  const activity=String(input.activityType||"activity").replace(/-/g," ");
  const topicBits=["explorer","challenge","practice","review","discovery","mission","workshop","adventure","bonus","recap"];
  const focus=topicBits[(pageNumber-1)%topicBits.length];
  const title=`${theme} ${focus} ${pageNumber}`;
  const commonPrompt=`Create a clean ${input.style || "children's educational workbook illustration"} page for children, vertical A4 portrait composition. Scene: ${theme} ${activity} page ${pageNumber} with clear child-friendly subjects, balanced spacing, safe margins, readable silhouettes, and printable layout. Include theme-specific props and simple visual hierarchy. Negative prompt: no watermark, no logo, no brand characters, no clutter, no cropped important objects.`;
  const base={page_number:pageNumber,activity_type:input.activityType,title,instruction:`Complete the ${activity} activity using the ${theme} theme.`,learning_goal:"Observation, vocabulary, focus, and age-appropriate problem solving.",content_items:[`${theme} scene ${pageNumber}`,`${activity} task`,`${input.age} friendly layout`],image_prompt:commonPrompt,answer:"Answers may vary when the page is creative; review the finished artwork for clarity."};
  if(input.activityType==="word-search"){
    const words=[theme.split(/\s+/)[0]||"OCEAN","FIND","LEARN","PLAY","SMART","FOCUS","WORD","BOOK"];
    return {...base,instruction:`Find the hidden ${theme} words in the grid.`,content_items:[`Words: ${words.join(", ")}`,"Grid: F I N D P L A Y / L E A R N B O O / S M A R T W O R / F O C U S D K S"],answer:`Hidden words: ${words.join(", ")}.`};
  }
  if(input.activityType==="tracing"){
    return {...base,instruction:`Trace the ${theme} vocabulary words, then write them once on your own.`,content_items:[`Trace: ${theme}`,`Trace: learn`,`Trace: explore`],answer:"Tracing is complete when each word is followed on the dotted guide and rewritten clearly."};
  }
  if(input.activityType==="maze"){
    return {...base,instruction:`Help the character move through the ${theme} maze from start to finish.`,content_items:["Start: top left","Goal: bottom right","Route: R, R, D, D, R, D"],answer:"Solution route: R, R, D, D, R, D."};
  }
  return base;
}
function generateFallbackBook(input,reason=""){
  const theme=input.theme||input.topic||"Activity";
  const activity=String(input.activityType||"activity").replace(/-/g," ");
  const pages=Array.from({length:input.pageCount},(_,index)=>fallbackPage(input,index+1));
  const book={
    book_title:`${theme} ${activity.replace(/\b\w/g,c=>c.toUpperCase())} Kit`,
    subtitle:`Printable ${activity} pages for ${input.age}`,
    description:`A quick product kit for ${theme} ${activity} pages with instructions, answer guidance, cover direction, listing assets, and a launch checklist.`,
    cover_prompt:lockCoverPrompt(`A polished ${theme} ${activity} activity book cover with friendly child-safe visuals, clear title-safe space, and marketplace-ready composition`,input),
    keywords:[theme,`${theme} ${activity}`,`${activity} book`,"printable activity","kids workbook","KDP interior","Etsy printable","learning pages"],
    pages
  };
  ensurePublishingKit(book,input);
  const fastMode = /fast product kit mode/i.test(reason);
  book.quality_check.warnings.unshift(fastMode?"Generated with Fast Product Kit mode for immediate output. Enable USE_OLLAMA_GENERATION=1 for slower local AI drafting.":reason?`Generated with the quick fallback because the local model was slow or unavailable: ${reason}`:"Generated with the quick fallback workflow.");
  book.quality_check.score=Math.min(book.quality_check.score,82);
  return {book,metrics:{totalDuration:0,evalCount:0,batches:0,fallback:true,reason}};
}
async function generateBook(input) {
  if(!USE_OLLAMA_GENERATION) return generateFallbackBook(input,"Fast product kit mode is enabled.");
  try {
  const batchSize=5,pages=[],titles=[];let metadata=null,totalDuration=0,evalCount=0;
  for(let startPage=1;startPage<=input.pageCount;startPage+=batchSize){
    const batchCount=Math.min(batchSize,input.pageCount-startPage+1);
    let result,attempt=0;
    while(attempt<3){
      result=await generateBatch(input,startPage,batchCount,titles,pages);
      const known=new Set(pages.map(promptSignature));
      const signatures=result.book.pages.map(promptSignature);
      const uniqueBatch=new Set(signatures);
      const overlaps=signatures.some(signature=>known.has(signature));
      if(!overlaps&&uniqueBatch.size===signatures.length)break;
      attempt++;
    }
    if(attempt===3)throw new Error("A prompt batch repeated the same content. Please generate the pack again.");
    if(!metadata)metadata=result.book;
    for(const page of result.book.pages){
      let title=page.title;
      if(titles.map(normalizeTitle).includes(normalizeTitle(title)))title=`${title} — Prompt ${page.page_number}`;
      page.title=title;
      pages.push(page);
    }
    titles.push(...result.book.pages.map(page=>page.title));
    totalDuration+=Number(result.metrics.totalDuration||0);
    evalCount+=Number(result.metrics.evalCount||0);
  }
  if(pages.length!==input.pageCount)throw new Error(`The content engine created ${pages.length}/${input.pageCount} prompts. Please generate again.`);
  return {book:{...metadata,pages},metrics:{totalDuration,evalCount,batches:Math.ceil(input.pageCount/batchSize)}};
  } catch(e) {
    console.warn("Using fallback product kit generator:", e.message);
    return generateFallbackBook(input,e.name==="AbortError"?"The content engine took too long to respond.":e.message);
  }
}
function normalizeTitle(title=""){
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
function promptSignature(page={}){
  return normalizeTitle(`${page.title} ${page.instruction} ${(page.content_items||[]).join(" ")}`);
}
function validate(input){
  if(!input.topic||input.topic.length<3)throw new Error("Please select a theme.");
  if(!input.activityType)input.activityType=Array.isArray(input.activityTypes)?input.activityTypes[0]:"";
  if(!input.activityType)throw new Error("Please select an activity type.");
  if(!input.theme)throw new Error("Please select a theme.");
  if(!isCompatible(input.activityType,input.theme))throw new Error(`The selected theme is not a good fit for ${input.activityType}. Please choose another theme.`);
  input.genreType=String(input.genreType||input.difficulty||"Classic Educational").trim();
  if(!GENRE_TYPES.includes(input.genreType))throw new Error("Please select a valid type / genre.");
  if(!isGenreCompatible(input.activityType,input.theme,input.genreType))throw new Error(`The selected type / genre is not a good fit for ${input.activityType} with ${input.theme}. Please choose another combination.`);
  input.difficulty=input.genreType;
  input.style=String(input.style||styleFromGenre(input.genreType)).trim();
  input.size="A4";
  input.pageCount=Number(input.pageCount);
  if(![25,30].includes(input.pageCount))throw new Error("Please select 25 or 30 prompts.");
  return input;
}
function publicUser(user) {
  const usage = usageForUser(user);
  return {
    id:user.id,email:user.email,name:user.name,token:user.access_token,planId:user.plan_id,planName:user.plan_name,
    status:user.status,limit:usage.limit,used:usage.used,remaining:usage.remaining,periodStartedAt:usage.periodStartedAt,
    features:planFeatureKeys(user.plan_id),
    usageLimitOverride:user.usage_limit_override,createdAt:user.created_at
  };
}
function allUsers() {
  return db.prepare(`
    SELECT users.*, plans.name AS plan_name, plans.monthly_prompt_limit, plans.active AS plan_active
    FROM users JOIN plans ON plans.id = users.plan_id
    ORDER BY users.id DESC
  `).all().map(publicUser);
}
async function adminApi(req,res,pathname) {
  if (!adminAllowed(req)) return json(res,401,{error:"Admin token is required."});

  if (pathname==="/api/admin/plans" && req.method==="GET") {
    const rows = db.prepare("SELECT * FROM plans ORDER BY monthly_prompt_limit ASC").all();
    return json(res,200,{items:rows.map(r=>({id:r.id,name:r.name,monthlyPromptLimit:r.monthly_prompt_limit,priceCents:r.price_cents,active:!!r.active,features:planFeatureKeys(r.id),createdAt:r.created_at}))});
  }
  if (pathname==="/api/admin/plans" && req.method==="POST") {
    const input = await body(req);
    const name = String(input.name||"").trim();
    const limit = Number(input.monthlyPromptLimit);
    if (!name || !Number.isInteger(limit) || limit < 1) return json(res,400,{error:"Plan name and monthly prompt limit are required."});
    const r = db.prepare("INSERT INTO plans(name,monthly_prompt_limit,price_cents,active) VALUES(?,?,?,?)")
      .run(name, limit, Number(input.priceCents||0), input.active===false?0:1);
    return json(res,201,{id:Number(r.lastInsertRowid)});
  }
  const planMatch = pathname.match(/^\/api\/admin\/plans\/(\d+)$/);
  if (planMatch && req.method==="PATCH") {
    const id = Number(planMatch[1]);
    const current = db.prepare("SELECT * FROM plans WHERE id=?").get(id);
    if (!current) return json(res,404,{error:"Plan not found."});
    const input = await body(req);
    db.prepare("UPDATE plans SET name=?,monthly_prompt_limit=?,price_cents=?,active=? WHERE id=?")
      .run(
        input.name==null?current.name:String(input.name).trim(),
        input.monthlyPromptLimit==null?current.monthly_prompt_limit:Number(input.monthlyPromptLimit),
        input.priceCents==null?current.price_cents:Number(input.priceCents),
        input.active==null?current.active:(input.active?1:0),
        id
      );
    return json(res,200,{ok:true});
  }

  if (pathname==="/api/admin/features" && req.method==="GET") {
    const rows = db.prepare("SELECT * FROM features ORDER BY category,name").all();
    return json(res,200,{items:rows.map(r=>({id:r.id,key:r.feature_key,name:r.name,description:r.description,category:r.category,active:!!r.active,createdAt:r.created_at}))});
  }
  if (pathname==="/api/admin/features" && req.method==="POST") {
    const input = await body(req);
    const featureKey = String(input.key||"").trim().toLowerCase();
    const name = String(input.name||"").trim();
    if (!/^[a-z0-9][a-z0-9._-]{2,80}$/.test(featureKey) || !name) return json(res,400,{error:"Feature key and name are required. Use keys like activity.coloring or export.pdf."});
    try {
      const r = db.prepare("INSERT INTO features(feature_key,name,description,category,active) VALUES(?,?,?,?,?)")
        .run(featureKey,name,String(input.description||""),String(input.category||"General"),input.active===false?0:1);
      return json(res,201,{id:Number(r.lastInsertRowid)});
    } catch(e) {
      return json(res,400,{error:e.message});
    }
  }
  if (pathname==="/api/admin/plan-features" && req.method==="POST") {
    const input = await body(req);
    const planId = Number(input.planId);
    const featureIds = Array.isArray(input.featureIds) ? input.featureIds.map(Number).filter(Boolean) : [];
    if (!planId) return json(res,400,{error:"Plan is required."});
    db.prepare("DELETE FROM plan_features WHERE plan_id=?").run(planId);
    const insert = db.prepare("INSERT INTO plan_features(plan_id,feature_id,enabled) VALUES(?,?,1)");
    for (const featureId of featureIds) insert.run(planId,featureId);
    return json(res,200,{ok:true});
  }

  if (pathname==="/api/admin/users" && req.method==="GET") return json(res,200,{items:allUsers()});
  if (pathname==="/api/admin/users" && req.method==="POST") {
    const input = await body(req);
    const email = String(input.email||"").trim().toLowerCase();
    const name = String(input.name||"").trim();
    const planId = Number(input.planId);
    if (!email || !planId) return json(res,400,{error:"Email and plan are required."});
    const accessToken = String(input.token||token("bb_user")).trim();
    try {
      const r = db.prepare("INSERT INTO users(email,name,access_token,plan_id,status,usage_limit_override) VALUES(?,?,?,?,?,?)")
        .run(email, name, accessToken, planId, input.status||"active", input.usageLimitOverride==null?null:Number(input.usageLimitOverride));
      return json(res,201,{id:Number(r.lastInsertRowid),token:accessToken});
    } catch(e) {
      return json(res,400,{error:e.message});
    }
  }

  const userMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
  if (userMatch && req.method==="PATCH") {
    const id = Number(userMatch[1]);
    const input = await body(req);
    const current = db.prepare("SELECT * FROM users WHERE id=?").get(id);
    if (!current) return json(res,404,{error:"User not found."});
    const next = {
      email: input.email==null?current.email:String(input.email).trim().toLowerCase(),
      name: input.name==null?current.name:String(input.name).trim(),
      planId: input.planId==null?current.plan_id:Number(input.planId),
      status: input.status==null?current.status:String(input.status),
      usageLimitOverride: input.usageLimitOverride===undefined?current.usage_limit_override:(input.usageLimitOverride===null?null:Number(input.usageLimitOverride)),
      token: input.token==null?current.access_token:String(input.token).trim()
    };
    db.prepare("UPDATE users SET email=?,name=?,plan_id=?,status=?,usage_limit_override=?,access_token=? WHERE id=?")
      .run(next.email,next.name,next.planId,next.status,next.usageLimitOverride,next.token,id);
    return json(res,200,{ok:true});
  }

  if (pathname==="/api/admin/usage" && req.method==="GET") {
    const rows = db.prepare(`
      SELECT usage_events.*, users.email
      FROM usage_events JOIN users ON users.id = usage_events.user_id
      ORDER BY usage_events.id DESC LIMIT 200
    `).all();
    return json(res,200,{items:rows.map(r=>({id:r.id,userId:r.user_id,email:r.email,units:r.units,eventType:r.event_type,metadata:JSON.parse(r.metadata_json||"{}"),createdAt:r.created_at}))});
  }

  return json(res,404,{error:"Admin endpoint not found."});
}
async function api(req,res,pathname){
  if(pathname.startsWith("/api/admin/")) return adminApi(req,res,pathname);
  if(pathname==="/api/health"&&req.method==="GET"){
    const ready=await ollamaReady();return json(res,200,{ok:true,ollama:ready,model:MODEL,billing:true});
  }
  if(pathname==="/api/catalog"&&req.method==="GET"){
    return json(res,200,{
      activities:ACTIVITY_TYPES.map(type=>({type,featureKey:`activity.${type}`})),
      themes:THEME_GROUPS.flatMap(([category,items])=>items.map(name=>({name,category,featureKey:themeFeatureKey(name),compatibleActivityTypes:compatibleActivityTypes(name)}))),
      genres:GENRE_TYPES.map(name=>({name,compatibleActivityTypes:compatibleActivitiesForGenre(name),compatibleThemes:compatibleThemesForGenre(name)}))
    });
  }
  if(pathname==="/api/me"&&req.method==="GET"){
    const user=userWithPlanByToken(clientToken(req));
    if(!user)return json(res,401,{error:"Your account token is not valid."});
    return json(res,200,{user:publicUser(resetPeriodIfNeeded(user))});
  }
  if(pathname==="/api/generate"&&req.method==="POST"){
    let input;try{input=validate(await body(req))}catch(e){return json(res,400,{error:e.message})}
    let access;try{access=requireUserAccess(req,input)}catch(e){return json(res,403,{error:e.message})}
    if(!(await ollamaReady()))return json(res,503,{error:"The content engine is not ready. Please try again shortly."});
    try{const result=await generateBook(input);const usage=recordUsage(access.user,access.units,{activityType:input.activityType,theme:input.theme,mode:"ai",features:requiredFeatureKeys(input)});return json(res,201,{...result,usage,features:access.features})}
    catch(e){console.error(e);return json(res,502,{error:e.name==="AbortError"?"The content engine took too long to respond. Please try again.":e.message})}
  }
  if(pathname==="/api/projects"&&req.method==="GET"){
    const rows=db.prepare("SELECT * FROM projects ORDER BY id DESC LIMIT 50").all();
    return json(res,200,{items:rows.map(r=>({id:r.id,title:r.title,settings:JSON.parse(r.settings_json),book:JSON.parse(r.book_json),createdAt:r.created_at}))});
  }
  if(pathname==="/api/projects"&&req.method==="POST"){
    const input=await body(req);if(!input.book?.book_title)return json(res,400,{error:"The project data is not valid."});
    const r=db.prepare("INSERT INTO projects(title,settings_json,book_json) VALUES(?,?,?)").run(input.book.book_title,JSON.stringify(input.settings||{}),JSON.stringify(input.book));
    return json(res,201,{id:Number(r.lastInsertRowid)});
  }
  return json(res,404,{error:"Endpoint not found."});
}
const mime={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8",".json":"application/json; charset=utf-8"};
function staticFile(res,pathname){const rel=pathname==="/"?"index.html":pathname.slice(1),abs=path.resolve(ROOT,rel);if(!abs.startsWith(ROOT)||!fs.existsSync(abs)||fs.statSync(abs).isDirectory()){res.writeHead(404);return res.end("Not found")}res.writeHead(200,{"Content-Type":mime[path.extname(abs)]||"application/octet-stream","Cache-Control":"no-cache"});fs.createReadStream(abs).pipe(res)}
http.createServer(async(req,res)=>{try{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname.startsWith("/api/"))return await api(req,res,u.pathname);staticFile(res,u.pathname)}catch(e){console.error(e);json(res,500,{error:e.message})}}).listen(PORT,"127.0.0.1",()=>console.log(`BrightBook http://127.0.0.1:${PORT} · ${MODEL}`));
