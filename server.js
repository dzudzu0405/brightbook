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
const USE_OLLAMA_GENERATION = process.env.USE_OLLAMA_GENERATION !== "0";
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
const THEME_ALIASES={
  "Ocean Animals":["ocean","sea","marine","underwater","dolphin","turtle","whale","shark","fish","coral"],
  "Farm Animals":["farm","barn","cow","sheep","pig","chicken","horse","duck","goat","rooster","calf","lamb"],
  "Safari Animals":["safari","lion","elephant","giraffe","zebra","rhino","hippo","savanna"],
  "Woodland Animals":["woodland","forest animal","fox","deer","bear","rabbit","squirrel","raccoon"],
  "Rainforest Animals":["rainforest","jungle","monkey","parrot","jaguar","toucan","tropical"],
  "Arctic Animals":["arctic","polar","penguin","seal","walrus","snow animal"],
  "Dinosaurs":["dinosaur","dino","t rex","triceratops","stegosaurus"],
  "Insects & Butterflies":["insect","bug","butterfly","bee","ladybug","dragonfly"],
  "Pets":["pet","dog","cat","puppy","kitten","hamster"],
  "Doctors & Nurses":["doctor","nurse","hospital","clinic","medical"],
  "Firefighters":["firefighter","fire truck","fire station"],
  "Police Officers":["police","officer"],
  "Teachers & School":["teacher","school","classroom","student"],
  "Construction Workers":["construction","builder","crane","bulldozer"],
  "Farmers":["farmer","farming","tractor","harvest"],
  "Chefs & Bakers":["chef","baker","bakery","cooking"],
  "Scientists":["scientist","science lab","experiment","microscope"],
  "Astronauts":["astronaut","space suit","moon explorer"],
  "Outer Space":["outer space","space","rocket","alien","galaxy"],
  "Solar System":["solar system","planet","sun","moon","orbit"],
  "Weather":["weather","rain","storm","cloud","wind","snow"],
  "Plants & Gardens":["plant","garden","flower","seed","tree"],
  "Volcanoes":["volcano","lava","eruption"],
  "Oceans & Coral Reefs":["coral reef","reef","coral","ocean reef"],
  "Camping Adventure":["camping","campfire","tent","hiking"],
  "Treasure Hunt":["treasure","hidden treasure"],
  "Alphabet":["alphabet","letter","abc"],
  "Shapes":["shape","circle","square","triangle"],
  "Colors":["color","colors","rainbow color"],
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
const MAZE_LAYOUT_TYPES=[
  "Mixed Marketplace Variety",
  "Classic Rectangle Maze",
  "Circular Ring Maze",
  "Triangle Pyramid Maze",
  "Object-Shaped Maze",
  "House or Barn Maze",
  "Animal Silhouette Maze",
  "Adventure Path Maze"
];
function featureSlug(value=""){
  return String(value).toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
}
function normText(value=""){
  return String(value).toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").trim();
}
function detectThemeFromIdea(idea,activityType="",genreType=""){
  const text=normText(idea);
  if(!text)return "";
  const genreThemes=genreType&&GENRE_TYPES.includes(genreType)?new Set(compatibleThemesForGenre(genreType)):null;
  const candidates=THEME_GROUPS.flatMap(([,items])=>items).filter(theme=>{
    const activityOk=!activityType||compatibleActivityTypes(theme).includes(activityType);
    const genreOk=!genreThemes||genreThemes.has(theme);
    return activityOk&&genreOk;
  });
  const scored=candidates.map(theme=>{
    const name=normText(theme);
    const tokens=name.split(" ").filter(token=>token.length>2);
    let score=text.includes(name)?12:0;
    for(const token of tokens)if(text.includes(token))score+=2;
    for(const alias of THEME_ALIASES[theme]||[]){
      const normalized=normText(alias);
      if(text.includes(normalized))score+=normalized.includes(" ")?8:5;
    }
    return {theme,score};
  }).sort((a,b)=>b.score-a.score);
  return scored[0]?.score>0?scored[0].theme:"";
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
  const setPlanFeatures = db.prepare("DELETE FROM plan_features WHERE plan_id=?");
  const starter = ["activity.coloring","activity.word-search","quantity.25","export.txt","export.json"];
  const activityExpansion = starter.concat(["activity.maze","activity.tracing","activity.learning-worksheet","quantity.30","advanced.custom-direction"]);
  const publishingKit = activityExpansion.concat(["export.save-project","kit.listing-assets","kit.quality-check","kit.series-builder","kit.launch-checklist"]);
  const agency = publishingKit.concat(["activity.educational-story","activity.matching","activity.counting","activity.simple-math","activity.spot-difference","activity.puzzle","advanced.learning-goal","advanced.guide-character"]);
  for (const plan of allPlans) {
    const starterThemes = THEME_GROUPS.slice(0,2).flatMap(([,items])=>items).map(themeFeatureKey);
    const creatorThemes = THEME_GROUPS.slice(0,4).flatMap(([,items])=>items).map(themeFeatureKey);
    const proThemes = THEME_GROUPS.flatMap(([,items])=>items).map(themeFeatureKey);
    const planName = String(plan.name).toLowerCase();
    const isFrontEnd = planName === "starter" || planName === "front-end";
    const isActivityExpansion = planName === "creator" || planName === "pro oto" || planName === "activity expansion oto";
    const isPublishingKit = planName === "publishing kit oto";
    const keys = isFrontEnd
      ? starter.concat(starterThemes)
      : isActivityExpansion
        ? activityExpansion.concat(creatorThemes)
        : isPublishingKit
          ? publishingKit.concat(proThemes)
          : agency.concat(proThemes);
    setPlanFeatures.run(plan.id);
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
  if (String(input.avoidTerms || "").trim()) keys.push("advanced.custom-direction");
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
- Each page is a real printable word-search puzzle, not an illustration prompt pretending to be a puzzle.
- Each page needs one unique theme subtopic and exactly 10 age-appropriate uppercase words, 3-10 letters each, no spaces, no punctuation.
- content_items must include "WORD LIST: ..." and exactly 12 "GRID ROW NN: ..." entries. Every grid row must be 12 uppercase letters with spaces between letters.
- The answer must list every hidden word with row, column, and direction using H, V, or D. Example: COW: row 2, col 4, direction H.
- Every puzzle must include a mix of directions: at least 3 horizontal, at least 3 vertical, and at least 2 diagonal words.
- The image_prompt must NOT ask an image model to draw the word grid, letters, words, typography, or answer key. It should only describe a printable worksheet frame: small themed border decorations, title-safe area, and one large blank central rectangle where the generated grid will be placed later by layout software.`,
  "educational-story":`EDUCATIONAL STORY CONTRACT
- Build one connected story arc across all prompts: introduction, small challenge, attempts, resolution, and takeaway.
- Keep the same recurring character design, clothing, colors, and personality on every page.
- Each page is one concrete scene, advances the story, and teaches one gentle age-appropriate lesson.
- The image prompt must restate the complete character lock whenever the recurring character appears.`,
  "maze":`MAZE BOOK CONTRACT
- Every maze must have one visible start, one visible goal, a theme-relevant obstacle set, and exactly one intended solution.
- Vary maze silhouettes and scene concepts while keeping paths wide and printable. Use the selected maze layout/style when provided; if it is Mixed Marketplace Variety, rotate through rectangle, circular/ring, triangle/pyramid, object-shaped, house/barn, animal silhouette, and adventure path layouts across the book.
- content_items must include a 9 by 9 maze blueprint using S, G, dot path cells, and hash wall cells, plus an exact solution route.
- The image prompt must ask for a clean maze based on the supplied blueprint, with one continuous open route from START to GOAL and no decorative objects inside paths.`,
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
function promptSceneTheme(theme=""){
  const t=String(theme||"activity").toLowerCase();
  const map=[
    [/scientists?/, "a friendly science laboratory with microscopes, beakers, plants, safety goggles, blank notebooks, and curious young researchers"],
    [/police officers?/, "a friendly community safety scene with helpful officers, traffic cones, a patrol car, a crosswalk, and neighborhood helpers"],
    [/doctors?|nurses?/, "a cheerful clinic scene with child-safe medical tools, caring helpers, a checkup table, and simple health props"],
    [/firefighters?/, "a friendly fire station scene with safety helmets, hoses, a fire truck, boots, and rescue practice props"],
    [/teachers?|school/, "a classroom activity scene with books, backpacks, art supplies, a globe without labels, and smiling learners"],
    [/astronauts?/, "a space explorer scene with astronauts, rockets, planets without labels, stars, control panels without text, and moon rocks"],
    [/ocean|coral|sea/, "an underwater ocean scene with turtles, dolphins, coral, shells, sea plants, bubbles, and friendly fish"],
    [/farm/, "a cheerful farm scene with barns without signs, fences, crops, farm tools, and friendly animals"],
    [/dinosaur/, "a prehistoric nature scene with friendly dinosaurs, large leaves, rocks, volcano shapes, nests, and footprints"],
    [/pets?/, "a cozy pet-care scene with friendly cats, dogs, bowls without labels, toys, cushions, and simple home details"]
  ];
  return map.find(([pattern])=>pattern.test(t))?.[1] || `a detailed child-friendly ${theme} scene with recognizable theme props, charming characters, and simple background details`;
}
function themeElements(theme=""){
  const t=String(theme||"activity").toLowerCase();
  const packs=[
    [/ocean|coral|sea/,["sea turtle","dolphin","clownfish","octopus","seahorse","crab","starfish","whale"],["coral reef","sandy seabed","kelp forest","tide pool","underwater cave"],["shells","bubbles","sea plants","smooth stones","treasure-free chest","waves"]],
    [/safari/,["lion","elephant","giraffe","zebra","rhino","meerkat","cheetah","hippo"],["savanna grassland","watering hole","acacia grove","safari trail","sunny wildlife park"],["tall grass","binoculars","jeep without logos","rocks","bushes","clouds"]],
    [/woodland/,["deer","fox","owl","rabbit","squirrel","hedgehog","raccoon","songbird"],["quiet forest","mushroom grove","leafy trail","hollow log clearing","acorn meadow"],["acorns","mushrooms","fallen leaves","tree stumps","ferns","berries"]],
    [/rainforest/,["monkey","toucan","jaguar","tree frog","sloth","parrot","butterfly","tapir"],["tropical canopy","vine-covered path","rainforest river","giant leaf garden","waterfall clearing"],["vines","ferns","big leaves","orchids","fruit","raindrops"]],
    [/arctic/,["polar bear","penguin","seal","arctic fox","snowy owl","walrus","orca","reindeer"],["snowy ice field","igloo village without signs","frozen shore","aurora sky","iceberg scene"],["snowflakes","ice blocks","mittens","fish","pine trees","sled tracks"]],
    [/dinosaur/,["triceratops","stegosaurus","brachiosaurus","t-rex","ankylosaurus","parasaurolophus","baby dinosaur","pteranodon"],["prehistoric valley","fern forest","volcano landscape","dinosaur nest","rocky river"],["fossils","giant leaves","eggs","rocks","footprints","clouds"]],
    [/insect|butterfl/,["butterfly","bee","ladybug","dragonfly","caterpillar","ant","beetle","grasshopper"],["flower garden","leafy meadow","bug hotel","pond edge","vegetable patch"],["flowers","leaves","honeycomb","mushrooms","dew drops","stems"]],
    [/bird/,["owl","parrot","sparrow","eagle","duck","flamingo","peacock","robin"],["tree branch","nest scene","bird garden","pond shore","forest clearing"],["feathers","eggs","leaves","berries","clouds","flowers"]],
    [/pet/,["puppy","kitten","hamster","rabbit","goldfish","parakeet","turtle","guinea pig"],["cozy pet room","backyard play area","pet care corner","sunny window spot","garden path"],["toys","blank bowls","cushions","paw prints","brushes","blank tags"]],
    [/community helper/,["mail carrier","librarian","crossing guard","bus driver","sanitation worker","park worker","shop helper","community volunteer"],["friendly neighborhood","library corner","crosswalk","bus stop","park path"],["bags without logos","books without text","cones","benches","trees","recycling bins without labels"]],
    [/doctor|nurse/,["doctor","nurse","patient child","clinic helper","dentist","paramedic","care team","health teacher"],["cheerful clinic","checkup room","health corner","waiting area","medical station"],["stethoscope","bandage","blank chart","toy bear","sink","first-aid box without labels"]],
    [/firefighter/,["firefighter","fire truck","rescue dog","helmeted helper","ladder team","hose team","station crew","safety teacher"],["fire station","training yard","truck bay","safe rescue practice scene","neighborhood safety day"],["hose","helmet","boots","ladder","hydrant","cones"]],
    [/police/,["police officer","crossing guard","community helper","patrol car","bike officer","safety team","friendly officer","traffic helper"],["crosswalk","community park","neighborhood street","school safety zone","traffic safety corner"],["cones","badge shapes without text","walkie-talkie","traffic lights","bicycle","blank notebook"]],
    [/teacher|school/,["teacher","student group","reader child","art student","science student","class helper","music student","librarian"],["classroom","reading corner","art table","school garden","library nook"],["books without text","pencils","backpacks","blank board","globe without labels","crayons"]],
    [/construction/,["builder","crane operator","architect child","toolbox helper","dump truck","bulldozer","bricklayer","safety worker"],["construction site","tool shed","road work zone","building frame","materials yard"],["helmet","cones","bricks","tools","crane","wood planks"]],
    [/farmer/,["farmer","tractor driver","garden helper","barn worker","crop picker","animal caretaker","market helper","watering helper"],["crop field","barnyard","vegetable garden","orchard","farm market table"],["tractor","watering can","baskets","hay","fence","blank crates"]],
    [/chef|baker/,["chef","baker","kitchen helper","pastry maker","soup cook","bread maker","cake decorator","apron child"],["cozy kitchen","bakery counter","mixing table","oven corner","picnic prep table"],["mixing bowl","spoon","rolling pin","bread","cupcakes","blank recipe card"]],
    [/scientist/,["young scientist","microscope explorer","plant researcher","crystal observer","lab helper","telescope student","experiment team","goggle-wearing child"],["science laboratory","classroom lab","plant table","crystal station","observation desk"],["microscope","beakers","blank notebooks","goggles","plant samples","magnifying glass"]],
    [/astronaut|space|solar/,["astronaut","rocket explorer","moon rover","space student","planet observer","satellite helper","alien-free explorer","telescope child"],["moon surface","rocket launch pad","space station room","planet trail","starry sky"],["planets without labels","stars","moon rocks","rocket","control panels without text","helmets"]],
    [/weather|season/,["weather watcher","raincoat child","snow helper","sunny day explorer","windy kite flyer","cloud observer","season tree","umbrella child"],["weather station without labels","park path","seasonal garden","rain puddle scene","snowy yard"],["clouds","raindrops","snowflakes","leaves","sun shapes","umbrellas"]],
    [/human body|healthy|safety|routine|habit/,["healthy child","exercise helper","handwashing child","sleepy bedtime helper","safety watcher","toothbrushing child","snack helper","routine chart without text"],["bathroom sink","playground","kitchen table","bedroom corner","clinic classroom"],["toothbrush","soap bubbles","fruit","water bottle","sneakers","blank checklist"]],
    [/plant|garden/,["gardener child","flower helper","seed planter","watering helper","butterfly visitor","vegetable picker","tree planter","sprout observer"],["flower garden","vegetable patch","greenhouse","orchard","potting table"],["watering can","seed packets without text","leaves","pots","tools","butterflies"]],
    [/volcano/,["young geologist","volcano explorer","rock collector","safety observer","mountain hiker","fossil finder","lava watcher","science guide"],["volcano landscape","rocky trail","geology table","mountain valley","safe observation hill"],["rocks","crystals","steam clouds","lava shapes","backpack","magnifying glass"]],
    [/camping/,["camper child","tent helper","trail explorer","lantern carrier","backpack kid","nature observer","map helper","campfire sitter"],["forest campsite","tent area","lake trail","mountain camp","woodland clearing"],["tent","lantern","backpack","logs","stars","blank map"]],
    [/treasure/,["adventurer child","map explorer","compass helper","island walker","cave explorer","clue finder","bridge crosser","chest opener"],["island path","jungle trail","safe cave","sandy beach","wooden bridge"],["compass","map without letters","coins","chest","vines","rocks"]],
    [/alphabet/,["letter explorer","classroom helper","book friend","pencil character","reading child","library helper","alphabet blocks without letters","teacher owl"],["reading corner","classroom table","library nook","book garden","learning rug"],["books without text","pencils","blank cards","blocks without letters","stars","backpacks"]],
    [/number/,["counting child","number explorer","math helper","block stacker","abacus friend","counting animals","shape counter","market helper"],["classroom table","counting corner","toy shelf","market basket","learning rug"],["blocks without printed numbers","beads","apples","stars","blank cards","counters"]],
    [/shape/,["shape explorer","circle friend","square builder","triangle climber","pattern helper","block child","art student","shape sorter"],["art table","classroom rug","block city","playroom","pattern garden"],["circles","squares","triangles","stars","blank cards","crayons"]],
    [/color/,["paint helper","rainbow friend","art student","crayon kid","palette explorer","flower painter","butterfly painter","studio helper"],["art studio","flower garden","classroom table","rainbow meadow","craft corner"],["paintbrushes","blank palette","crayons","flowers","butterflies","jars without labels"]],
    [/opposite/,["big and small pair","up and down scene","open and closed helper","day and night pair","fast and slow racers","happy and sad faces","near and far scene","full and empty baskets"],["learning rug","playground","classroom corner","storybook scene","park path"],["blank cards","baskets","balls","blocks","doors without signs","clouds"]],
    [/emotion|friendship|kindness/,["smiling friend","sharing child","helping buddy","kindness helper","feeling face character","comforting friend","teamwork pair","thank-you helper"],["playground","classroom rug","park bench","story corner","garden path"],["hearts without text","toys","flowers","blank cards","benches","books without words"]],
    [/unicorn|rainbow/,["unicorn","rainbow pony","cloud friend","star helper","magical foal","flower crown unicorn","moon unicorn","meadow unicorn"],["rainbow meadow","cloud garden","starry hill","magical forest","flower field"],["stars","clouds","flowers","sparkles","mushrooms","crescent moon"]],
    [/dragon|castle/,["friendly dragon","castle guard","young knight","princess explorer","tower helper","shield bearer","baby dragon","bridge walker"],["castle courtyard","tower room","dragon meadow","stone bridge","royal garden"],["shields without symbols","flags without marks","stones","flowers","treasure-free chest","clouds"]],
    [/fair/,["fairy","forest sprite","mushroom friend","flower fairy","butterfly helper","wand holder","tiny gardener","moon fairy"],["magical forest","mushroom village","flower meadow","fairy garden","glowing pond"],["mushrooms","flowers","wings","stars","leaves","sparkles"]],
    [/pirate/,["pirate child","ship helper","parrot friend","island explorer","sailor kid","treasure map holder","captain child","anchor helper"],["pirate ship","island beach","dock scene","jungle trail","safe cave"],["anchor","ship wheel","map without text","coins","palm trees","sails"]],
    [/robot/,["friendly robot","gear helper","inventor child","robot pet","workshop bot","space robot","cleaning robot","builder bot"],["robot workshop","gear room","space lab","invention table","city sidewalk"],["gears","bolts","buttons without labels","wires","tools","blank panels"]],
    [/car|truck/,["race car","pickup truck","fire truck toy","delivery van","mechanic child","monster truck","tow truck","family car"],["garage","road scene","car wash","traffic park","repair shop"],["wheels","cones","tools","blank signs","road lines","clouds"]],
    [/train/,["steam train","conductor child","passenger car","freight train","station helper","toy train","mountain train","subway-style train"],["train station","railroad track","bridge crossing","mountain railway","platform without signs"],["tracks","wheels","clouds","suitcases","signals without text","trees"]],
    [/airplane/,["airplane","pilot child","airport helper","cloud flyer","hangar mechanic","paper plane friend","helicopter","runway crew"],["runway","airport hangar","cloud sky","control tower without text","travel scene"],["clouds","wings","luggage without labels","cones","tools","stars"]],
    [/christmas/,["holiday tree","gift helper","snow child","stocking friend","gingerbread baker","reindeer","snowman","ornament maker"],["cozy living room","snowy yard","holiday kitchen","tree corner","winter street"],["gifts","ornaments","snowflakes","stockings","cookies","stars"]],
    [/halloween/,["pumpkin friend","costume child","friendly ghost","bat buddy","candy helper","black cat","witch hat character","spooky tree"],["pumpkin patch","costume party","friendly haunted yard","moonlit path","candy table"],["pumpkins","bats","candy","leaves","lanterns","stars"]]
  ];
  const found=packs.find(([pattern])=>pattern.test(t));
  if(found)return {subjects:found[1],settings:found[2],props:found[3]};
  return {subjects:[`${theme} explorer`,`${theme} helper`,`${theme} friend`,`${theme} scene`,`${theme} character`],settings:[promptSceneTheme(theme),"activity corner","storybook setting","playful learning scene","outdoor scene"],props:["simple props","background details","decorative shapes","open spaces","friendly objects","nature details"]};
}
function buildScenePoolFromElements(elements){
  return Array.from({length:25},(_,index)=>{
    const subject=elements.subjects[index%elements.subjects.length];
    const setting=elements.settings[Math.floor(index/elements.subjects.length)%elements.settings.length];
    const p1=elements.props[index%elements.props.length];
    const p2=elements.props[(index+2)%elements.props.length];
    const p3=elements.props[(index+4)%elements.props.length];
    return `${subject} in a ${setting} with ${p1}, ${p2}, ${p3}, clear foreground shapes, and child-friendly background details`;
  });
}
function themeScenePool(theme=""){
  const t=String(theme||"activity").toLowerCase();
  if(/farm/.test(t))return [
    "a gentle cow standing beside a wooden barn, hay bales, a milk pail, fence posts, grass tufts, and a sunny farmyard",
    "three fluffy sheep grazing in a pasture with rolling hills, a small gate, wildflowers, clouds, and a distant barn",
    "a cheerful pig in a clean straw pen with a trough, mud puddle shapes, fence rails, apples, and farm buckets",
    "a chicken coop scene with hens, chicks, nesting boxes, corn kernels, a water dish, and a rooster on a fence",
    "a friendly horse looking over a stable door with horseshoes, hay bundles, saddle blankets, carrots, and barn beams",
    "ducks swimming in a small farm pond with reeds, lily pads, ducklings, stones, and a wooden footbridge",
    "a curious goat standing near a fence with tin cans, grass, a small shed, climbing rocks, and leafy branches",
    "a farm dog watching over animals near a gate with paw prints, a feed sack without labels, and a wagon wheel",
    "a farm cat sleeping on hay beside a lantern, pumpkins, baskets, barn planks, and tiny mice peeking out",
    "a donkey carrying flower baskets along a farm path with fence rails, shrubs, and a farmhouse in the distance",
    "a tractor parked beside hay bales with chickens nearby, tire tracks, crates, farm tools, and open sky",
    "a market basket scene with eggs, carrots, apples, corn, a watering can, and small farm animals around it",
    "a baby calf nuzzling its mother near a barn door with straw, buckets, butterflies, and soft pasture details",
    "a lamb jumping over a small log in a meadow with daisies, fence posts, clouds, and a woolly sheep family",
    "piglets playing around a clean wooden trough with straw piles, round stones, simple flowers, and a low fence",
    "a rooster greeting the morning beside a chicken coop with hens, chicks, corn stalks, and sunrise shapes",
    "a pony in a paddock with a brush, apple basket, fence, stable window, horseshoe decoration, and grass patches",
    "geese walking in a line near a pond with reeds, footprints, a small bridge, and farmyard plants",
    "goats climbing on wooden platforms inside a safe farm play yard with buckets, leaves, and a small shelter",
    "a farmer child feeding animals with a bucket, surrounded by cow, sheep, chicken, and goat in a tidy barnyard",
    "a barn interior with animal stalls, hayloft ladder, feed buckets, friendly animals peeking out, and clean open spaces",
    "a vegetable garden beside the animal barn with rabbits, chickens, watering can, carrots, leafy plants, and fence rails",
    "a farmyard parade with cow, horse, sheep, pig, duck, and chicken walking along a dirt path",
    "a cozy nighttime barn scene with sleeping animals, moon visible through a window, hay piles, and quiet farm details",
    "a spring farm scene with baby animals, flowers, butterflies, fresh grass, and a welcoming barn gate"
  ];
  return buildScenePoolFromElements(themeElements(theme));
}
function sceneTitle(theme,scene,pageNumber){
  const t=String(theme||"Activity");
  if(/farm/i.test(t)){
    const names=[
      "Cow at the Barn","Sheep in the Pasture","Pig in the Straw Pen","Chicken Coop Friends","Horse at the Stable",
      "Ducks at the Pond","Goat by the Fence","Farm Dog Helper","Cat in the Hay","Donkey on the Farm Path",
      "Tractor and Hay Bales","Farm Market Basket","Baby Calf and Mother","Jumping Lamb","Playful Piglets",
      "Rooster Morning","Pony Paddock","Geese by the Pond","Goat Play Yard","Feeding Time",
      "Inside the Barn","Garden by the Barn","Farmyard Parade","Nighttime Barn","Spring Baby Animals"
    ];
    return `${t}: ${names[(pageNumber-1)%names.length]}`;
  }
  const titleWords=String(scene||"").split(/\s+/).filter(word=>!/^(a|an|the|with|and|in|on|near|beside|inside|around|of|to|for|its|clear|foreground|shapes|child-friendly|background|details)$/i.test(word)).slice(0,7).join(" ");
  return `${t}: ${titleWords.replace(/[^\w\s-]/g,"").replace(/\b\w/g,c=>c.toUpperCase())}`;
}
function cleanWord(value=""){
  return String(value).toUpperCase().replace(/[^A-Z]/g,"").slice(0,10);
}
function wordBank(theme=""){
  const t=String(theme).toLowerCase();
  if(/farm/.test(t))return ["COW","SHEEP","PIG","HORSE","GOAT","DUCK","CHICKEN","ROOSTER","BARN","TRACTOR","HAY","CALF","LAMB","PONY","FENCE","EGGS","FARMER","STABLE","PASTURE","GARDEN"];
  if(/ocean|coral|sea/.test(t))return ["DOLPHIN","TURTLE","WHALE","SHARK","OCTOPUS","CRAB","CORAL","REEF","SHELL","SEAL","FISH","WAVE","KELP","SQUID","LOBSTER","SEAHORSE"];
  if(/safari/.test(t))return ["LION","ZEBRA","GIRAFFE","ELEPHANT","RHINO","HIPPO","CHEETAH","GAZELLE","MONKEY","SAVANNA","ACACIA","LEOPARD"];
  if(/space|astronaut|solar/.test(t))return ["ROCKET","PLANET","MOON","STAR","COMET","ORBIT","ASTRO","MARS","VENUS","SATURN","GALAXY","METEOR"];
  if(/dinosaur/.test(t))return ["DINOSAUR","TREX","RAPTOR","FOSSIL","EGG","JURASSIC","STEGOSAUR","TRICERA","VOLCANO","BONES","TAIL","CLAW"];
  const pieces=themeElements(theme);
  return [...pieces.subjects,...pieces.settings,...pieces.props,theme].map(cleanWord).filter(word=>word.length>=3);
}
function buildWordSearchPuzzle(theme,pageNumber){
  const size=12;
  const pool=[...new Set(wordBank(theme))].filter(word=>word.length>=3&&word.length<=10);
  const orderedPool=Array.from({length:pool.length},(_,i)=>pool[(pageNumber+i-1)%pool.length]).sort((a,b)=>b.length-a.length);
  const grid=Array.from({length:size},()=>Array(size).fill(""));
  const placements=[];
  const directions=[
    {code:"H",dr:0,dc:1},
    {code:"V",dr:1,dc:0},
    {code:"D",dr:1,dc:1}
  ];
  const slotPlan=[
    {code:"D",row:0,col:0},{code:"D",row:0,col:4},{code:"D",row:2,col:0},
    {code:"V",row:0,col:11},{code:"V",row:3,col:10},{code:"V",row:5,col:8},
    {code:"H",row:10,col:0},{code:"H",row:11,col:1},{code:"H",row:8,col:0},{code:"H",row:6,col:0}
  ];
  const canPlace=(word,row,col,dir)=>[...word].every((letter,index)=>{
    const r=row+dir.dr*index,c=col+dir.dc*index;
    return r<size&&c<size&&(!grid[r][c]||grid[r][c]===letter);
  });
  const placeWord=(word,index,slot=slotPlan[index%slotPlan.length])=>{
    const preferred=directions.find(dir=>dir.code===slot.code)||directions[0];
    const attempts=[{dir:preferred,row:slot.row,col:slot.col},...Array.from({length:144},(_,attempt)=>({dir:preferred,attempt}))];
    for(const option of attempts){
      const dir=option.dir;
      if(option.row!=null&&option.col!=null){
        if(!canPlace(word,option.row,option.col,dir))continue;
        [...word].forEach((letter,i)=>{grid[option.row+dir.dr*i][option.col+dir.dc*i]=letter});
        placements.push({word,answer:`${word}: row ${option.row+1}, col ${option.col+1}, direction ${dir.code}`});
        return true;
      }
      const attempt=option.attempt;
      const maxRow=size-(dir.dr?(word.length):1);
      const maxCol=size-(dir.dc?(word.length):1);
      const row=(index*3+attempt*2+pageNumber)%Math.max(1,maxRow+1);
      const col=(index*5+attempt+pageNumber)%Math.max(1,maxCol+1);
      if(!canPlace(word,row,col,dir))continue;
      [...word].forEach((letter,i)=>{grid[row+dir.dr*i][col+dir.dc*i]=letter});
      placements.push({word,answer:`${word}: row ${row+1}, col ${col+1}, direction ${dir.code}`});
      return true;
    }
    return false;
  };
  for(let slot=0;slot<10;slot++){
    const candidates=slotPlan[slot].code==="D"?[...orderedPool].sort((a,b)=>a.length-b.length):orderedPool;
    for(const word of candidates){
      if(placements.some(item=>item.word===word))continue;
      if(placeWord(word,slot,slotPlan[slot]))break;
    }
  }
  let fillerIndex=1;
  while(placements.length<10){
    const word=`WORD${fillerIndex++}`;
    placeWord(word,placements.length,slotPlan[placements.length]);
  }
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for(let r=0;r<size;r++)for(let c=0;c<size;c++)if(!grid[r][c])grid[r][c]=alphabet[(r*7+c*11+pageNumber)%alphabet.length];
  return {
    words:placements.map(item=>item.word),
    rows:grid.map(row=>row.join(" ")),
    answers:placements.map(item=>item.answer)
  };
}
function mazeStoryPair(theme,pageNumber){
  const t=String(theme||"").toLowerCase();
  const farm=[
    ["baby cow","barn"],["puppy","bone"],["bunny","carrot"],["chicken","baby chicks"],["kitten","milk bowl"],
    ["duckling","pond"],["goat","hay stack"],["pony","stable"],["piglet","mud puddle"],["lamb","pasture gate"]
  ];
  const ocean=[
    ["baby dolphin","family pod"],["sea turtle","pond-like lagoon"],["jellyfish","octopus friend"],["baby fish","aquarium"],
    ["crab","shell home"],["seahorse","coral garden"],["penguin","iceberg"],["seal pup","safe rock"]
  ];
  const safari=[
    ["baby lion","family"],["monkey","banana"],["baby hippo","friend"],["zebra","watering hole"],["giraffe","leafy tree"]
  ];
  const space=[
    ["rocket","moon"],["alien spaceship","planet Earth"],["astronaut","space station"],["comet","star field"],["rover","Mars base"]
  ];
  const adventure=[
    ["pirate parrot","pirate ship"],["sailor boy","ship"],["train","station"],["boat","island"],["child explorer","treasure chest"]
  ];
  let pairs=farm;
  if(/ocean|sea|coral|arctic|penguin/.test(t))pairs=ocean;
  else if(/safari|lion|zebra|giraffe|hippo/.test(t))pairs=safari;
  else if(/space|astronaut|solar|rocket|alien/.test(t))pairs=space;
  else if(/pirate|treasure|train|boat|airplane|car|truck|camping/.test(t))pairs=adventure;
  const [start,goal]=pairs[(pageNumber-1)%pairs.length];
  return {start,goal,mission:`Help the ${start} find the ${goal}`};
}
function mazeLayoutSpec(input,pageNumber){
  const requested=MAZE_LAYOUT_TYPES.includes(input.mazeLayout)?input.mazeLayout:"Mixed Marketplace Variety";
  const rotation=MAZE_LAYOUT_TYPES.filter(item=>item!=="Mixed Marketplace Variety");
  const layout=requested==="Mixed Marketplace Variety"?rotation[(pageNumber-1)%rotation.length]:requested;
  const shapeMap={
    "Classic Rectangle Maze":"large rectangular maze block with straight corridors and a thick outer border",
    "Circular Ring Maze":"round concentric ring maze with curved corridor bands and radial openings",
    "Triangle Pyramid Maze":"triangle or pyramid-shaped maze with straight corridor segments inside the triangular outline",
    "Object-Shaped Maze":"theme-object silhouette maze, such as an apple, carrot, shell, rocket, leaf, or gift shape",
    "House or Barn Maze":"house or barn-shaped maze with a roof outline, simple doorway shape, and rectangular lower body",
    "Animal Silhouette Maze":"simple animal silhouette maze with a clear child-friendly outline, such as cow, bunny, fish, bird, or dinosaur",
    "Adventure Path Maze":"open journey-style maze path with arrows entering and exiting from different page edges"
  };
  return {layout,shape:shapeMap[layout]||shapeMap["Classic Rectangle Maze"]};
}
function buildMazePuzzle(theme,pageNumber,input={}){
  const mazeFromPath=(path)=>{
    const grid=Array.from({length:9},()=>Array(9).fill("#"));
    path.forEach(([row,col],index)=>{
      grid[row][col]=index===0 ? "S" : index===path.length-1 ? "G" : ".";
    });
    const route=path.slice(1).map(([row,col],index)=>{
      const [prevRow,prevCol]=path[index];
      if(row===prevRow&&col===prevCol+1)return "R";
      if(row===prevRow&&col===prevCol-1)return "L";
      if(row===prevRow+1&&col===prevCol)return "D";
      if(row===prevRow-1&&col===prevCol)return "U";
      return "?";
    }).join(", ");
    return {rows:grid.map(row=>row.join("")),route};
  };
  const variants=[
    mazeFromPath([[0,0],[0,1],[0,2],[1,2],[2,2],[2,3],[2,4],[3,4],[4,4],[4,3],[4,2],[4,1],[5,1],[6,1],[6,2],[6,3],[6,4],[6,5],[6,6],[7,6],[8,6],[8,7],[8,8]]),
    mazeFromPath([[0,0],[1,0],[2,0],[2,1],[2,2],[1,2],[0,2],[0,3],[0,4],[1,4],[2,4],[3,4],[4,4],[4,5],[4,6],[5,6],[6,6],[6,5],[6,4],[7,4],[8,4],[8,5],[8,6],[8,7],[8,8]]),
    mazeFromPath([[0,0],[0,1],[1,1],[2,1],[3,1],[3,2],[3,3],[2,3],[1,3],[1,4],[1,5],[2,5],[3,5],[4,5],[5,5],[5,4],[5,3],[6,3],[7,3],[7,4],[7,5],[7,6],[7,7],[8,7],[8,8]])
  ];
  const maze=variants[(pageNumber-1)%variants.length];
  const story=mazeStoryPair(theme,pageNumber);
  const layout=mazeLayoutSpec(input,pageNumber);
  return {
    rows:maze.rows,
    route:maze.route,
    layout:layout.layout,
    shape:layout.shape,
    start:story.start,
    goal:story.goal,
    mission:story.mission,
    legend:"S = start, G = goal, . = open path, # = wall"
  };
}
function visualContract(input){
  input.size = "A4";
  const avoid=String(input.avoidTerms||"").trim();
  const characterLock=input.guideCharacter
    ? `Recurring character lock: ${input.guideCharacter}; keep the same species/person, age, face, body proportions, clothing, colors, accessories, and personality across every prompt`
    : "Character consistency lock: whenever a character recurs, repeat the same species/person, age, face, body proportions, clothing, colors, and accessories";
  const userAvoid=avoid ? `, avoid these user-specified elements: ${avoid}` : "";
  return {
    styleAnchor:`${input.style}, consistent child-friendly visual language`,
    themeDirection:themeVisualDirection(input.theme||input.topic),
    characterLock,
    layoutLock:`one standalone A4 portrait printable page, clear focal hierarchy, clean margins, safe trim area, no cropped important objects`,
    negativeLock:input.activityType==="coloring"
      ? `black-and-white line art only, no color, no grayscale, no shading, no gradients, no shadows, no textures, no title, no words, no letters, no numbers, no labels, no captions, no signage, no watermark, no logo, no border, no photorealism, no 3D render${userAvoid}`
      : `no watermark, no logo, no brand characters, no photorealism, no 3D render, no malformed anatomy, no clutter, no cropped important objects, no illegible embedded text${userAvoid}`
  };
}
function lockImagePrompt(prompt,input){
  const c=visualContract(input);
  let scene=String(prompt||"").trim().replace(/[.\s]+$/,"");
  if(input.activityType==="word-search"){
    return `Create a clean printable word-search worksheet frame for children, vertical A4 portrait composition.

Scene decoration: ${scene}. Use only small ${input.theme || input.topic} themed border illustrations in the corners and margins, with a large blank central rectangle reserved for a word-search grid that will be added later by layout software.

Layout requirements: clear title-safe area at the top, word-list area below or beside the blank grid space, generous margins, simple child-friendly decorative icons, balanced worksheet composition, no busy background behind the puzzle area.

Critical text rule: do not render any letters, words, puzzle grid, answer key, labels, captions, signage, typography, watermark, logo, or random symbols anywhere in the image.

Negative prompt: letters, words, text, typography, alphabet, numbers, grid letters, word search grid, answer key, labels, captions, signs, watermark, logo, clutter, cropped layout, photorealism, 3D render.`;
  }
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
    if(input.activityType==="coloring"&&book.pages?.some(p=>/\bfull[- ]color\b|\btitle-safe\b|\btypography\b/i.test(String(p.image_prompt||"").split(/Critical text rule:|Negative prompt:/i)[0])))warnings.push("Some coloring page prompts may mention color or typography; review before image generation.");
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
function removePageCountWarnings(book){
  if(!book?.quality_check?.warnings)return book;
  book.quality_check.warnings=book.quality_check.warnings.filter(warning=>!/page count does not match/i.test(String(warning)));
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
- User book idea / niche: ${input.bookIdea || "not provided; infer a strong marketplace-friendly angle from the selected theme"}
- Special direction: ${input.customDirection || "not provided"}
- Exclude / avoid: ${input.avoidTerms || "not provided"}
- Age group: ${input.age}
- Content language: ${input.language}
- Product/activity type: ${input.activityType}
- Type / genre direction: ${input.genreType || input.difficulty || "Classic Educational"}
- Maze layout/style: ${input.activityType==="maze" ? input.mazeLayout : "not applicable"}
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
16. Respect the user book idea as a niche direction, but keep every page anchored to the selected theme and activity type.
17. Respect special direction and exclude/avoid constraints unless they conflict with child safety or printable quality.
18. Translate the requested illustration style into English inside image prompts. Do not put non-English style phrases in image prompts.
19. Every image prompt must explicitly describe subjects, action, expression, clothing/costumes if relevant, props, background, composition, printable A4 portrait layout, and the selected type/genre direction.
20. Do not use copyrighted characters, brands, logos, or trademarks.
21. Do not claim that generated images are automatically KDP-ready.
22. Every title and concept must be different from the titles already used in earlier batches.
23. Return only JSON matching the supplied schema.`;
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
    book.pages=book.pages.slice(0,batchCount).map((page,index)=>{
      const pageNumber=startPage+index;
      if(input.activityType==="maze")return fallbackPage(input,pageNumber);
      return {
        ...page,
        page_number:pageNumber,
        activity_type:input.activityType,
        image_prompt:lockImagePrompt(page.image_prompt,input)
      };
    });
    book.cover_prompt=lockCoverPrompt(book.cover_prompt,input);
    ensurePublishingKit(book,input);
    if(book.pages.length!==batchCount)throw new Error("The content engine did not create every requested prompt. Please try again.");
    return {book,metrics:{totalDuration:result.total_duration,evalCount:result.eval_count}};
  } finally { clearTimeout(timeout); }
}
function fallbackPage(input,pageNumber){
  const theme=input.theme||input.topic||"Activity";
  const activity=String(input.activityType||"activity").replace(/-/g," ");
  const scenePool=themeScenePool(theme);
  const baseScene=scenePool[(pageNumber-1)%scenePool.length];
  const idea=String(input.bookIdea||"").trim();
  const direction=String(input.customDirection||"").trim();
  const avoid=String(input.avoidTerms||"").trim();
  const avoidLine=avoid?` Also avoid these user-specified elements: ${avoid}.`:"";
  const sceneSeed=[baseScene,idea?`niche angle: ${idea}`:"",direction?`special direction: ${direction}`:""].filter(Boolean).join("; ");
  const title=sceneTitle(theme,baseScene,pageNumber);
  const coloringPrompt=`Create a premium black-and-white coloring book illustration for children, vertical A4 portrait composition.\n\nScene: ${sceneSeed}. Make the page feel like a polished commercial coloring book interior, not a worksheet and not a poster. Use one clear focal scene with balanced composition, charming child-safe characters or objects, expressive faces where relevant, recognizable props, and plenty of fun details for coloring.${avoidLine}\n\nLine art requirements: crisp clean black outlines, smooth confident strokes, closed shapes, large colorable areas, moderate detail, uncluttered spacing, white background, no filled black areas except tiny pupils if needed, no gray shading, no crosshatching, no gradients, no textures, no screen tones.\n\nCritical text rule: do not include any title, heading, caption, label, signage, alphabet letters, numbers, speech bubbles, random symbols, or readable/unreadable text anywhere in the image.\n\nNegative prompt: text, words, letters, numbers, typography, title, subtitle, captions, labels, signs, watermark, logo, border, frame, color, grayscale, shading, gradients, shadows, photorealism, 3D render, messy anatomy, extra fingers, cropped subjects, clutter${avoid?`, ${avoid}`:""}.`;
  const commonPrompt=input.activityType==="coloring"
    ? coloringPrompt
    : `Create a clean ${input.style || "children's educational workbook illustration"} page for children, vertical A4 portrait composition. Scene: ${theme} ${activity} page ${pageNumber}; ${sceneSeed}. Include clear child-friendly subjects, balanced spacing, safe margins, readable silhouettes, and printable layout. Include theme-specific props and simple visual hierarchy. Avoid random text, fake labels, watermarks, logos, clutter, cropped important objects${avoid?`, ${avoid}`:""}.`;
  const base={page_number:pageNumber,activity_type:input.activityType,title,instruction:`Color the ${theme.toLowerCase()} scene with care and notice the farm details.`,learning_goal:"Observation, vocabulary, focus, and age-appropriate problem solving.",content_items:[sceneSeed,`${activity} task`,`${input.age} friendly layout`],image_prompt:commonPrompt,answer:"Answers may vary when the page is creative; review the finished artwork for clarity."};
  if(input.activityType==="word-search"){
    const puzzle=buildWordSearchPuzzle(theme,pageNumber);
    const imagePrompt=`Create a clean printable word-search worksheet frame for children, vertical A4 portrait composition. Use small ${theme} themed border decorations in the corners and margins, with a large blank central rectangle reserved for a 12 by 12 word-search grid that will be added later by layout software. Include a small blank word-list area below the grid, generous white space, simple child-friendly icons, and a polished workbook feel. Do not render any letters, words, puzzle grid, answer key, labels, captions, signage, typography, watermark, logo, or random symbols anywhere in the image.`;
    return {
      ...base,
      title:`${theme}: Word Search ${pageNumber}`,
      instruction:`Find the 10 hidden ${theme.toLowerCase()} words in the 12 by 12 grid. Words may go across, down, or diagonal.`,
      learning_goal:"Theme vocabulary, visual scanning, spelling, and focus.",
      content_items:[`WORD LIST: ${puzzle.words.join(", ")}`,...puzzle.rows.map((row,index)=>`GRID ROW ${String(index+1).padStart(2,"0")}: ${row}`)],
      image_prompt:imagePrompt,
      answer:`ANSWER KEY: ${puzzle.answers.join("; ")}.`
    };
  }
  if(input.activityType==="matching"){
    const words=[...new Set(wordBank(theme))].slice(pageNumber%5,pageNumber%5+6);
    const pairs=words.map(word=>`${word} -> ${word.toLowerCase()} picture`);
    const right=[...words].reverse().map(word=>`${word.toLowerCase()} picture`);
    return {...base,title:`${theme}: Matching Set ${pageNumber}`,instruction:`Draw a line from each ${theme.toLowerCase()} word to its matching picture.`,learning_goal:"Theme vocabulary, visual discrimination, and matching skills.",content_items:[`LEFT COLUMN: ${words.join(", ")}`,`RIGHT COLUMN DISPLAY ORDER: ${right.join(", ")}`,`PAIRS: ${pairs.join("; ")}`],image_prompt:`Create a clean printable matching worksheet frame for children, vertical A4 portrait composition. Use small ${theme} themed decorative icons around the margins and leave two large blank columns for text and picture cards that will be added later by layout software. Keep the center open for connecting lines. Do not render words, letters, labels, numbers, answer keys, watermark, logo, or random symbols.`,answer:`Correct matches: ${pairs.join("; ")}.`};
  }
  if(input.activityType==="counting"){
    const words=[...new Set(wordBank(theme))];
    const item=words[(pageNumber-1)%words.length]||"OBJECT";
    const qty=3+((pageNumber-1)%8);
    return {...base,title:`${theme}: Count ${item} ${pageNumber}`,instruction:`Count the ${item.toLowerCase()} objects and write the number.`,learning_goal:"Counting accuracy, one-to-one correspondence, and theme vocabulary.",content_items:[`COUNTING OBJECT: ${item}`,`EXACT QUANTITY: ${qty}`,`DISPLAY RULE: show ${qty} separate, fully visible ${item.toLowerCase()} objects with no overlaps`],image_prompt:`Create a clean printable counting worksheet scene for children, vertical A4 portrait composition. Show exactly ${qty} separate, fully visible ${item.toLowerCase()} objects in a simple ${theme} setting, with generous spacing and one blank answer box. Use child-friendly line art or workbook illustration styling. Do not render numerals, written labels, captions, watermark, logo, or random text.`,answer:`Answer: ${qty}.`};
  }
  if(input.activityType==="simple-math"){
    const a=2+((pageNumber*2)%9),b=1+(pageNumber%7);
    const op=pageNumber%3===0?"-":"+";
    const left=op==="-"?Math.max(a,b):a;
    const right=op==="-"?Math.min(a,b):b;
    const result=op==="+"?left+right:left-right;
    return {...base,title:`${theme}: Math Practice ${pageNumber}`,instruction:`Solve the ${theme.toLowerCase()} math problem, then check your answer.`,learning_goal:"Basic arithmetic, number sense, and problem solving.",content_items:[`PROBLEM: ${left} ${op} ${right} = ____`,`VISUAL MANIPULATIVES: ${left} ${theme.toLowerCase()} counters and ${right} more/removed counters`,`OPERATION: ${op==="+"?"addition":"subtraction"}`],image_prompt:`Create a clean printable math worksheet frame for children, vertical A4 portrait composition. Use small ${theme} themed counters and simple decorative margin elements, with a large blank problem area and answer box that will be filled by layout software. Do not render arithmetic symbols, numerals, letters, labels, captions, watermark, logo, or random text.`,answer:`Answer: ${result}.`};
  }
  if(input.activityType==="spot-difference"){
    const differences=["one extra cloud","missing small flower","different tail position","one object turned sideways","extra pebble near the path","different window shape"];
    return {...base,title:`${theme}: Spot Differences ${pageNumber}`,instruction:`Look at the two ${theme.toLowerCase()} scenes and find all 6 differences.`,learning_goal:"Observation, attention to detail, comparison, and visual memory.",content_items:[`PANEL A: ${baseScene}`,`PANEL B: same scene with exactly these differences`,...differences.map((item,index)=>`DIFFERENCE ${index+1}: ${item}`)],image_prompt:`Create a printable spot-the-difference worksheet layout for children, vertical A4 portrait composition. Show two side-by-side ${theme} scene panels with identical camera angle, matching character placement, and clear simple details. Include exactly these visual changes between panels: ${differences.join(", ")}. Do not render labels, captions, letters, numbers, watermark, logo, or random text.`,answer:`Differences: ${differences.join("; ")}.`};
  }
  if(input.activityType==="puzzle"){
    const words=[...new Set(wordBank(theme))].slice(0,4);
    const oddChoices=["PENCIL","SHOE","CHAIR","BUTTON","UMBRELLA"];
    const odd=oddChoices[(pageNumber-1)%oddChoices.length];
    return {...base,title:`${theme}: Odd One Out ${pageNumber}`,instruction:`Circle the item that does not belong, then explain why.`,learning_goal:"Classification, reasoning, theme vocabulary, and critical thinking.",content_items:[`PUZZLE MECHANIC: Odd one out`,`CHOICES: ${words.join(", ")}, ${odd}`,`CORRECT ANSWER: ${odd}`,`REASON: the other choices are ${theme.toLowerCase()} vocabulary items, while ${odd.toLowerCase()} is not part of this theme set`],image_prompt:`Create a clean printable children's puzzle worksheet frame, vertical A4 portrait composition. Use small ${theme} themed border decorations and leave four blank choice cards plus one answer circle area for layout software. Keep the composition simple and uncluttered. Do not render words, letters, numbers, labels, captions, watermark, logo, or random symbols.`,answer:`Answer: ${odd} is the odd one out.`};
  }
  if(input.activityType==="learning-worksheet"){
    const words=[...new Set(wordBank(theme))].slice(0,3);
    return {...base,title:`${theme}: Worksheet ${pageNumber}`,instruction:`Complete the ${theme.toLowerCase()} vocabulary activities.`,learning_goal:"Vocabulary recognition, categorization, early writing, and comprehension.",content_items:[`TASK 1: Circle the ${words[0]} picture`,`TASK 2: Match ${words[1]} to its picture`,`TASK 3: Draw one ${words[2]} in the blank box`,`ANSWER 1: ${words[0]}`,`ANSWER 2: ${words[1]} matches its picture`,`ANSWER 3: drawing should clearly show ${words[2]}`],image_prompt:`Create a clean printable educational worksheet frame for children, vertical A4 portrait composition. Use small ${theme} themed decorations around the margins, three clear blank task sections, one drawing box, and generous writing space. Do not render exact words, letters, answers, labels, captions, watermark, logo, or random text.`,answer:`Answers: ${words[0]}; ${words[1]} matches its picture; drawing should show ${words[2]}.`};
  }
  if(input.activityType==="educational-story"){
    return {...base,title:`${theme}: Story Scene ${pageNumber}`,instruction:`Read the short scene and discuss the gentle lesson.`,learning_goal:"Reading comprehension, sequencing, empathy, and theme vocabulary.",content_items:[`STORY SCENE: A friendly guide explores ${baseScene}`,`PLOT ROLE: ${pageNumber===1?"opening":pageNumber<input.pageCount?"middle adventure":"gentle conclusion"}`,`TAKEAWAY: notice details, ask questions, and help a friend`],image_prompt:`Create a warm children's storybook illustration, vertical A4 portrait composition. Scene: a friendly recurring child guide explores ${baseScene}. Keep expressions gentle, composition clear, and details age-appropriate. Include rich ${theme} atmosphere, but do not render readable text, labels, signage, watermark, logo, or random symbols.`,answer:"Takeaway: notice details, ask kind questions, and help when a friend needs support."};
  }
  if(input.activityType==="tracing"){
    const words=[...new Set(wordBank(theme))].slice(0,3);
    return {...base,title:`${theme}: Trace Set ${pageNumber}`,instruction:`Trace the ${theme.toLowerCase()} vocabulary words, then write each word once on your own.`,learning_goal:"Letter formation, handwriting confidence, and theme vocabulary.",content_items:[`TRACE WORD 1: ${words[0]}`,`TRACE WORD 2: ${words[1]}`,`TRACE WORD 3: ${words[2]}`,`WRITING SPACE: one blank line after each word`],image_prompt:`Create a clean printable handwriting worksheet frame for children, vertical A4 portrait composition. Use small ${theme} themed decorations around the margins and leave three wide blank tracing rows plus independent writing lines for layout software. Do not render letters, dotted words, labels, captions, watermark, logo, or random text.`,answer:"Tracing is complete when each word is followed on the dotted guide and rewritten clearly on the blank line."};
  }
  if(input.activityType==="maze"){
    const maze=buildMazePuzzle(theme,pageNumber,input);
    return {...base,title:`${theme}: ${maze.layout} ${pageNumber}`,instruction:`${maze.mission} by moving from START to GOAL.`,learning_goal:"Planning, fine motor control, visual tracking, and problem solving.",content_items:[`MAZE LAYOUT: ${maze.layout}`,`MAZE SHAPE: ${maze.shape}`,"MAZE SIZE: 9 by 9 cells",maze.legend,...maze.rows.map((row,index)=>`MAZE ROW ${String(index+1).padStart(2,"0")}: ${row}`),`START CHARACTER: ${maze.start}`,`GOAL OBJECT: ${maze.goal}`,"START: S cell in the top-left area","GOAL: G cell in the bottom-right area",`SOLUTION ROUTE: ${maze.route}`],image_prompt:`Create a printable children's maze worksheet, vertical A4 portrait composition, inspired by bestselling kids maze activity books. Layout style: ${maze.layout}. Shape requirement: ${maze.shape}. Mission: ${maze.mission}. Build a clean 9 by 9 maze based on this exact topology blueprint: ${maze.rows.join(" / ")}. Translate the topology into the selected visual shape while keeping one continuous open route from start to goal following this solution: ${maze.route}. Use wide white corridors, thick simple black maze walls, one colorful arrow at the entrance, one colorful arrow at the exit, a small ${maze.start} icon near the start, and a small ${maze.goal} icon near the goal. Add small ${theme} themed decorations outside the maze border only. Leave blank Name and Date lines at the top, but do not render any other readable text. Do not place decorative objects inside paths. Do not create blocked exits, disconnected corridors, extra starts, extra goals, labels, captions, watermark, logo, or random text.`,answer:`Solution route: ${maze.route}.`};
  }
  return base;
}
function generateFallbackBook(input,reason=""){
  const theme=input.theme||input.topic||"Activity";
  const activity=String(input.activityType||"activity").replace(/-/g," ");
  const idea=String(input.bookIdea||"").trim();
  const pages=Array.from({length:input.pageCount},(_,index)=>fallbackPage(input,index+1));
  const book={
    book_title:`${idea ? idea.replace(/\b\w/g,c=>c.toUpperCase()).slice(0,55) : `${theme} ${activity.replace(/\b\w/g,c=>c.toUpperCase())}`} Kit`,
    subtitle:`Printable ${activity} pages for ${input.age}`,
    description:`A quick product kit for ${idea||`${theme} ${activity} pages`} with instructions, answer guidance, cover direction, listing assets, and a launch checklist.`,
    cover_prompt:lockCoverPrompt(`A polished ${idea||`${theme} ${activity} activity book`} cover with friendly child-safe visuals, clear title-safe space, and marketplace-ready composition`,input),
    keywords:[theme,idea,`${theme} ${activity}`,`${activity} book`,"printable activity","kids workbook","KDP interior","Etsy printable","learning pages"].filter(Boolean),
    pages
  };
  ensurePublishingKit(book,input);
  const promptTexts=pages.map(p=>`${p.title} ${p.instruction} ${p.content_items?.join(" ")} ${p.image_prompt}`.toLowerCase());
  const themeKey=String(input.theme||"").toLowerCase();
  if(/farm/.test(themeKey)){
    const farmTerms=/farm|barn|cow|sheep|pig|chicken|horse|duck|goat|tractor|hay|pasture|stable|coop|pond|fence|calf|lamb|rooster|geese|vegetable|animal/;
    const weakPages=promptTexts.map((text,index)=>farmTerms.test(text)?null:index+1).filter(Boolean);
    if(weakPages.length)book.quality_check.warnings.unshift(`Theme coverage warning: pages ${weakPages.join(", ")} may not clearly reference farm animals.`);
  }
  const duplicateTitles=pages.map(p=>p.title).filter((title,index,arr)=>arr.indexOf(title)!==index);
  if(duplicateTitles.length)book.quality_check.warnings.unshift("Some generated page titles are duplicated; review the series before publishing.");
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
  const book=removePageCountWarnings(ensurePublishingKit({...metadata,pages},input));
  return {book,metrics:{totalDuration,evalCount,batches:Math.ceil(input.pageCount/batchSize)}};
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
  if(!input.activityType)input.activityType=Array.isArray(input.activityTypes)?input.activityTypes[0]:"";
  if(!input.activityType)throw new Error("Please select an activity type.");
  input.genreType=String(input.genreType||input.difficulty||"Classic Educational").trim();
  if(!GENRE_TYPES.includes(input.genreType))throw new Error("Please select a valid type / genre.");
  input.bookIdea=String(input.bookIdea||"").replace(/\s+/g," ").trim().slice(0,180);
  const detectedTheme=detectThemeFromIdea(input.bookIdea,input.activityType,input.genreType);
  if(detectedTheme){
    input.theme=detectedTheme;
    input.topic=detectedTheme;
  }
  if(!input.theme)input.theme=String(input.topic||"").trim();
  if(!input.topic)input.topic=input.theme;
  if(!input.topic||input.topic.length<3)throw new Error("Please enter a book idea so BrightBook can detect a theme.");
  if(!input.theme)throw new Error("BrightBook could not detect a theme from your book idea.");
  if(!isCompatible(input.activityType,input.theme))throw new Error(`The detected theme is not a good fit for ${input.activityType}. Please adjust your book idea.`);
  if(!isGenreCompatible(input.activityType,input.theme,input.genreType))throw new Error(`The selected type / genre is not a good fit for ${input.activityType} with ${input.theme}. Please choose another combination.`);
  input.mazeLayout=String(input.mazeLayout||"Mixed Marketplace Variety").trim();
  if(input.activityType==="maze"&&!MAZE_LAYOUT_TYPES.includes(input.mazeLayout))throw new Error("Please select a valid maze layout / style.");
  if(input.activityType!=="maze")input.mazeLayout="";
  input.difficulty=input.genreType;
  input.style=String(input.style||styleFromGenre(input.genreType)).trim();
  input.customDirection=String(input.customDirection||"").replace(/\s+/g," ").trim().slice(0,500);
  input.avoidTerms=String(input.avoidTerms||"").replace(/\s+/g," ").trim().slice(0,350);
  input.learningGoal=String(input.learningGoal||"").replace(/\s+/g," ").trim().slice(0,240);
  input.guideCharacter=String(input.guideCharacter||"").replace(/\s+/g," ").trim().slice(0,240);
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
      genres:GENRE_TYPES.map(name=>({name,compatibleActivityTypes:compatibleActivitiesForGenre(name),compatibleThemes:compatibleThemesForGenre(name)})),
      mazeLayouts:MAZE_LAYOUT_TYPES
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
