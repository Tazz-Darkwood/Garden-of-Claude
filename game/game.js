(() => {
'use strict';

const canvas = document.getElementById('sky');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

// ---------- persistence ----------
const SAVE_KEY = 'claude-garden-v6';
const PLANTS_KEY = 'claude-garden-plants-v6';
const PREF_KEY = 'claude-garden-prefs';
function loadJSON(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }
// Runs 1 to 3 (2026-09-24) ran away; their saves are wiped on purpose so run 4 logs from zero.
for (const k of ['claude-garden-v1', 'claude-garden-v2', 'claude-garden-v3', 'claude-garden-v4', 'claude-garden-v5', 'claude-garden-plants', 'claude-garden-plants-v4', 'claude-garden-plants-v5', 'claude-garden-ledger', 'claude-garden-ledger-v4', 'claude-garden-ledger-v5']) { try { localStorage.removeItem(k); } catch { /* ignore */ } }

// Plant stages: seven named ones, then it keeps going geometrically until you harvest.
const STAGE_NAMES = ['seed', 'sprout', 'seedling', 'young plant', 'bush', 'flowering', 'fruiting', 'wild', 'overgrown', 'glowing', 'enchanted', 'monstrous', 'ancient', 'mythic'];

// ---------- themes ----------
// A theme is a set of optional overrides over the garden baseline: the words the
// interface uses, names for shop items and species, a sky palette, and canvas
// renderers (theme.draw.<name>). Anything a theme leaves out falls back to the
// garden. The economy, the hooks, and the save are the same in every theme.
const GARDEN_WORDS = {
  title: '🌱 Garden of Claude', place: 'garden', sap: 'sap', seed: 'seed', seeds: 'seeds', plant: 'plant', plants: 'plants',
  harvest: 'Harvest', harvested: 'harvested', nothingToHarvest: 'nothing to harvest', sprouted: 'sprouted',
  water: 'water', light: 'light', nutrients: 'nutrients', sunbeam: 'sunbeam', puddle: 'puddle', greenhouse: 'greenhouse',
  crowLanded: 'a crow landed', crowTitle: 'A crow', birdTitle: 'A passing bird', birdFloat: '🐦 +',
  beeTitle: 'A bee', beeTip: 'Click it to pollinate the plant for a bonus before it flies off.', beeVisit: 'a bee is visiting', beeFloat: '🐝 pollinated +',
  shopTitle: 'Garden shop', shopTab: 'Garden', stages: STAGE_NAMES, prestige: 'New season', season: 'season',
  mailboxTitle: 'Mailbox', mailboxEmpty: 'Letters arrive here only when Claude needs an answer from you.', deskTitle: 'Writing desk', gateTitle: 'The gate', lanternTitle: 'Lantern of', tend: 'click to tend',
  starTitle: 'A shooting star', butterflyTitle: 'A butterfly', catTitle: 'A cat', snailTitle: 'A snail', ladybugTitle: 'A ladybug',
  lanternOut: 'Out while the context is compacted. It is relit when compaction finishes.', lanternLeft: 'of the light left before compaction is due.', lanternLow: 'It is guttering. Let auto-compact run or type /compact in the app.',
};
const THEMES = {};
const themeShared = {};   // helpers that themes lend each other
// Themed plants scale with the room above the planter so a grown one fills the screen.
function themeRoom(r) { return Math.max(1, Math.min(1.7, (r.y - 90) / 340)); }
let theme = { id: 'garden', name: 'Garden', icon: '🌱', price: 0, blurb: 'The plant in its pot: sap, seeds, water, light, and nutrients. Always yours.', words: GARDEN_WORDS, items: {}, species: {}, draw: {} };
const themeOwned = (id) => id === 'garden' || (garden.levels['theme:' + id] || 0) > 0;
THEMES.garden = theme;
function W_(k) { return theme.words && theme.words[k] != null ? theme.words[k] : GARDEN_WORDS[k]; }
function R_(name, fn) { return (theme.draw && theme.draw[name]) || fn; }
function itemName(u) { const o = theme.items && theme.items[u.id]; return (o && o.name) || u.name; }
function itemIcon(u) { const o = theme.items && theme.items[u.id]; return (o && o.icon) || u.icon; }
function itemDesc(u) { const o = theme.items && theme.items[u.id]; return (o && o.desc) || u.desc; }
function speciesName(sp) { const o = theme.species && theme.species[sp.id]; return (o && o.name) || sp.name; }
function speciesBlurb(sp) { const o = theme.species && theme.species[sp.id]; return (o && o.blurb) || sp.blurb; }
const STAGES = [0, 15, 50, 130, 300, 600, 1100];
while (STAGES.length < 40) STAGES.push(Math.round(STAGES[STAGES.length - 1] * 2.2));
const FRUITING = 6;
function stageIndex(g) { let i = 0; for (let k = 0; k < STAGES.length; k++) if (g >= STAGES[k]) i = k; return i; }
function stageName(i) { const names = W_('stages'); return i < names.length ? names[i] : names[names.length - 1] + ' ' + toRoman(i - names.length + 2); }
function toRoman(n) { const t = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let s = ''; for (const [v, r] of t) while (n >= v) { s += r; n -= v; } return s; }
function stageProgress(g) {
  const i = stageIndex(g);
  const a = STAGES[i], b = STAGES[i + 1] || a * 2.2;
  return Math.min(1, (g - a) / (b - a));
}

const garden = Object.assign({ sap: 0, lifetime: 0, seeds: 0, harvests: 0, clicks: 0, crits: 0, events: 0, born: Date.now(), levels: {}, legacy: 0, legacySpent: 0, perks: {}, runs: [], runLifetime: null, runStart: 0, maxStage: 0, petted: 0, fireworks: 0, achievements: {} }, loadJSON(SAVE_KEY) || {});
// Older saves (and saves adopted from the server) may lack the season fields.
function normalizeGarden() {
  if (garden.runLifetime == null || garden.runLifetime > garden.lifetime) garden.runLifetime = garden.lifetime;
  if (!garden.runStart) garden.runStart = garden.born || Date.now();
  garden.perks = garden.perks || {}; garden.runs = garden.runs || []; garden.achievements = garden.achievements || {};
  garden.legacy = garden.legacy || 0; garden.legacySpent = garden.legacySpent || 0;
}
normalizeGarden();
garden.levels = garden.levels || {};
const plants = loadJSON(PLANTS_KEY) || {};
const prefs = Object.assign({ sound: false }, loadJSON(PREF_KEY) || {});

// ---------- shared save ----------
// The server holds the one true garden. This window becomes the writer when you
// click or buy; until then it mirrors whatever window is playing.
const clientId = (() => { try { let id = sessionStorage.getItem('garden-client'); if (!id) { id = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('garden-client', id); } return id; } catch { return Math.random().toString(36).slice(2, 10); } })();
let isWriter = false, claimPending = false, adoptedRemote = false;
function replaceInto(target, data) { for (const k of Object.keys(target)) delete target[k]; Object.assign(target, data || {}); }
function adoptSave(data) {
  if (!data || !data.garden) return;
  replaceInto(garden, data.garden); garden.levels = garden.levels || {};
  replaceInto(plants, data.plants);
  if (data.ledger) replaceInto(ledger, data.ledger);
  ledger.totals = ledger.totals || {}; ledger.minutes = ledger.minutes || []; ledger.events = ledger.events || [];
  adoptedRemote = true;
}
async function pullSave() {
  try { const r = await fetch('/save'); const data = await r.json(); if (data && data.garden && data.writer !== clientId) adoptSave(data); else if (data && data.writer === clientId) isWriter = true; }
  catch { /* offline: play from local storage */ }
}
async function pushSave() {
  try {
    const r = await fetch('/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, claim: claimPending, garden, plants, ledger }) });
    if (r.ok) { isWriter = true; claimPending = false; }
    else if (r.status === 409) { isWriter = false; }
  } catch { /* offline */ }
}
function claimWriter() { if (!isWriter) claimPending = true; }
setInterval(() => {
  saveJSON(SAVE_KEY, garden); saveJSON(PLANTS_KEY, plants); saveJSON(LEDGER_KEY, ledger);
  if (isWriter || claimPending) pushSave();
}, 4000);

function plantFor(sid) {
  if (!plants[sid]) plants[sid] = { sap: 0, grown: 0, water: 40, light: 40, nutrients: 30, clicks: 0, born: Date.now(), lastSeen: Date.now(), species: pickSpecies() };
  const p = plants[sid];
  if (!p.species) p.species = 'leafy';
  if (typeof p.sap !== 'number') p.sap = p.growth || 0;
  if (typeof p.grown !== 'number') p.grown = 0;
  if (typeof p.nutrients !== 'number') p.nutrients = 20;
  p.lastSeen = Date.now();
  return p;
}
for (const [sid, p] of Object.entries(plants)) if (Date.now() - (p.lastSeen || 0) > 3 * 24 * 3600 * 1000) delete plants[sid];

// ---------- the shop: tools, skills, garden ----------
// cost(level) = base * factor^level; tools add flat click power per level and double at 10, 25, 50.
const ITEMS = [
  // Steady clicking with combo and windows is worth about twenty base clicks a
  // second, so prices are anchored to that: the first trowel is a minute's work,
  // each tier costs about eight times more per point of power than the last, and
  // a tier becomes the better buy around level 15 of the one before it.
  { id: 'trowel', cat: 'tool', name: 'Trowel', icon: '🪣', base: 1000, factor: 1.15, max: 999, power: 1, desc: 'Adds 1 click power per level.' },
  { id: 'can', cat: 'tool', name: 'Watering can', icon: '🚰', base: 50000, factor: 1.15, max: 999, power: 6, desc: 'Adds 6 click power per level.' },
  { id: 'shears', cat: 'tool', name: 'Pruning shears', icon: '✂️', base: 2000000, factor: 1.15, max: 999, power: 40, desc: 'Adds 40 click power per level.' },
  { id: 'trellis', cat: 'tool', name: 'Trellis', icon: '🪜', base: 60000000, factor: 1.15, max: 999, power: 250, desc: 'Adds 250 click power per level.' },
  { id: 'sprinkler', cat: 'tool', name: 'Sprinkler', icon: '💦', base: 350000000, factor: 1.15, max: 999, power: 700, desc: 'Adds 700 click power per level.' },
  { id: 'hive', cat: 'tool', name: 'Beehive', icon: '🐝', base: 1500000000, factor: 1.15, max: 999, power: 1600, desc: 'Adds 1,600 click power per level.' },
  { id: 'orchard', cat: 'tool', name: 'Orchard', icon: '🌳', base: 45000000000, factor: 1.15, max: 999, power: 12000, desc: 'Adds 12,000 click power per level.' },

  { id: 'rhythm', cat: 'skill', name: 'Rhythm', icon: '🥁', base: 40000, factor: 15, max: 3, desc: 'Raises the combo cap from ×2 to ×2.5, ×3, then ×3.5.' },
  { id: 'steady', cat: 'skill', name: 'Steady hands', icon: '🖐️', base: 70000, factor: 14, max: 2, desc: 'The combo takes 12, then 16 seconds to drain instead of 8.' },
  { id: 'lucky', cat: 'skill', name: 'Lucky thumb', icon: '🍀', base: 30000, factor: 2.4, max: 5, desc: 'Adds 1% critical click chance per level (1% to start). Crits pay five times.' },
  { id: 'bigcrit', cat: 'skill', name: 'Big crits', icon: '💥', base: 300000, factor: 13, max: 2, desc: 'Crits pay 7.5 times, then 10.' },
  { id: 'longbeam', cat: 'skill', name: 'Long sunbeam', icon: '⏳', base: 80000, factor: 15, max: 2, desc: 'The sunbeam after Claude writes a file lasts 12, then 16 seconds instead of 8.' },
  { id: 'brightbeam', cat: 'skill', name: 'Bright sunbeam', icon: '☀️', base: 500000, factor: 1, max: 1, desc: 'Clicks inside a sunbeam pay four times instead of three.' },
  { id: 'puddle', cat: 'skill', name: 'Deep puddle', icon: '💧', base: 250000, factor: 1, max: 1, desc: 'Clicks while it is raining on a planter pay double instead of 1.5 times.' },
  { id: 'birdseed', cat: 'skill', name: 'Birdseed', icon: '🌻', base: 150000, factor: 1, max: 1, desc: 'Catching a passing bird pays three times as much.' },
  { id: 'hold', cat: 'skill', name: 'Mouse saver', icon: '🖱️', base: 60000, factor: 12, max: 4, desc: 'Hold the button down on a planter and it keeps clicking for you: 3 a second, then 4, 5, and 7, a touch faster than a fast thumb.' },

  { id: 'barrel', cat: 'garden', name: 'Rain barrel', icon: '🪣', base: 20000, factor: 1, max: 1, desc: 'Water meter holds 150 and drains a third slower.' },
  { id: 'compost', cat: 'garden', name: 'Compost bin', icon: '🪴', base: 40000, factor: 1, max: 1, desc: 'Shell commands give twice the nutrients.' },
  { id: 'feeder', cat: 'garden', name: 'Bird feeder', icon: '🐦', base: 90000, factor: 1, max: 1, desc: 'Every tool call feeds water, light, and nutrients twice as much.' },
  { id: 'scarecrow', cat: 'garden', name: 'Scarecrow', icon: '🌾', base: 150000, factor: 1, max: 1, desc: 'Crows from failed tools leave in 20 seconds instead of 60.' },
  { id: 'greenhouse', cat: 'garden', name: 'Greenhouse', icon: '🏡', base: 300000, factor: 1, max: 1, desc: 'A glass greenhouse at the back of the garden. Light drains a third slower and crows can no longer slow the trickle.' },
];
const ITEM = Object.fromEntries(ITEMS.map((u) => [u.id, u]));
const lvl = (id) => garden.levels[id] || 0;
const has = (id) => lvl(id) > 0;
function costOf(u) { return Math.ceil(u.base * Math.pow(u.factor, lvl(u.id))); }
function toolPower(u) {
  const n = lvl(u.id);
  const mult = n >= 100 ? 8 : n >= 50 ? 4 : n >= 25 ? 2 : 1;
  return u.power * n * mult;
}
// Seeds give diminishing returns: +25% at one seed, +79% at ten, +250% at a hundred.
const seedBonus = () => 1 + 0.25 * Math.sqrt(garden.seeds);
function toolsPower() {
  let p = 1;
  for (const u of ITEMS) if (u.cat === 'tool') p += toolPower(u);
  return p;
}
const perk = (id) => Boolean(garden.perks && garden.perks[id]);
const achievementCount = () => Object.keys(garden.achievements || {}).length;
// Legacy: +5% click power per unspent point; achievements: +0.5% each. Both survive a new season.
const legacyMult = () => (1 + 0.05 * (garden.legacy || 0)) * (1 + 0.005 * achievementCount());
function clickPower() { return toolsPower() * seedBonus() * legacyMult(); }
const comboCap = () => [2, 2.5, 3, 3.5][Math.min(3, lvl('rhythm'))] + (perk('secondwind') ? 0.5 : 0);
const puddleMs = () => (perk('longlight') ? 9000 : 6000);
const drainMult = () => (perk('patientsoil') ? 0.75 : 1);
const comboSeconds = () => 8 + 4 * lvl('steady');
const critChance = () => 0.01 + 0.01 * lvl('lucky');
const critMult = () => 5 + 2.5 * lvl('bigcrit');
const sunbeamSeconds = () => (8 + 4 * lvl('longbeam')) * (perk('longlight') ? 1.5 : 1);
const sunbeamMult = () => (has('brightbeam') ? 4 : 3);
const puddleMult = () => (has('puddle') ? 2 : 1.5);
const birdMult = () => (has('birdseed') ? 3 : 1);
const holdRate = () => [0, 3, 4, 5, 7][Math.min(4, lvl('hold'))];
const waterCap = () => (has('barrel') ? 150 : 100);
function feed(p, w, l, n) { p.water = Math.min(waterCap(), p.water + w); p.light = Math.min(100, p.light + l); p.nutrients = Math.min(100, (p.nutrients || 0) + n); }
function meterFactor(p) { return 0.4 + 0.2 * Math.min(1, p.water / waterCap()) + 0.2 * p.light / 100 + 0.2 * p.nutrients / 100; }

// ---------- tuning knobs (shown in Stats so numbers can be argued about) ----------
const TUNING = {
  trickle: 0.3,      // sap per second while Claude works = trickle * sqrt(click power) * meter factor
  burst: 1.0,        // sap per tool call Claude makes = burst * sqrt(click power) * meter factor
  comboStep: 0.08,   // combo gained per click (0..1)
  shoo: 10,          // click powers for shooing a crow
  bird: 20,          // click powers for catching a bird
};
// Claude's own contribution grows with the square root of your click power, so it
// keeps a plant alive while you are away but never outruns your clicking.
const passivePower = () => Math.sqrt(clickPower());

// ---------- ledger: where every drop of sap comes from ----------
const LEDGER_KEY = 'claude-garden-ledger-v6';
const SOURCES = ['click', 'crit', 'window', 'trickle', 'burst', 'shoo', 'bird'];

// ---------- seasons: prestige, legacy perks, achievements ----------
// A new season resets sap, tools, skills, garden items, seeds, and the plant,
// and pays legacy points: sqrt(lifetime this season / 10M). Each unspent
// point is a permanent +5% click power; points can also buy perks below.
const LEGACY_DIV = 1e7;
function legacyGain() { return Math.floor(Math.sqrt((garden.runLifetime || 0) / LEGACY_DIV)); }
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const PERKS = [
  { id: 'headstart', name: 'Head start', cost: 1, desc: () => 'Every ' + W_('season') + ' begins with ten ' + itemName(ITEM.trowel).toLowerCase() + ' levels and the ' + itemName(ITEM.can).toLowerCase() + '.' },
  { id: 'deeproots', name: 'Deep roots', cost: 2, desc: () => 'Keep a quarter of your ' + W_('seeds') + ' through a ' + W_('prestige').toLowerCase() + '.' },
  { id: 'longlight', name: 'Long light', cost: 2, desc: () => cap(W_('sunbeam')) + 's and ' + W_('puddle') + 's last half again as long.' },
  { id: 'patientsoil', name: 'Patient soil', cost: 2, desc: () => cap(W_('water')) + ', ' + W_('light') + ', and ' + W_('nutrients') + ' drain a quarter slower.' },
  { id: 'secondwind', name: 'Second wind', cost: 3, desc: () => 'The combo cap rises by half.' },
  { id: 'greenkey', name: 'Greenhouse key', cost: 3, desc: () => 'The ' + itemName(ITEM.greenhouse).toLowerCase() + ' and ' + itemName(ITEM.scarecrow).toLowerCase() + ' are yours from the start of every ' + W_('season') + '.' },
];
const perkName = (p) => (theme.perkNames && theme.perkNames[p.id]) || p.name;
const achName = (a) => (theme.achNames && theme.achNames[a.id]) || (typeof a.name === 'function' ? a.name() : a.name);
const ACHIEVEMENTS = [
  { id: 'clicks1k', name: 'Green thumb', desc: () => 'A thousand clicks.', check: () => garden.clicks >= 1000 },
  { id: 'clicks100k', name: 'Calloused', desc: () => 'A hundred thousand clicks.', check: () => garden.clicks >= 100000 },
  { id: 'held10k', name: 'Mouse saved', desc: () => 'Ten thousand held clicks.', check: () => (garden.held || 0) >= 10000 },
  { id: 'crits1k', name: 'Lucky streak', desc: () => 'A thousand crits.', check: () => garden.crits >= 1000 },
  { id: 'harvests10', name: 'Ten harvests', desc: () => cap(W_('harvested')) + ' ten ' + W_('plants') + '.', check: () => garden.harvests >= 10 },
  { id: 'seeds100', name: () => cap(W_('seed')) + ' bank', desc: () => 'A hundred ' + W_('seeds') + ' earned.', check: () => ledger.seeds >= 100 },
  { id: 'mythic', name: () => cap(W_('stages')[13]), desc: () => 'Grew a ' + W_('plant') + ' to ' + W_('stages')[13] + '.', check: () => (garden.maxStage || 0) >= 13 },
  { id: 'cat', name: 'Cat person', desc: () => 'Petted the cat.', check: () => (garden.petted || 0) >= 1 },
  { id: 'cat10', name: 'Regular', desc: () => 'Petted the cat ten times.', check: () => (garden.petted || 0) >= 10 },
  { id: 'fireworks', name: 'Shipped', desc: () => 'Saw the fireworks for a push.', check: () => (garden.fireworks || 0) >= 1 },
  { id: 'themes', name: 'Collector', desc: () => 'Owns every theme.', check: () => Object.keys(THEMES).every((id) => themeOwned(id)) },
  { id: 'lifetime1b', name: 'Billionaire', desc: () => 'A billion lifetime ' + W_('sap') + '.', check: () => garden.lifetime >= 1e9 },
  { id: 'prestige1', name: () => W_('prestige'), desc: () => 'Started a ' + W_('prestige').toLowerCase() + '.', check: () => (garden.runs || []).length >= 1 },
  { id: 'prestige5', name: 'Old hand', desc: () => 'Started five ' + W_('season') + 's over.', check: () => (garden.runs || []).length >= 5 },
];
let achievementClock = 0;
function checkAchievements(dt) {
  achievementClock -= dt; if (achievementClock > 0) return; achievementClock = 2;
  if (!isWriter) return;   // only the window that plays unlocks; mirrors would re-announce after every pull
  for (const a of ACHIEVEMENTS) {
    if (garden.achievements[a.id]) continue;
    let ok = false; try { ok = a.check(); } catch { ok = false; }
    if (!ok) continue;
    garden.achievements[a.id] = Date.now();
    fly('achievement: ' + achName(a) + ' (+0.5% clicks)', '#ffcb5c');
    pushTicker('achievement unlocked: ' + achName(a) + ' · ' + a.desc(), 'ok');
    recordEvent('achievement: ' + achName(a), 0);
  }
}
function applyStartPerks() {
  if (perk('headstart')) { garden.levels.trowel = Math.max(garden.levels.trowel || 0, 10); garden.levels.can = Math.max(garden.levels.can || 0, 1); }
  if (perk('greenkey')) { garden.levels.greenhouse = 1; garden.levels.scarecrow = 1; }
}
function prestige() {
  const gain = legacyGain(); if (gain < 1) return;
  claimWriter();
  garden.runs.push({ started: garden.runStart || garden.born, ended: Date.now(), lifetime: garden.runLifetime || 0, seeds: garden.seeds, harvests: garden.harvests, legacy: gain });
  if (garden.runs.length > 60) garden.runs.shift();
  garden.legacy = (garden.legacy || 0) + gain;
  const keep = {}; for (const [k, v] of Object.entries(garden.levels)) if (k.startsWith('theme:')) keep[k] = v;
  garden.levels = keep;
  garden.sap = 0; garden.runLifetime = 0; garden.runStart = Date.now();
  garden.seeds = perk('deeproots') ? Math.floor(garden.seeds * 0.25) : 0;
  applyStartPerks();
  for (const p of Object.values(plants)) { p.sap = 0; p.grown = 0; p.clicks = 0; p.born = Date.now(); p.species = pickSpecies(); }
  combo = 0;
  recordEvent(W_('prestige') + ': +' + gain + ' legacy', 0);
  pushTicker(W_('prestige') + ' · +' + gain + ' legacy point' + (gain === 1 ? '' : 's') + ' · ' + W_('sap') + ', tools, and ' + W_('seeds') + ' start over', 'you');
  dawnFlash = 1.6;
  saveJSON(SAVE_KEY, garden); saveJSON(PLANTS_KEY, plants);
  shopSig = ''; renderAlmanac(); updateHud();
}
function renderAlmanac() {
  const gain = legacyGain(), pts = garden.legacy || 0, ach = achievementCount();
  const tiles = [
    [pts, 'legacy points'],
    ['+' + Math.round(5 * pts) + '%', 'click power from legacy'],
    [ach + '/' + ACHIEVEMENTS.length, 'achievements (+' + (0.5 * ach).toFixed(1) + '%)'],
    [garden.runs.length, W_('season') + 's finished'],
    [fmt(garden.runLifetime || 0), W_('sap') + ' this ' + W_('season')],
  ];
  $('almanac-h-perks').firstChild.textContent = 'Legacy perks ';
  $('almanac-h-runs').textContent = 'Past ' + W_('season') + 's';
  $('almanac-rates').innerHTML = tiles.map(([v, k]) => '<div class="tile"><div class="v">' + esc(String(v)) + '</div><div class="k">' + esc(k) + '</div></div>').join('');
  $('almanac-meta').textContent = W_('season') + ' ' + (garden.runs.length + 1) + ' · since ' + new Date(garden.runStart || garden.born).toLocaleDateString();
  const nextAt = Math.pow(gain + 1, 2) * LEGACY_DIV;
  $('almanac-prestige-text').textContent = gain >= 1
    ? W_('prestige') + ' now for +' + gain + ' legacy point' + (gain === 1 ? '' : 's') + ' (next one at ' + fmt(nextAt) + ' ' + W_('sap') + ' this ' + W_('season') + '). It resets ' + W_('sap') + ', tools, skills, ' + W_('place') + ' items, ' + W_('seeds') + ', and the ' + W_('plant') + '. Themes, legacy, achievements, and the ledger stay.'
    : 'The first legacy point needs ' + fmt(LEGACY_DIV) + ' ' + W_('sap') + ' earned this ' + W_('season') + ' (you are at ' + fmt(garden.runLifetime || 0) + '). Every point after that costs more: the next one arrives at ' + fmt(nextAt) + '.';
  if (!armed.prestige) $('prestige').textContent = W_('prestige');
  $('prestige').disabled = gain < 1;
  const perksEl = $('almanac-perks'); perksEl.innerHTML = '';
  for (const p of PERKS) {
    const owned = perk(p.id);
    const row = document.createElement('div'); row.className = 'upgrade' + (owned ? ' owned' : '');
    const icon = document.createElement('div'); icon.className = 'icon'; icon.textContent = owned ? '✅' : '🔒'; row.appendChild(icon);
    const text = document.createElement('div'); text.className = 'text';
    const name = document.createElement('div'); name.className = 'name'; name.textContent = perkName(p);
    const desc = document.createElement('div'); desc.className = 'desc'; desc.textContent = p.desc();
    text.appendChild(name); text.appendChild(desc); row.appendChild(text);
    const btn = document.createElement('button'); btn.textContent = owned ? 'Owned' : p.cost + ' point' + (p.cost === 1 ? '' : 's'); btn.disabled = owned || pts < p.cost;
    btn.addEventListener('click', () => {
      if (perk(p.id) || (garden.legacy || 0) < p.cost) return;
      claimWriter();
      garden.legacy -= p.cost; garden.legacySpent = (garden.legacySpent || 0) + p.cost; garden.perks[p.id] = true;
      applyStartPerks();
      recordEvent('legacy perk: ' + perkName(p), 0); pushTicker('legacy perk: ' + perkName(p).toLowerCase(), 'you');
      saveJSON(SAVE_KEY, garden); shopSig = ''; renderAlmanac(); updateHud();
    });
    row.appendChild(btn); perksEl.appendChild(row);
  }
  const achEl = $('almanac-ach'); achEl.innerHTML = '';
  for (const a of ACHIEVEMENTS) {
    const when = garden.achievements[a.id];
    const row = document.createElement('div'); row.className = 'upgrade' + (when ? ' owned' : '');
    const icon = document.createElement('div'); icon.className = 'icon'; icon.textContent = when ? '🏅' : '·'; row.appendChild(icon);
    const text = document.createElement('div'); text.className = 'text';
    const name = document.createElement('div'); name.className = 'name'; name.textContent = achName(a);
    const desc = document.createElement('div'); desc.className = 'desc'; desc.textContent = a.desc() + (when ? ' Unlocked ' + new Date(when).toLocaleDateString() + '.' : '');
    text.appendChild(name); text.appendChild(desc); row.appendChild(text); achEl.appendChild(row);
  }
  const runs = garden.runs;
  $('almanac-runs').innerHTML = runs.length
    ? '<tr><th>' + esc(W_('season')) + '</th><th>started</th><th>length</th><th>' + esc(W_('sap')) + '</th><th>' + esc(W_('seeds')) + '</th><th>legacy</th></tr>' + runs.map((r, i) => { const mins = Math.round((r.ended - r.started) / 60000); return '<tr><td>' + (i + 1) + '</td><td>' + new Date(r.started).toLocaleDateString() + '</td><td>' + (mins >= 60 ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm' : mins + 'm') + '</td><td>' + fmt(r.lifetime) + '</td><td>' + r.seeds + '</td><td>+' + r.legacy + '</td></tr>'; }).join('')
    : '<tr><td>No ' + esc(W_('season')) + ' finished yet. This one has run ' + Math.round((Date.now() - (garden.runStart || garden.born)) / 3600000) + ' hours of wall-clock time.</td></tr>';
}
const SOURCE_COLORS = { click: '#6fd38a', crit: '#ffcb5c', window: '#ff8f4d', trickle: '#5aa9ff', burst: '#c7b3ff', shoo: '#b98b5a', bird: '#9ad9a8' };
const ledger = Object.assign({ totals: {}, minutes: [], events: [], spent: 0, seeds: 0 }, loadJSON(LEDGER_KEY) || {});
pullSave();
function minuteBucket() {
  const m = Math.floor(Date.now() / 60000);
  let b = ledger.minutes[ledger.minutes.length - 1];
  if (!b || b.m !== m) {
    if (b && !b.sent) { b.sent = true; fetch('/econ', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).catch(() => {}); }
    b = { m, clicks: 0, crits: 0, held: 0 };
    for (const s of SOURCES) b[s] = 0;
    ledger.minutes.push(b);
    if (ledger.minutes.length > 1440) ledger.minutes.splice(0, ledger.minutes.length - 1440);
  }
  return b;
}
function record(source, amount) {
  const b = minuteBucket();
  b[source] = (b[source] || 0) + amount;
  ledger.totals[source] = (ledger.totals[source] || 0) + amount;
}
function recordEvent(text, value) {
  ledger.events.push({ at: Date.now(), text, value: value || 0 });
  if (ledger.events.length > 200) ledger.events.splice(0, ledger.events.length - 200);
}
function sumSince(ms) {
  const from = Math.floor((Date.now() - ms) / 60000);
  const out = { clicks: 0, crits: 0, held: 0 };
  for (const s of SOURCES) out[s] = 0;
  for (const b of ledger.minutes) if (b.m >= from) { for (const k of Object.keys(out)) out[k] += b[k] || 0; }
  return out;
}

function fmt(n) {
  if (n < 1000) return n < 10 ? n.toFixed(1).replace(/\.0$/, '') : Math.round(n).toLocaleString();
  const units = ['K', 'M', 'B', 'T', 'Qa', 'Qi'];
  let u = -1;
  while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
  return (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.round(n)) + units[u];
}

// ---------- live state ----------
const weather = { rain: 0, sun: 0, wind: 0, cloud: 0, bird: 0 };
const particles = [];
const floaters = [];
const ticker = [];
const pests = [];
const sunbeams = {};     // sid -> until
const lastRain = {};     // sid -> timestamp
let combo = 0;           // 0..1
let sessions = {};
let paused = false;
let connected = false;
let mode = 'idle';
let lastEventAt = 0;
let dawnFlash = 0;
let W = 0, H = 0;
let soilY = 0;
const rects = {};
let placeholderRect = null;
const gate = { x: 0, y: 0, w: 70 };
const hover = { x: -1, y: -1 };

// what Claude says and does
const journal = {};          // sid -> [{ at, kind, text, detail, html }]
const bubbles = {};          // sid -> { text, at }
function addEntry(sid, kind, text, detail, html) {
  if (!sid) return;
  const list = journal[sid] || (journal[sid] = []);
  list.push({ at: Date.now(), kind, text, detail: detail || '', html: html || '' });
  if (list.length > 400) list.splice(0, list.length - 400);
  if (!$('journal').classList.contains('hidden')) renderJournal();
  renderBoard();
}

// The board: the conversation with the focused session, in full, always visible.
let boardSid = null, boardCount = 0;
const BOARD_KINDS = new Set(['you', 'claude', 'thought', 'day']);
function renderBoard() {
  const s = focused();
  const list = $('board-list');
  const entries = ((s && journal[s.id]) || []).filter((e) => BOARD_KINDS.has(e.kind));
  if (!s || s.id !== boardSid) {
    boardSid = s ? s.id : null; boardCount = 0; list.innerHTML = '';
    $('board-meta').textContent = s ? sessionLabel(s) : 'no session';
  }
  if (entries.length < boardCount) { boardCount = 0; list.innerHTML = ''; }
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  for (let i = boardCount; i < entries.length; i++) {
    const e = entries[i];
    const d = document.createElement('div'); d.className = 'msg ' + e.kind;
    if (e.kind === 'day') { d.className = 'msg event'; d.textContent = '☀ a new day'; list.appendChild(d); continue; }
    const when = document.createElement('span'); when.className = 'when';
    const t = new Date(e.at); when.textContent = (e.kind === 'you' ? 'you · ' : e.kind === 'thought' ? '' : 'Claude · ') + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    if (e.kind !== 'thought') d.appendChild(when);
    if (e.kind === 'claude') { const body = document.createElement('div'); body.innerHTML = e.html || md(e.text); d.appendChild(body); }
    else d.appendChild(document.createTextNode(e.text));
    list.appendChild(d);
  }
  while (list.children.length > 80) list.removeChild(list.firstChild);
  boardCount = entries.length;
  if (nearBottom || boardCount <= 3) list.scrollTop = list.scrollHeight;
}

// mailbox / letters
const letters = [];
let pendingHolds = {};
let letterIdx = -1;
let unread = 0;
const mailbox = { x: 0, y: 0, w: 44, h: 30, postH: 56 };
const readIds = new Set(loadJSON('claude-garden-read') || []);
function markRead(id) { if (readIds.has(id)) return; readIds.add(id); saveJSON('claude-garden-read', [...readIds].slice(-200)); }
const needsAttention = (l) => l.needsAnswer && !l.replied && !l.released && !readIds.has(l.id);
const desk = { x: 0, y: 0, w: 58, h: 30 };
let queuedNotes = {};
function deskState() {
  const s = focused();
  if (!s) return { s: null, mode: 'none' };
  if (pendingHolds[s.id]) return { s, mode: 'ready' };
  if (Date.now() - (s.lastSeen || 0) >= 10 * 60 * 1000) return { s, mode: 'none' };
  if (s.status === 'idle' || s.status === 'your_turn') return { s, mode: 'later' };
  return { s, mode: 'queue' };
}
function hitDesk(x, y) { return x >= desk.x - 8 && x <= desk.x + desk.w + 8 && y >= desk.y - 70 && y <= desk.y + 8; }
function openDesk() {
  const st = deskState();
  if (st.mode === 'none') return;
  const sel = $('desk-session');
  $('desk-meta').textContent = sessionLabel(st.s) + ' · ' + st.s.cwd;
  const note = $('desk-note');
  const waiting = queuedNotes[st.s.id] ? ' One note is already waiting; sending replaces it.' : '';
  if (st.mode === 'ready') { note.className = ''; note.textContent = 'Claude is standing by. This goes straight to it.'; $('desk-send').textContent = 'Send'; }
  else if (st.mode === 'later') { note.className = 'off'; note.textContent = 'Claude has finished its turn in the app, and nothing here can start a new one. Your note is kept and goes to Claude with the next message you type in the app.' + waiting; $('desk-send').textContent = 'Keep for my next app message'; }
  else { note.className = ''; note.textContent = 'Claude is busy. Your note is handed over the moment this turn ends.' + (queuedNotes[st.s.id] ? ' One note is already waiting; sending replaces it.' : ''); $('desk-send').textContent = 'Queue for when Claude pauses'; }
  sel.classList.add('hidden');
  showPanel('desk');
  $('desk-text').focus();
}
function closeDesk() { $('desk').classList.add('hidden'); }
async function sendDesk() {
  const st = deskState(); if (st.mode === 'none') return;
  const text = $('desk-text').value.trim(); if (!text) return;
  $('desk-send').disabled = true;
  try {
    const r = await fetch('/reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: st.s.id, text, queue: st.mode !== 'ready' }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      $('desk-text').value = '';
      if (j.queued) { pushTicker('you → ' + sessionLabel(st.s) + (st.mode === 'later' ? ' (kept for your next app message): ' : ' (queued): ') + oneLine(text, 80), 'you'); }
      else { pushTicker('you → ' + sessionLabel(st.s) + ': ' + oneLine(text, 90), 'you'); addEntry(st.s.id, 'you', text); dawnFlash = Math.max(dawnFlash, 0.8); }
      closeDesk();
    } else { $('desk-note').className = 'off'; $('desk-note').textContent = j.error || 'Could not send.'; }
  } catch { $('desk-note').className = 'off'; $('desk-note').textContent = 'Server offline.'; }
  $('desk-send').disabled = false;
}
$('desk-close').addEventListener('click', closeDesk);
$('desk').addEventListener('click', (e) => { if (e.target === $('desk')) closeDesk(); });
$('desk-send').addEventListener('click', sendDesk);
// Enter sends; Shift+Enter or Ctrl+Enter inserts a new line.
function sendOnEnter(textarea, send) {
  textarea.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) {
      e.preventDefault();
      const s = textarea.selectionStart, en = textarea.selectionEnd;
      textarea.value = textarea.value.slice(0, s) + '\n' + textarea.value.slice(en);
      textarea.selectionStart = textarea.selectionEnd = s + 1;
      return;
    }
    e.preventDefault(); send();
  });
}
sendOnEnter($('desk-text'), sendDesk);

function drawDesk(t) {
  const st = deskState();
  const on = st.mode === 'ready', queue = st.mode === 'queue' || st.mode === 'later';
  const { x, y, w } = desk;
  ctx.fillStyle = '#7a5433'; ctx.fillRect(x, y - 30, w, 6); ctx.fillRect(x + 4, y - 24, 5, 26); ctx.fillRect(x + w - 9, y - 24, 5, 26);
  ctx.fillStyle = on ? '#fffdf2' : queue ? '#e6dfcf' : '#a9a29a';
  ctx.beginPath(); ctx.roundRect(x + 10, y - 40, 22, 14, 2); ctx.fill();
  ctx.fillStyle = on ? '#6b5a3a' : '#8a8478'; ctx.fillRect(x + 13, y - 36, 14, 1.5); ctx.fillRect(x + 13, y - 32, 10, 1.5);
  // lamp
  ctx.fillStyle = '#5b5a68'; ctx.fillRect(x + w - 16, y - 52, 3, 22);
  ctx.fillStyle = on ? '#ffcb5c' : queue ? '#c9a24d' : '#6f6a63';
  ctx.beginPath(); ctx.moveTo(x + w - 24, y - 50); ctx.lineTo(x + w - 5, y - 50); ctx.lineTo(x + w - 9, y - 60); ctx.lineTo(x + w - 20, y - 60); ctx.closePath(); ctx.fill();
  if (on || queue) {
    const g = ctx.createRadialGradient(x + w - 14, y - 46, 2, x + w - 14, y - 46, 40);
    g.addColorStop(0, 'rgba(255,220,120,' + (on ? 0.5 + 0.1 * Math.sin(t * 2) : 0.2).toFixed(2) + ')'); g.addColorStop(1, 'rgba(255,220,120,0)');
    ctx.fillStyle = g; ctx.fillRect(x + w - 54, y - 86, 80, 80);
  }
  if (queuedNotes[st.s && st.s.id]) {
    ctx.fillStyle = '#c94a3a'; ctx.beginPath(); ctx.arc(x + 32, y - 44, 5, 0, Math.PI * 2); ctx.fill();
  }
}

// which session drives the sky and the panel
let focusId = null;
let stickyFocus = false;
let compactAt = 0.9;
function liveSessions() {
  const now = Date.now();
  return Object.values(sessions).filter((s) => now - (s.lastSeen || 0) < 30 * 60 * 1000);
}
function focused() {
  if (stickyFocus && sessions[focusId]) return sessions[focusId];
  const live = liveSessions().sort((a, b) => b.lastSeen - a.lastSeen);
  return live[0] || null;
}
// Time of day follows the real clock: the sun rises at SUNRISE and sets at
// SUNSET (local hours), and it is night in between. The context fraction is
// shown as a number under each plant's name tag and in the panel instead.
const SUNRISE = 6.5, SUNSET = 20.5;
function clockHours() { const d = new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; }
function dayFraction() { return Math.max(0, Math.min(1, (clockHours() - SUNRISE) / (SUNSET - SUNRISE))); }
function isNight() { const h = clockHours(); return h < SUNRISE || h >= SUNSET; }
function contextFraction(s) { return s && s.context && s.context.window ? Math.max(0, Math.min(1, s.context.tokens / s.context.window)) : 0; }
function anyoneWorking() { const now = Date.now(); return liveSessions().some((s) => s.status === 'working' && now - s.lastSeen < 60 * 1000); }

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ---------- text helpers ----------
function base(p) { if (!p || typeof p !== 'string') return ''; return p.split(/[\\/]/).filter(Boolean).pop() || p; }
function oneLine(s, n = 70) {
  if (!s || typeof s !== 'string') return '';
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
function prettyTool(t) {
  if (!t) return '';
  if (t.startsWith('mcp__')) {
    const parts = t.split('__').filter(Boolean);
    const server = (parts[1] || '').replace(/^claude[-_]?/i, '').replace(/[-_]+/g, ' ').toLowerCase();
    return (server ? server + ': ' : '') + (parts[2] || '');
  }
  return t;
}
function sessionLabel(s) { return (s && ((s.title && oneLine(s.title, 26)) || base(s.cwd) || s.id.slice(0, 6))) || '?'; }
function sessionName(ev) {
  const s = sessions[ev.session_id];
  return s ? sessionLabel(s) : (base(ev.cwd) || (ev.session_id || '').slice(0, 6) || '?');
}

function classify(ev) {
  const t = ev.tool_name || '';
  const inp = ev.tool_input || {};
  if (/^(Grep|Glob|Read|LS)$/.test(t)) return { kind: 'rain', text: inp.pattern || base(inp.file_path || inp.path) || t };
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t)) return { kind: 'sun', text: base(inp.file_path || inp.notebook_path) || t };
  if (/^(Bash|PowerShell)$/.test(t)) return { kind: 'wind', text: oneLine(inp.command) || t };
  if (/^(Agent|Task|Workflow)$/.test(t)) return { kind: 'cloud', text: oneLine(inp.description || inp.prompt, 40) || t };
  if (/^(WebFetch|WebSearch)$/.test(t) || /browser|navigate/i.test(t)) return { kind: 'bird', text: oneLine(inp.url || inp.query || t, 50) };
  if (/^mcp__/.test(t)) return { kind: 'bird', text: t.split('__').pop() };
  return { kind: 'mote', text: t || ev.hook_event_name || '' };
}

// ---------- layout ----------
function layout() {
  soilY = H * 0.74;
  mailbox.x = Math.max(24, W * 0.05); mailbox.y = soilY - 6;
  const panelW = Math.min(320, W - 20);
  const right = W - panelW - 24;
  gate.x = right - gate.w; gate.y = soilY;
  desk.x = mailbox.x + mailbox.w + (has('barrel') ? 60 : 30); desk.y = soilY;
  const left = desk.x + desk.w + 34;
  const order = liveSessions().sort((a, b) => a.firstSeen - b.firstSeen);
  const n = Math.max(1, order.length);
  const reserve = (has('compost') ? 44 : 0) + (has('scarecrow') ? 56 : 0);
  const usable = Math.max(120, gate.x - 16 - reserve - left);
  const slot = usable / n;
  const w = Math.max(70, Math.min(200, slot * 0.8));
  const seen = new Set();
  order.forEach((s, i) => {
    const cx = left + slot * (i + 0.5);
    rects[s.id] = { x: cx - w / 2, w, cx, y: soilY, h: 52, scale: Math.min(1, w / 200) };
    seen.add(s.id);
  });
  for (const id of Object.keys(rects)) if (!seen.has(id)) delete rects[id];
  placeholderRect = order.length ? null : { x: left + usable / 2 - w / 2, w, cx: left + usable / 2, y: soilY, h: 52, scale: Math.min(1, w / 200) };
}

// ---------- particles ----------
function spawn(kind, text, sid) {
  const r = sid && rects[sid];
  const count = { rain: 4, sun: 1, wind: 1, cloud: 1, bird: 1, mote: 1 }[kind] || 1;
  for (let i = 0; i < count; i++) {
    const p = { kind, text, age: 0, life: 1, size: 11, sid };
    switch (kind) {
      case 'rain':
        p.x = r ? r.cx + (Math.random() - 0.5) * r.w * 1.6 + 30 : Math.random() * W; p.y = -20 - Math.random() * 140;
        p.vx = -10 - Math.random() * 20; p.vy = 150 + Math.random() * 120; p.life = 8; p.size = 10 + Math.random() * 3;
        break;
      case 'sun':
        p.x = (r ? r.cx : W * 0.5) + (Math.random() - 0.5) * 120; p.y = soilY - 10;
        p.vx = (Math.random() - 0.5) * 20; p.vy = -32 - Math.random() * 25; p.life = 4.5;
        break;
      case 'wind':
        // commands travel as lane lines; the wind itself is only felt in the sway
        fly('$ ' + text, '#e9eef5');
        return;
      case 'cloud':
        // clouds are weather; the helper's task flies as a lane line
        p.text = ''; p.x = -180; p.y = 30 + Math.random() * 40; p.vx = 18 + Math.random() * 10; p.vy = 0; p.life = (W + 380) / p.vx;
        break;
      case 'bird':
        // the bird is a catchable creature; what it carries flies as a lane line
        p.text = ''; p.x = W + 40; p.y = LANE_TOP + LANES * LANE_H + 20 + Math.random() * 60; p.vx = -(70 + Math.random() * 40); p.vy = 0;
        p.life = (W + 220) / -p.vx; p.phase = Math.random() * 6; p.catchable = true;
        break;
      default:
        p.x = r ? r.cx + (Math.random() - 0.5) * 80 : Math.random() * W; p.y = H * 0.3 + Math.random() * H * 0.3; p.vx = 0; p.vy = -15; p.life = 3;
    }
    particles.push(p);
  }
  if (particles.length > 400) particles.splice(0, particles.length - 400);
}

// The log strip at the bottom of the board: tool results with their detail, and events.
const boardLog = [];
function pushTicker(text, cls, detail) {
  const t = new Date();
  const hh = String(t.getHours()).padStart(2, '0'), mm = String(t.getMinutes()).padStart(2, '0'), ss = String(t.getSeconds()).padStart(2, '0');
  boardLog.push({ t: hh + ':' + mm + ':' + ss, text, cls: cls || '', detail: detail || '' });
  if (boardLog.length > 60) boardLog.shift();
  const box = $('board-log');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const d = document.createElement('div'); d.className = cls || '';
  const ts = document.createElement('span'); ts.className = 't'; ts.textContent = hh + ':' + mm + ':' + ss; d.appendChild(ts);
  d.appendChild(document.createTextNode(text)); d.title = text + (detail ? '\n' + detail : '');
  box.appendChild(d);
  if (detail) { const dd = document.createElement('div'); dd.className = 'detail'; dd.textContent = detail; dd.title = detail; box.appendChild(dd); }
  while (box.children.length > 120) box.removeChild(box.firstChild);
  if (nearBottom) box.scrollTop = box.scrollHeight;
}
let activityText = '';
function setActivity(text) { activityText = text; $('activity').textContent = text; }
// While a tool call is still running, say so with a clock, and keep its weather up.
const TOOL_WEATHER = [[/^(Grep|Glob|Read|LS)$/, 'rain'], [/^(Edit|Write|MultiEdit|NotebookEdit)$/, 'sun'], [/^(Bash|PowerShell)$/, 'wind'], [/^(Agent|Task|Workflow)$/, 'cloud'], [/browser|navigate|WebFetch|WebSearch|^mcp__/i, 'bird']];
function pendingWeather() {
  const held = new Set();
  for (const s of liveSessions()) {
    const pt = s.pendingTool; if (!pt || !pt.since) continue;
    for (const [re, k] of TOOL_WEATHER) if (re.test(pt.name)) held.add(k);
  }
  return held;
}
function updateActivityClock() {
  const s = focused(); const pt = s && s.pendingTool;
  if (pt && pt.since && Date.now() - pt.since > 4000) {
    const sec = Math.floor((Date.now() - pt.since) / 1000);
    const clock = sec >= 60 ? Math.floor(sec / 60) + 'm ' + (sec % 60) + 's' : sec + 's';
    $('activity').textContent = sessionLabel(s) + ' · still running ' + prettyTool(pt.name) + (pt.text ? ' · ' + oneLine(pt.text, 50) : '') + ' · ' + clock;
  } else if ($('activity').textContent !== activityText) {
    $('activity').textContent = activityText;
  }
}

// ---------- flying lines: small facts cross the sky in lanes that never overlap ----------
const LANES = 6, LANE_TOP = 140, LANE_H = 24, LINE_SPEED = 95, LINE_GAP = 60;
const lanes = Array.from({ length: LANES }, () => []);
function fly(text, color) {
  ctx.font = '12px Consolas, "Cascadia Mono", monospace';
  const w = ctx.measureText(text).width + 12;
  // pick the lane whose newest line has travelled the furthest from the right edge
  // lines appear from behind the board's left edge and cross the open sky
  const edge = W - Math.min(320, W - 20) - 10;
  let best = 0, bestGap = -Infinity;
  for (let i = 0; i < LANES; i++) {
    const last = lanes[i][lanes[i].length - 1];
    const gap = last ? (edge - (last.x + last.w)) : Infinity;
    if (gap > bestGap) { bestGap = gap; best = i; }
  }
  const lane = lanes[best];
  const last = lane[lane.length - 1];
  // spawn behind the previous line with a gap, so same-speed lines can never touch
  const x = Math.max(edge, last ? last.x + last.w + LINE_GAP : edge);
  const p = { kind: 'line', text, color, x, y: LANE_TOP + best * LANE_H + LANE_H / 2, w, lane: best, age: 0, life: 1e9, vx: -LINE_SPEED, vy: 0, size: 12 };
  lane.push(p); particles.push(p);
}
function tickLanes(dt) {
  for (let i = 0; i < LANES; i++) {
    const lane = lanes[i];
    // a backlog makes the whole lane speed up together, spacing preserved
    const factor = Math.min(2.4, 1 + 0.2 * Math.max(0, lane.length - 2));
    for (const p of lane) p.vx = -LINE_SPEED * factor;
    for (let k = lane.length - 1; k >= 0; k--) if (lane[k].x + lane[k].w < -20) { lane[k].life = 0; lane.splice(k, 1); }
  }
}

// ---------- earning ----------
function earn(sid, amount, x, y, label, cls, source) {
  const p = plantFor(sid);
  p.sap += amount; garden.sap += amount; garden.lifetime += amount; garden.runLifetime = (garden.runLifetime || 0) + amount;
  record(source || 'click', amount);
  if (x != null) floaters.push({ x, y, text: (label || '+') + fmt(amount), age: 0, cls: cls || '' });
}

function addPest(sid) {
  if (!sid || !plants[sid]) return;
  if (pests.filter((p) => p.sid === sid).length >= 3) return;
  pests.push({ sid, since: Date.now(), x: (Math.random() - 0.5) * 0.6, flap: Math.random() * 6 });
}
function pestsOn(sid) { return pests.filter((p) => p.sid === sid).length; }

function windowMult(sid) {
  let m = 1, why = '';
  if (sunbeams[sid] && sunbeams[sid] > Date.now()) { m *= sunbeamMult(); why = W_('sunbeam'); }
  if (lastRain[sid] && Date.now() - lastRain[sid] < puddleMs()) { m *= puddleMult(); why = why ? why + '+' + W_('puddle') : W_('puddle'); }
  return { m, why };
}

// ---------- event ingestion ----------
function ingest(ev, quiet) {
  lastEventAt = Date.now();
  garden.events++;
  const who = sessionName(ev);
  const sid = ev.session_id;
  const name = ev.hook_event_name;
  if (name === 'PreToolUse') {
    const c = classify(ev);
    const plant = sid ? plantFor(sid) : null;
    if (c.kind !== 'mote') weather[c.kind] = Math.min(1, weather[c.kind] + 0.35);
    if (plant) {
      // Every tool call feeds all three meters a little, so the plant is not at the
      // mercy of the tool mix (a whole day showed nine reads); the kind adds its bonus.
      const base = has('feeder') ? 6 : 3;
      feed(plant, base, base, base);
      if (c.kind === 'rain') { feed(plant, 6, 0, 0); if (!quiet) lastRain[sid] = Date.now(); }
      else if (c.kind === 'sun') { feed(plant, 0, 8, 0); if (!quiet) sunbeams[sid] = Date.now() + sunbeamSeconds() * 1000; }
      else if (c.kind === 'wind') { feed(plant, 4, 0, has('compost') ? 16 : 8); }
      // Claude's own work feeds the plant a little, so it grows while you watch
      if (!quiet) { const r = rects[sid]; earn(sid, TUNING.burst * passivePower() * yieldMult(plant) * meterFactor(plant), r ? r.cx + 40 : null, r ? r.y - 60 : null, '☁ +', '', 'burst'); }
    }
    if (!quiet) spawn(c.kind, c.text, sid);
    const label = prettyTool(ev.tool_name);
    setActivity(who + ' · ' + label + (c.text && c.text !== ev.tool_name && c.text !== label.split(': ').pop() ? ' · ' + c.text : ''));
    if (!quiet && (c.kind === 'cloud' || c.kind === 'bird')) fly((c.kind === 'cloud' ? 'helper: ' : '') + c.text, TAG_COLORS[c.kind === 'cloud' ? 'agent' : 'web']);
  } else if (name === 'PostToolUse') {
    if (!quiet && sid && /^(Bash|PowerShell)$/.test(ev.tool_name || '')) celebrateCommand(sid, (ev.tool_input && ev.tool_input.command) || '');
    const s = ev.summary;
    if (s) {
      pushTicker(who + ' · ' + s.text, s.icon === 'fail' ? 'alert' : '', s.detail);
      addEntry(sid, 'tool', s.text, s.detail);
      // only results that add something fly; a read's filename already fell as rain
      if (!quiet && /^(edit|write|search|shell|agent|fail|ask)$/.test(s.icon)) fly(s.text + (s.detail && s.icon === 'shell' ? ' → ' + oneLine(s.detail, 40) : ''), TAG_COLORS[s.icon] || TAG_COLORS.tool);
    }
  } else if (name === 'PostToolUseFailure') {
    if (!quiet) addPest(sid);
    const s = ev.summary || { text: prettyTool(ev.tool_name || 'tool') + ' failed', detail: '' };
    pushTicker(who + ' · ' + s.text + (quiet ? '' : ' · ' + W_('crowLanded')), 'alert', s.detail);
    addEntry(sid, 'fail', s.text, s.detail);
    if (!quiet) fly(s.text, TAG_COLORS.fail);
  } else if (name === 'UserPromptSubmit') {
    dawnFlash = Math.max(dawnFlash, 0.8);
    if (sid && typeof ev.prompt === 'string') plantFor(sid).prompt = ev.prompt;
    pushTicker('you → ' + who + ': ' + oneLine(ev.prompt, 90), 'you');
    setActivity('you sent a prompt to ' + who);
    addEntry(sid, 'you', ev.prompt || '');
  } else if (name === 'Stop') {
    pushTicker(who + ' · Claude finished its turn', 'you');
    setActivity('Claude finished in ' + who);
    addEntry(sid, 'event', 'Claude finished its turn');
  } else if (name === 'Notification') {
    pushTicker(who + ' · ' + oneLine(ev.message || ev.notification_type || 'notification', 90), 'alert');
    addEntry(sid, 'event', ev.message || ev.notification_type || 'notification');
  } else if (name === 'SessionStart') {
    if (sid) plantFor(sid);
    pushTicker(who + ' · session started');
  } else if (name === 'SessionEnd') {
    if (!quiet) harvest(sid, who, true);
    pushTicker(who + ' · session ended');
  } else if (name === 'SubagentStart') {
    weather.cloud = Math.min(1, weather.cloud + 0.4);
    if (!quiet) spawn('cloud', 'subagent', sid);
    pushTicker(who + ' · subagent started');
  } else if (name === 'SubagentStop') {
    pushTicker(who + ' · subagent finished');
  } else if (name === 'PreCompact') {
    pushTicker(who + ' · night falls: compacting context', 'you');
    setActivity('compacting context in ' + who);
    addEntry(sid, 'event', 'night falls: compacting context');
  } else if (name === 'PostCompact') {
    dawnFlash = 1.6;
    pushTicker(who + ' · a new day: context compacted', 'you');
    setActivity('a new day in ' + who);
    addEntry(sid, 'day', 'a new day');
  }
}

function ingestNote(n, quiet) {
  if (!n || !n.session_id || !n.text) return;
  const thought = n.kind === 'thought';
  addEntry(n.session_id, thought ? 'thought' : 'claude', n.text, '', thought ? '' : md(n.text));
}

const TAG_COLORS = { edit: '#ffcb5c', write: '#ffcb5c', read: '#5aa9ff', search: '#5aa9ff', shell: '#e9eef5', fail: '#ff8f4d', agent: '#c7b3ff', web: '#9ad9a8', ask: '#ff8f4d', tool: '#c7d2e0' };

// The plant grows on its own, one stage per STAGE_MINUTES of healthy time, and
// it is healthy while its meters are up, which is Claude's work. Clicks do not
// grow it; they draw sap from it, and a bigger plant gives more per click.
// Harvest trades that multiplier for permanent seeds: the real decision.
const STAGE_MINUTES = 2;
// A parched plant still grows at a quarter speed; full meters mean full speed.
function growthSpeed(p) { return 0.25 + 0.75 * Math.max(0, Math.min(1, (meterFactor(p) - 0.4) / 0.5)); }
function plantStage(p) { return Math.floor((p.grown || 0) / (STAGE_MINUTES * 60000)); }
function plantProgress(p) { const t = (p.grown || 0) / (STAGE_MINUTES * 60000); return t - Math.floor(t); }
function nextStageIn(p) { const speed = growthSpeed(p); if (speed <= 0) return null; const ms = (plantStage(p) + 1) * STAGE_MINUTES * 60000 - (p.grown || 0); return Math.max(0, Math.ceil(ms / 1000 / speed)); }
const yieldMult = (p) => (1 + 0.3 * plantStage(p)) * speciesOf(p).yield;
// Harvest pays one seed at fruiting and one more per stage beyond it.
function seedsFor(p) { const s = plantStage(p); return s < FRUITING ? 0 : 1 + (s - FRUITING); }
function harvest(sid, who, auto) {
  const p = sid && plants[sid];
  if (!p) return;
  const gained = seedsFor(p);
  const stage = stageName(plantStage(p));
  garden.seeds += gained; garden.harvests++;
  const r = rects[sid];
  if (r) floaters.push({ x: r.cx, y: soilY - 40, text: gained ? '+' + gained + ' ' + (gained > 1 ? W_('seeds') : W_('seed')) : W_('nothingToHarvest'), age: 0, cls: 'crit' });
  pushTicker(who + ' · ' + W_('harvested') + ' a ' + stage + ' ' + W_('plant') + ' for ' + gained + ' ' + (gained === 1 ? W_('seed') : W_('seeds')), 'you');
  ledger.seeds += gained;
  recordEvent((auto ? 'session ended: ' : '') + W_('harvested') + ' ' + stage + ' ' + W_('plant') + ' in ' + who + ' (' + fmt(p.sap) + ' ' + W_('sap') + ') for ' + gained + ' ' + (gained === 1 ? W_('seed') : W_('seeds')), gained);
  if (auto) delete plants[sid];
  else {
    p.sap = 0; p.grown = 0; p.clicks = 0; p.born = Date.now(); p.species = pickSpecies();
    const sp = SPECIES[p.species];
    pushTicker(who + ' · a ' + speciesName(sp).toLowerCase() + ' ' + W_('sprouted') + ' (' + RARITY[sp.rarity].name.toLowerCase() + ')', sp.rarity === 'common' ? 'you' : 'ok');
    recordEvent('replanted: ' + speciesName(sp) + ' (' + RARITY[sp.rarity].name + ')', 0);
    if (r) floaters.push({ x: r.cx, y: soilY - 70, text: speciesName(sp) + ' · ' + RARITY[sp.rarity].name, age: 0, cls: sp.rarity === 'common' ? '' : 'crit' });
  }
}

// ---------- mode / attention ----------
// A session that was working but has sent nothing for this long, with no Stop,
// is probably stopped by a usage limit or a dialog in the app.
const QUIET_MS = 3 * 60 * 1000;
function isStalled(s) { return s.status === 'working' && Date.now() - (s.lastSeen || 0) > QUIET_MS && !(s.pendingTool && s.pendingTool.since && /^(Agent|Task|Workflow)$/.test(s.pendingTool.name)); }
function computeMode() {
  const now = Date.now();
  const live = liveSessions();
  let m = 'idle';
  if (live.some((s) => s.status === 'needs_you')) m = 'needs_you';
  else if (live.some((s) => s.status === 'limit' || isStalled(s))) m = 'stalled';
  else if (live.some((s) => s.status === 'working' && now - s.lastSeen < 10 * 60 * 1000)) m = 'working';
  else if (live.some((s) => s.status === 'your_turn')) m = 'your_turn';
  if (m !== mode) { mode = m; onModeChange(m); }
}
function onModeChange(m) {
  if (m === 'needs_you') chime(880, 1320);
  else if (m === 'stalled') { chime(520, 390); pushTicker('Claude has gone quiet mid-task: check the app for a usage limit or a dialog', 'alert'); }
  updateHud();
}

let audio = null;
function chime(f1, f2) {
  if (!prefs.sound) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audio.currentTime;
    [f1, f2].forEach((f, i) => {
      const o = audio.createOscillator(); const g = audio.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.18 + 0.5);
      o.connect(g).connect(audio.destination);
      o.start(t0 + i * 0.18); o.stop(t0 + i * 0.18 + 0.55);
    });
  } catch { /* audio blocked */ }
}

// ---------- HUD ----------
const MODE_LABEL = { working: 'Claude is working', needs_you: 'Claude needs you', your_turn: 'Claude is idle', idle: 'quiet', stalled: 'Claude went quiet: check the app' };
let closed = false;   // the server was stopped from the Quit button
let lastPillSig = '';
let shopSig = '';
function updateHud() {
  const status = $('status');
  const focHeld = focused() && pendingHolds[focused().id];
  status.className = 'pill ' + (connected ? (mode === 'your_turn' && focHeld ? 'your_turn' : mode) : 'offline');
  status.textContent = closed ? W_('place') + ' closed' : connected ? (mode === 'your_turn' && focHeld ? 'Claude is idle · desk is open' : MODE_LABEL[mode]) : 'server offline';
  if (!armed.quit && $('quit').textContent !== 'Quit') $('quit').textContent = 'Quit';
  document.title = mode === 'needs_you' ? '⚠ Claude needs you' : unread ? '✉ Claude asked you something' : mode === 'stalled' ? '⚠ Claude went quiet' : W_('title');
  $('board').style.bottom = ($('panel').offsetHeight + 20) + 'px';
  if (focused() && focused().id !== boardSid) renderBoard();

  const foc = focused();
  const live = liveSessions().sort((a, b) => b.lastSeen - a.lastSeen);
  const pillSig = live.map((s) => s.id + ':' + s.status + ':' + (foc && foc.id === s.id ? 1 : 0) + ':' + (s.context && s.context.window ? Math.round(100 * s.context.tokens / s.context.window) : '-') + ':' + (s.night ? 1 : 0) + ':' + sessionLabel(s)).join('|');
  const box = $('sessions');
  if (pillSig !== lastPillSig) {
  lastPillSig = pillSig;
  box.innerHTML = '';
  live.forEach((s) => {
    const el = document.createElement('div'); el.className = 'pill session ' + s.status + (foc && foc.id === s.id ? ' focused' : '');
    const dot = document.createElement('span'); dot.className = 'dot'; el.appendChild(dot);
    el.appendChild(document.createTextNode(sessionLabel(s)));
    if (s.context && s.context.window) {
      const pct = Math.round(100 * s.context.tokens / s.context.window);
      const c = document.createElement('span'); c.className = 'ctx'; c.textContent = (s.night ? '☽' : '☀') + ' ' + pct + '%'; el.appendChild(c);
    }
    el.title = s.cwd + ' · ' + s.status + (s.context ? ' · ' + Math.round(s.context.tokens / 1000) + 'K of ' + Math.round(s.context.window / 1000) + 'K context' : '') + ' · click to focus';
    el.addEventListener('click', () => setFocus(s.id));
    box.appendChild(el);
  });
  }

  const fs = focused();
  if (fs && fs.context && fs.context.window) {
    const pct = 100 * fs.context.tokens / fs.context.window;
    $('context').style.width = pct.toFixed(1) + '%';
    $('context-label').textContent = (fs.night ? 'compacting ' : 'context ') + Math.round(pct) + '%';
    $('context-row').title = Math.round(fs.context.tokens / 1000) + 'K of ' + Math.round(fs.context.window / 1000) + 'K tokens in ' + sessionLabel(fs) + '. Sunset at ' + Math.round(compactAt * 100) + '%, when compaction is due.';
  } else {
    $('context').style.width = '0%';
    $('context-label').textContent = 'context';
  }

  const plant = fs && plants[fs.id];
  $('sap').textContent = fmt(garden.sap);
  const cm = 1 + combo * (comboCap() - 1);
  const wm = fs ? windowMult(fs.id) : { m: 1, why: '' };
  const perClick = plant ? clickPower() * yieldMult(plant) * meterFactor(plant) * cm * wm.m : clickPower();
  $('power').textContent = fmt(perClick) + ' per click' + (wm.why ? ' · ' + wm.why + ' ×' + wm.m : '');
  $('combo').style.width = (combo * 100).toFixed(1) + '%';
  $('combo-label').textContent = 'combo ×' + cm.toFixed(1);
  $('water').style.width = (plant ? 100 * plant.water / waterCap() : 0).toFixed(1) + '%';
  $('light').style.width = (plant ? plant.light : 0).toFixed(1) + '%';
  $('nutrients').style.width = (plant ? plant.nutrients : 0).toFixed(1) + '%';
  const si = plant ? plantStage(plant) : 0;
  const pestCount = fs ? pestsOn(fs.id) : 0;
  const wait = plant ? nextStageIn(plant) : null;
  const thirsty = plant && growthSpeed(plant) <= 0;
  const sp = plant ? speciesOf(plant) : null;
  $('stage').textContent = plant ? stageName(si) + ' ×' + yieldMult(plant).toFixed(1) + (pestCount ? ' 🐦' : '') + (thirsty ? ' 🥵' : '') : 'no ' + W_('plant');
  $('stage').style.color = sp && sp.rarity !== 'common' ? RARITY[sp.rarity].color : '';
  $('stage').title = plant ? speciesName(sp) + ' (' + RARITY[sp.rarity].name + '): ' + speciesBlurb(sp) + ' This ' + stageName(si) + ' ' + W_('plant') + ' multiplies every click by ' + yieldMult(plant).toFixed(1) + '. ' + (thirsty ? 'It is not growing: its meters are too low. Claude’s reads, writes, and commands fill them.' : wait != null ? 'Next stage in about ' + Math.floor(wait / 60) + 'm ' + (wait % 60) + 's at the current meters.' : '') + ' Harvest trades the multiplier for permanent seeds and a new random plant.' : '';
  $('growth').style.width = (plant ? plantProgress(plant) * 100 : 0).toFixed(1) + '%';
  const owned = ITEMS.filter((u) => has(u.id)).length;
  $('seeds').textContent = garden.seeds + ' ' + (garden.seeds === 1 ? W_('seed') : W_('seeds')) + ' (+' + Math.round((seedBonus() - 1) * 100) + '% clicks) · ' + fmt(garden.lifetime) + ' lifetime ' + W_('sap') + ' · ' + owned + '/' + ITEMS.length + ' items' + (garden.legacy || achievementCount() ? ' · legacy +' + Math.round((legacyMult() - 1) * 100) + '%' : '') + (isWriter ? '' : adoptedRemote ? ' · mirroring another window' : '');
  const shopLabel = 'Shop' + (ITEMS.some((u) => lvl(u.id) < u.max && garden.sap >= costOf(u)) ? ' •' : '');
  if ($('shop-open').textContent !== shopLabel) $('shop-open').textContent = shopLabel;
  const hv = $('harvest');
  const ready = plant && si >= FRUITING;
  hv.disabled = !ready;
  hv.classList.toggle('ready', Boolean(ready));
  const hvLabel = ready ? W_('harvest') + ' +' + seedsFor(plant) : W_('harvest');
  if (!hv.classList.contains('armed') && hv.textContent !== hvLabel) hv.textContent = hvLabel;
  hv.title = plant ? (ready ? W_('harvest') + ' this ' + stageName(si) + ' ' + W_('plant') + ' for ' + seedsFor(plant) + ' ' + W_('seeds') + ' and start over from a ' + W_('seed') + '. You lose its ×' + yieldMult(plant).toFixed(1) + ' click multiplier; you keep the ' + W_('seeds') + ' forever.' : 'A ' + W_('plant') + ' can be ' + W_('harvested') + ' once it is ' + W_('stages')[FRUITING] + ', about ' + (FRUITING * STAGE_MINUTES) + ' minutes of healthy growth.') : '';
  if (!$('shop').classList.contains('hidden')) renderShop();

  const pauseBtn = $('pause');
  const pauseLabel = paused ? 'Resume Claude' : 'Pause Claude';
  if (pauseBtn.textContent !== pauseLabel) pauseBtn.textContent = pauseLabel;
  pauseBtn.classList.toggle('on', paused);
  const soundLabel = 'Sound: ' + (prefs.sound ? 'on' : 'off');
  if ($('sound').textContent !== soundLabel) $('sound').textContent = soundLabel;

  const att = $('attention');
  if (closed) {
    att.className = 'calm'; att.style.pointerEvents = 'none';
    $('attention-title').textContent = 'The ' + W_('place') + ' is closed';
    $('attention-note').textContent = 'Its server has stopped. It starts again with your next Claude session, or with npm start.';
  } else if (connected && mode === 'needs_you') {
    att.className = ''; att.style.pointerEvents = 'none';
    $('attention-title').textContent = 'Claude needs you';
    const s = liveSessions().find((x) => x.status === mode);
    $('attention-note').textContent = s ? sessionLabel(s) + (s.note ? ' · ' + s.note : '') : '';
  } else if (connected && mode === 'stalled') {
    att.className = 'calm'; att.style.pointerEvents = 'none';
    const s = liveSessions().find((x) => x.status === 'limit') || liveSessions().find(isStalled);
    const limit = s && s.status === 'limit';
    $('attention-title').textContent = limit ? 'Waiting for the usage limit to reset' : 'Claude has gone quiet';
    $('attention-note').textContent = s ? sessionLabel(s) + ' · ' + (limit ? (s.note || 'it will continue on its own') : 'no word for ' + Math.round((Date.now() - s.lastSeen) / 60000) + ' min and no turn ended. A usage limit or a dialog in the app may be holding it.') : '';
  } else if (connected && unread > 0 && !(isLetterOpen() && !isToast())) {
    att.className = 'calm'; att.style.pointerEvents = 'auto'; att.style.cursor = 'pointer';
    const l = [...letters].reverse().find((x) => !readIds.has(x.id)) || letters[letters.length - 1];
    $('attention-title').textContent = unread === 1 ? 'Claude needs an answer' : unread + ' letters need answers';
    $('attention-note').textContent = (l ? base(l.cwd) + ' · ' : '') + 'click to read and reply';
  } else {
    att.className = 'hidden';
  }
  updateHoldLine();
}
function setFocus(id) {
  if (stickyFocus && focusId === id) stickyFocus = false;
  else { stickyFocus = true; focusId = id; }
  updateHud();
}

// ---------- shop ----------
let shopCat = 'tool';
function renderShop(force) {
  $('shop-seeds').textContent = fmt(garden.sap) + ' ' + W_('sap');
  // Rebuild rows only when a level or an affordability changes, so buttons stay
  // stable under the mouse (a rebuilt button cannot be clicked).
  const sig = shopCat + '|' + theme.id + '|' + ITEMS.map((u) => lvl(u.id) + (garden.sap >= costOf(u) ? 'a' : 'x')).join(',') + '|' + Object.keys(THEMES).map((id) => (themeOwned(id) ? 'o' : garden.sap >= THEMES[id].price ? 'a' : 'x')).join('');
  const list = $('shop-list');
  if (!force && sig === shopSig && list.children.length) return;
  shopSig = sig;
  for (const b of $('shop-tabs').querySelectorAll('button')) b.classList.toggle('on', b.dataset.cat === shopCat);
  list.innerHTML = '';
  if (shopCat === 'theme') {
    for (const th of Object.values(THEMES)) {
      if (!th || !th.id) continue;
      const owned = themeOwned(th.id), inUse = theme.id === th.id;
      const row = document.createElement('div'); row.className = 'upgrade' + (owned ? ' owned' : '');
      const icon = document.createElement('div'); icon.className = 'icon'; icon.textContent = th.icon || '🎨'; row.appendChild(icon);
      const text = document.createElement('div'); text.className = 'text';
      const name = document.createElement('div'); name.className = 'name'; name.textContent = th.name;
      const desc = document.createElement('div'); desc.className = 'desc'; desc.textContent = th.blurb || '';
      text.appendChild(name); text.appendChild(desc); row.appendChild(text);
      const btn = document.createElement('button');
      btn.textContent = !owned ? fmt(th.price) + ' ' + W_('sap') : inUse ? 'In use' : 'Use';
      btn.disabled = owned ? inUse : garden.sap < th.price;
      btn.addEventListener('click', () => {
        if (!themeOwned(th.id)) {
          if (garden.sap < th.price) return;
          claimWriter();
          garden.sap -= th.price; garden.levels['theme:' + th.id] = 1; ledger.spent += th.price;
          recordEvent('bought the ' + th.name.toLowerCase() + ' theme for ' + fmt(th.price) + ' ' + W_('sap'), -th.price);
          saveJSON(SAVE_KEY, garden);
          pushTicker('you bought the ' + th.name.toLowerCase() + ' theme', 'you');
        }
        applyTheme(th.id);
        pushTicker('theme: ' + theme.name, 'you');
        renderShop(true); updateHud();
      });
      row.appendChild(btn);
      list.appendChild(row);
    }
    return;
  }
  for (const u of ITEMS) {
    if (u.cat !== shopCat) continue;
    const n = lvl(u.id), maxed = n >= u.max, cost = costOf(u);
    const row = document.createElement('div'); row.className = 'upgrade' + (n > 0 ? ' owned' : '');
    const icon = document.createElement('div'); icon.className = 'icon'; icon.textContent = itemIcon(u); row.appendChild(icon);
    const text = document.createElement('div'); text.className = 'text';
    const name = document.createElement('div'); name.className = 'name';
    name.textContent = itemName(u) + (u.max > 1 ? ' ' : '') ;
    if (u.max > 1) { const l = document.createElement('span'); l.className = 'lvl'; l.textContent = 'lv ' + n + (u.max < 999 ? '/' + u.max : ''); name.appendChild(l); }
    const desc = document.createElement('div'); desc.className = 'desc';
    desc.textContent = itemDesc(u) + (u.cat === 'tool' && n ? ' Now +' + fmt(toolPower(u)) + '.' + (n < 10 ? ' Doubles at level 10.' : n < 25 ? ' Doubles again at 25.' : n < 50 ? ' Doubles again at 50.' : '') : '');
    text.appendChild(name); text.appendChild(desc); row.appendChild(text);
    const btn = document.createElement('button');
    btn.textContent = maxed ? (u.max === 1 ? 'Owned' : 'Maxed') : fmt(cost) + ' ' + W_('sap');
    btn.disabled = maxed || garden.sap < cost;
    btn.addEventListener('click', () => {
      if (lvl(u.id) >= u.max || garden.sap < costOf(u)) return;
      const paid = costOf(u);
      claimWriter();
      garden.sap -= paid; garden.levels[u.id] = lvl(u.id) + 1;
      ledger.spent += paid;
      recordEvent('bought ' + itemName(u).toLowerCase() + (u.max > 1 ? ' lv ' + lvl(u.id) : '') + ' for ' + fmt(paid) + ' ' + W_('sap'), -paid);
      saveJSON(SAVE_KEY, garden);
      pushTicker('you bought ' + itemName(u).toLowerCase() + (u.max > 1 ? ' lv ' + lvl(u.id) : ''), 'you');
      renderShop(true); updateHud();
    });
    row.appendChild(btn);
    list.appendChild(row);
  }
}
// ---------- journal ----------
function renderJournal() {
  const s = focused();
  const list = $('journal-list'); list.innerHTML = '';
  $('journal-meta').textContent = s ? sessionLabel(s) + ' · ' + s.cwd : 'no session';
  const entries = (s && journal[s.id]) || [];
  if (!entries.length) { const d = document.createElement('div'); d.className = 'entry event'; d.innerHTML = '<div class="what">Nothing yet. Prompts, what Claude says, and what each tool did will appear here as they happen.</div>'; list.appendChild(d); return; }
  for (const e of entries) {
    const row = document.createElement('div'); row.className = 'entry ' + e.kind;
    if (e.kind === 'day') { row.textContent = '☀ ' + e.text; list.appendChild(row); continue; }
    const when = document.createElement('div'); when.className = 'when';
    const d = new Date(e.at); when.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
    const what = document.createElement('div'); what.className = 'what';
    if (e.kind === 'claude') what.innerHTML = e.html || md(e.text);
    else if (e.kind === 'thought' || e.kind === 'you') what.textContent = e.text;
    else {
      what.textContent = e.text;
      if (e.detail) { const dd = document.createElement('div'); dd.className = 'detail'; dd.textContent = e.detail; what.appendChild(dd); }
    }
    row.appendChild(when); row.appendChild(what); list.appendChild(row);
  }
  list.scrollTop = list.scrollHeight;
}
// ---------- stats ----------
function renderStats() {
  const now = Date.now();
  const last5 = sumSince(5 * 60000), last60 = sumSince(60 * 60000);
  const tot = (o) => SOURCES.reduce((a, s) => a + (o[s] || 0), 0);
  const firstMin = ledger.minutes.length ? ledger.minutes[0].m : Math.floor(now / 60000);
  const spanMin = Math.max(1, Math.floor(now / 60000) - firstMin + 1);
  $('stats-meta').textContent = 'tracking since ' + new Date(firstMin * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + spanMin + ' min';

  const tiles = [
    [fmt(garden.sap), W_('sap') + ' in hand'],
    [fmt(tot(last5) / 5) + '/min', 'income, last 5 min'],
    [fmt(tot(last60) / Math.min(60, spanMin)) + '/min', 'income, last hour'],
    [(last5.clicks / 5).toFixed(1) + '/min', 'clicks, last 5 min'],
    [fmt(clickPower()), 'click power'],
    [garden.seeds + ' (' + ledger.seeds + ' earned)', W_('seeds')],
  ];
  $('stats-rates').innerHTML = tiles.map(([v, k]) => '<div class="tile"><div class="v">' + esc(v) + '</div><div class="k">' + esc(k) + '</div></div>').join('');

  // stacked bars for the last 60 minutes
  const c = $('stats-chart'); const cx = c.getContext('2d');
  cx.clearRect(0, 0, c.width, c.height);
  const cur = Math.floor(now / 60000);
  const cols = 60, pad = 28, w = (c.width - pad - 8) / cols;
  const byMin = new Map(ledger.minutes.map((b) => [b.m, b]));
  let max = 1;
  for (let i = 0; i < cols; i++) { const b = byMin.get(cur - cols + 1 + i); if (b) max = Math.max(max, tot(b)); }
  cx.font = '10px Segoe UI, system-ui, sans-serif'; cx.fillStyle = '#8a8070'; cx.textAlign = 'right';
  cx.fillText(fmt(max), pad - 4, 10); cx.fillText('0', pad - 4, c.height - 14);
  cx.strokeStyle = 'rgba(0,0,0,0.12)'; cx.beginPath(); cx.moveTo(pad, c.height - 12); cx.lineTo(c.width - 8, c.height - 12); cx.stroke();
  for (let i = 0; i < cols; i++) {
    const m = cur - cols + 1 + i; const b = byMin.get(m); if (!b) continue;
    let y = c.height - 12;
    for (const s of SOURCES) {
      const h = (b[s] || 0) / max * (c.height - 26); if (h <= 0) continue;
      cx.fillStyle = SOURCE_COLORS[s]; cx.fillRect(pad + i * w + 1, y - h, Math.max(1, w - 2), h); y -= h;
    }
  }
  cx.fillStyle = '#8a8070'; cx.textAlign = 'left'; cx.fillText('60 min ago', pad, c.height - 2); cx.textAlign = 'right'; cx.fillText('now', c.width - 8, c.height - 2);
  $('stats-legend').innerHTML = SOURCES.map((s) => '<span style="--c:' + SOURCE_COLORS[s] + '">' + s + '</span>').join('');

  const rows = SOURCES.map((s) => [s, ledger.totals[s] || 0, last60[s] || 0, last5[s] || 0]);
  const T = [tot(ledger.totals), tot(last60), tot(last5)];
  let html = '<tr><th>source</th><th>all time</th><th>share</th><th>last hour</th><th>last 5 min</th></tr>';
  for (const [s, a, h, f] of rows) html += '<tr><td>' + s + '</td><td>' + fmt(a) + '</td><td>' + (T[0] ? Math.round(100 * a / T[0]) : 0) + '%</td><td>' + fmt(h) + '</td><td>' + fmt(f) + '</td></tr>';
  html += '<tr><th>earned</th><th>' + fmt(T[0]) + '</th><th></th><th>' + fmt(T[1]) + '</th><th>' + fmt(T[2]) + '</th></tr>';
  html += '<tr><td>spent in shop</td><td>' + fmt(ledger.spent) + '</td><td></td><td></td><td></td></tr>';
  html += '<tr><td>clicks / crits</td><td>' + garden.clicks + ' / ' + garden.crits + '</td><td></td><td>' + last60.clicks + ' / ' + last60.crits + '</td><td>' + last5.clicks + ' / ' + last5.crits + '</td></tr>';
  if (garden.held) html += '<tr><td>of which held (mouse saver)</td><td>' + garden.held + '</td><td></td><td>' + last60.held + '</td><td>' + last5.held + '</td></tr>';
  $('stats-table').innerHTML = html;

  const fs = focused(); const p = fs && plants[fs.id];
  const mf = p ? meterFactor(p) : 0;
  $('stats-formula').textContent =
    'click  = power ' + fmt(clickPower()) + ' × plant ×' + (p ? yieldMult(p).toFixed(1) : '1') + ' × meters ' + mf.toFixed(2) + ' × combo (1..' + comboCap() + ') × window (sunbeam ×' + sunbeamMult() + ', puddle ×' + puddleMult() + ') × crit (' + Math.round(critChance() * 100) + '% for ×' + critMult() + ')\n' +
    'trickle = ' + TUNING.trickle + ' × √power × meters per second while Claude works = ' + fmt(TUNING.trickle * passivePower() * mf) + '/s now\n' +
    'burst  = ' + TUNING.burst + ' × √power × meters per tool call Claude makes = ' + fmt(TUNING.burst * passivePower() * mf) + ' each\n' +
    'power  = (1 + tools ' + fmt(toolsPower() - 1) + ') × (1 + 0.25 × √' + garden.seeds + ' seeds = ' + seedBonus().toFixed(2) + ') × legacy ' + legacyMult().toFixed(2) + '\n' +
    'plant  = grows one stage per ' + STAGE_MINUTES + ' healthy minutes (meters above half), ×(1 + 0.3 × stage) on every click; harvest = 1 seed at fruiting + 1 per stage beyond, plant resets';

  $('stats-events').innerHTML = ledger.events.slice(-40).reverse().map((e) => {
    const d = new Date(e.at);
    return '<div><span>' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + '</span>' + esc(e.text) + '</div>';
  }).join('') || '<div>No harvests or purchases yet.</div>';
}
$('stats-open').addEventListener('click', () => { renderStats(); showPanel('stats'); });
$('almanac-open').addEventListener('click', () => { renderAlmanac(); showPanel('almanac'); });
$('almanac-close').addEventListener('click', () => $('almanac').classList.add('hidden'));
$('almanac').addEventListener('click', (e) => { if (e.target === $('almanac')) $('almanac').classList.add('hidden'); });
$('prestige').addEventListener('click', () => armedClick('prestige', 'Sure? ' + W_('prestige'), () => { prestige(); }));
$('stats-close').addEventListener('click', () => $('stats').classList.add('hidden'));
$('stats').addEventListener('click', (e) => { if (e.target === $('stats')) $('stats').classList.add('hidden'); });
setInterval(() => { if (!$('stats').classList.contains('hidden')) renderStats(); }, 5000);

$('journal-open').addEventListener('click', () => { renderJournal(); showPanel('journal'); });
$('journal-close').addEventListener('click', () => $('journal').classList.add('hidden'));
$('journal').addEventListener('click', (e) => { if (e.target === $('journal')) $('journal').classList.add('hidden'); });

// only one panel at a time
const PANELS = ['shop', 'journal', 'stats', 'desk', 'letter', 'almanac'];
function showPanel(id) { for (const p of PANELS) if (p !== id) $(p).classList.add('hidden'); $(id).classList.remove('hidden'); }
$('shop-open').addEventListener('click', () => { renderShop(true); showPanel('shop'); });
$('shop-close').addEventListener('click', () => $('shop').classList.add('hidden'));
$('shop').addEventListener('click', (e) => { if (e.target === $('shop')) $('shop').classList.add('hidden'); });
for (const b of $('shop-tabs').querySelectorAll('button')) b.addEventListener('click', () => { shopCat = b.dataset.cat; renderShop(true); });
// Browser dialogs do not work inside the app's pane, so risky buttons ask twice.
const armed = {};
function armedClick(id, label, action) {
  const btn = $(id);
  if (armed[id] && Date.now() - armed[id] < 4000) { armed[id] = 0; btn.classList.remove('armed'); action(); return; }
  armed[id] = Date.now(); btn.classList.add('armed'); btn.textContent = label;
  setTimeout(() => { if (armed[id] && Date.now() - armed[id] >= 3900) { armed[id] = 0; btn.classList.remove('armed'); updateHud(); } }, 4100);
}
$('quit').addEventListener('click', () => armedClick('quit', 'Sure? Stop the server', async () => {
  try { await fetch('/quit', { method: 'POST' }); } catch { /* already gone */ }
}));
$('harvest').addEventListener('click', () => {
  const s = focused(); const p = s && plants[s.id];
  if (!p || stageIndex(p.sap) < FRUITING) return;
  armedClick('harvest', 'Sure? +' + seedsFor(p) + ' ' + W_('seeds'), () => { claimWriter(); harvest(s.id, sessionLabel(s), false); updateHud(); });
});

// ---------- letters ----------
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}
function md(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let out = ''; let i = 0;
  const isList = (l) => /^\s*([-*]|\d+\.)\s+/.test(l);
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*```/.test(l)) {
      let j = i + 1; const buf = [];
      while (j < lines.length && !/^\s*```/.test(lines[j])) { buf.push(lines[j]); j++; }
      out += '<pre><code>' + esc(buf.join('\n')) + '</code></pre>'; i = j + 1; continue;
    }
    const h = /^(#{1,3})\s+(.*)/.exec(l);
    if (h) { out += '<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'; i++; continue; }
    if (isList(l)) {
      const ordered = /^\s*\d+\./.test(l); const items = [];
      while (i < lines.length && isList(lines[i])) { items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '')); i++; }
      out += (ordered ? '<ol>' : '<ul>') + items.map((x) => '<li>' + inline(x) + '</li>').join('') + (ordered ? '</ol>' : '</ul>');
      continue;
    }
    if (!l.trim()) { i++; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s*```|^#{1,3}\s/.test(lines[i]) && !isList(lines[i])) { para.push(lines[i]); i++; }
    out += '<p>' + para.map(inline).join('<br>') + '</p>';
  }
  return out;
}

function isLetterOpen() { return !$('letter').classList.contains('hidden'); }

function upsertLetter(l, quiet) {
  const idx = letters.findIndex((x) => x.id === l.id);
  if (!l.needsAnswer) {
    // Plain news is already on the board and the desk is open for a reply, so it is
    // never a letter: no mailbox entry, no "waiting for you", just a line in the log.
    if (idx < 0 && !quiet && !l.replied && !l.released) pushTicker(base(l.cwd) + ' · Claude finished its turn · the desk is open', '');
    markRead(l.id);
    return;
  }
  if (idx >= 0) { letters[idx] = l; if (letterIdx === idx) renderLetter(); return; }
  letters.push(l);
  if (letters.length > 40) { letters.shift(); if (letterIdx > 0) letterIdx--; }
  if (!quiet) {
    pushTicker(base(l.cwd) + ' · letter from Claude: it needs an answer', 'you');
    // a question: flag up, banner, chime, and you open it yourself
    unread++;
    chime(660, 880);
    if (isLetterOpen() && letterIdx === letters.length - 2) openLetter(letters.length - 1, isToast());
  } else if (needsAttention(l)) {
    unread++;
  } else {
    markRead(l.id);
  }
}
function isToast() { return $('letter').classList.contains('toast'); }
function replaceLetters(list) {
  const openId = letters[letterIdx] && letters[letterIdx].id;
  letters.length = 0; list.filter((l) => l.needsAnswer).forEach((l) => letters.push(l));
  unread = letters.filter(needsAttention).length;
  if (!letters.length) { letterIdx = -1; closeLetter(); return; }
  const idx = letters.findIndex((l) => l.id === openId);
  letterIdx = idx >= 0 ? idx : Math.min(letterIdx < 0 ? 0 : letterIdx, letters.length - 1);
  if (isLetterOpen()) renderLetter();
  updateHud();
}
async function removeLetter(all) {
  const l = letters[letterIdx];
  if (!all && !l) return;
  try {
    await fetch('/letter/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(all ? { all: true } : { id: l.id }) });
  } catch { /* offline */ }
}

function openLetter(idx, toast) {
  if (!letters.length) return;
  letterIdx = Math.max(0, Math.min(letters.length - 1, idx));
  const l = letters[letterIdx];
  if (!readIds.has(l.id)) { markRead(l.id); unread = Math.max(0, unread - 1); }
  showPanel('letter');
  $('letter').classList.toggle('toast', Boolean(toast));
  $('letter-size').textContent = toast ? '↗' : '↙';
  renderLetter();
  updateHud();
  if (!toast && pendingHolds[l.session_id] && pendingHolds[l.session_id].letterId === l.id) $('reply-text').focus();
}
function closeLetter() { $('letter').classList.add('hidden'); updateHud(); }
$('letter-size').addEventListener('click', () => openLetter(letterIdx, !isToast()));
// keep a timed hold alive while the letter is open
setInterval(() => {
  if (!isLetterOpen()) return;
  const l = letters[letterIdx]; const p = l && holdFor(l);
  if (p && p.until) fetch('/hold/touch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: l.session_id }) }).catch(() => {});
}, 20000);

function renderLetter() {
  const l = letters[letterIdx]; if (!l) return;
  const when = new Date(l.at);
  $('letter-meta').textContent = base(l.cwd) + ' · ' + when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + (l.model ? ' · ' + l.model.replace(/^claude-/, '') : '');
  $('letter-index').textContent = (letterIdx + 1) + ' / ' + letters.length;
  $('letter-prev').disabled = letterIdx <= 0;
  $('letter-next').disabled = letterIdx >= letters.length - 1;
  $('letter-prompt').textContent = l.prompt ? 'You asked: ' + oneLine(l.prompt, 400) : '';
  const earlier = $('letter-earlier');
  if (l.earlier && l.earlier.length) {
    earlier.classList.remove('empty');
    $('letter-earlier-body').innerHTML = l.earlier.map((t) => '<div>' + md(t) + '</div>').join('');
    earlier.querySelector('summary').textContent = 'Earlier in this turn (' + l.earlier.length + ')';
  } else {
    earlier.classList.add('empty');
  }
  let html = l.final ? md(l.final) : '<p class="empty">' + (l.error ? 'Could not read the transcript: ' + esc(l.error) : 'Claude ended the turn without a closing message.') + '</p>';
  if (l.replied) html += '<div class="replied">You replied: ' + esc(l.reply) + '</div>';
  $('letter-final').innerHTML = html;
  updateHoldLine();
}

function holdFor(l) {
  const p = l && pendingHolds[l.session_id];
  return p && p.letterId === l.id ? p : null;
}
function updateHoldLine() {
  if (!isLetterOpen()) return;
  const l = letters[letterIdx]; if (!l) return;
  const p = holdFor(l);
  const line = $('letter-hold');
  const canReply = Boolean(p) && !l.replied;
  $('reply-text').disabled = !canReply; $('reply-send').disabled = !canReply; $('reply-release').disabled = !p;
  $('letter-remove').disabled = Boolean(p);
  if (l.replied) { line.className = ''; line.textContent = 'Replied. Claude is continuing in the app.'; }
  else if (p && p.until) {
    const left = Math.max(0, p.until - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    line.className = 'live'; line.textContent = 'Claude is waiting for your reply · ' + m + ':' + String(s).padStart(2, '0') + ' left before the turn ends on its own';
  } else if (p) {
    line.className = 'live'; line.textContent = 'Claude is waiting for you. Reply here, type in the app, or let Claude finish.';
  } else if (l.released) { line.className = ''; line.textContent = 'This turn has ended. Reply in the app to continue.'; }
  else { line.className = ''; line.textContent = 'Read only.'; }
}

async function sendReply() {
  const l = letters[letterIdx]; if (!l) return;
  const text = $('reply-text').value.trim(); if (!text) return;
  $('reply-send').disabled = true;
  try {
    const r = await fetch('/reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: l.session_id, text }) });
    if (r.ok) { $('reply-text').value = ''; pushTicker('you → ' + base(l.cwd) + ': ' + oneLine(text, 90), 'you'); addEntry(l.session_id, 'you', text); dawnFlash = Math.max(dawnFlash, 0.8); }
    else { const e = await r.json().catch(() => ({})); $('letter-hold').className = ''; $('letter-hold').textContent = e.error || 'Could not send.'; }
  } catch { $('letter-hold').textContent = 'Server offline.'; }
}
async function releaseTurn() {
  const l = letters[letterIdx]; if (!l) return;
  try { await fetch('/release', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: l.session_id }) }); } catch { /* offline */ }
}

$('letter-close').addEventListener('click', closeLetter);
$('letter').addEventListener('click', (e) => { if (e.target === $('letter')) closeLetter(); });
$('letter-prev').addEventListener('click', () => openLetter(letterIdx - 1));
$('letter-next').addEventListener('click', () => openLetter(letterIdx + 1));
$('reply-send').addEventListener('click', sendReply);
$('reply-release').addEventListener('click', releaseTurn);
$('letter-remove').addEventListener('click', () => removeLetter(false));
$('letter-clear').addEventListener('click', () => armedClick('letter-clear', 'Sure? Clear all', () => { removeLetter(true); $('letter-clear').textContent = 'Clear all'; }));
sendOnEnter($('reply-text'), sendReply);
$('attention').addEventListener('click', () => {
  if (unread <= 0 || mode === 'needs_you') return;
  const idx = letters.map((x) => !readIds.has(x.id)).lastIndexOf(true);
  openLetter(idx >= 0 ? idx : letters.length - 1, false);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (isLetterOpen()) closeLetter(); $('shop').classList.add('hidden'); $('journal').classList.add('hidden'); $('stats').classList.add('hidden'); closeDesk(); }
  if (e.target && /^(TEXTAREA|INPUT)$/.test(e.target.tagName)) return;
  if (e.key === 'j' || e.key === 'J') { if ($('journal').classList.contains('hidden')) { renderJournal(); showPanel('journal'); } else $('journal').classList.add('hidden'); }
});
setInterval(updateHoldLine, 1000);

// ---------- server link ----------
function connect() {
  const es = new EventSource('/events');
  es.onopen = () => { connected = true; updateHud(); };
  es.onerror = () => { connected = false; updateHud(); };
  es.onmessage = (m) => {
    let msg; try { msg = JSON.parse(m.data); } catch { return; }
    if (msg.sessions) sessions = msg.sessions;
    if (typeof msg.paused === 'boolean') paused = msg.paused;
    if (msg.pending) pendingHolds = msg.pending;
    if (msg.queued) queuedNotes = msg.queued;
    if (msg.delivered && msg.delivered.text) {
      pushTicker('your desk note went in with your app message: ' + oneLine(msg.delivered.text, 80), 'you');
      addEntry(msg.delivered.session_id, 'you', msg.delivered.text);
      dawnFlash = Math.max(dawnFlash, 0.8);
    }
    if (msg.compactAt) compactAt = msg.compactAt;
    if (msg.type === 'quit') { closed = true; connected = false; es.close(); pushTicker('the ' + W_('place') + ' was closed from the Quit button', 'alert'); updateHud(); return; }
    if (msg.type === 'snapshot') {
      const items = [...(msg.recent || []).slice(-40).map((e) => ({ at: e.received_at || 0, ev: e })), ...(msg.notes || []).map((n) => ({ at: n.at || 0, note: n }))].sort((a, b) => a.at - b.at);
      for (const it of items) { if (it.ev) ingest(it.ev, true); else ingestNote(it.note, true); }
      (msg.letters || []).forEach((l) => upsertLetter(l, true));
    } else if (msg.type === 'hook') {
      layout();
      ingest(msg.event, false);
    } else if (msg.type === 'note') {
      ingestNote(msg.note, false);
    } else if (msg.type === 'letter') {
      upsertLetter(msg.letter, false);
    } else if (msg.type === 'letters') {
      replaceLetters(msg.letters || []);
    } else if (msg.type === 'save') {
      if (msg.writer !== clientId) { isWriter = false; claimPending = false; pullSave(); }
    }
    computeMode();
    updateHud();
  };
}
connect();

async function setPaused(v) {
  try {
    const r = await fetch('/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: v }) });
    const s = await r.json(); paused = Boolean(s.paused);
  } catch { /* offline */ }
  updateHud();
}

// ---------- input ----------
function hitMailbox(x, y) {
  return x >= mailbox.x - 6 && x <= mailbox.x + mailbox.w + 6 && y >= mailbox.y - mailbox.h - 24 && y <= mailbox.y + mailbox.postH;
}
function hitPlanter(x, y) {
  for (const [sid, r] of Object.entries(rects)) {
    if (x >= r.x - 10 && x <= r.x + r.w + 10 && y >= r.y - H * 0.6 && y <= r.y + r.h) return sid;
  }
  return null;
}
function hitStake(x, y) {
  for (const [sid, r] of Object.entries(rects)) {
    const sx = r.x + r.w - 14, sy = r.y - 34;
    if (x >= sx - 22 && x <= sx + 22 && y >= sy - 14 && y <= sy + 40) return sid;
  }
  return null;
}
function hitGate(x, y) { return x >= gate.x - 10 && x <= gate.x + gate.w + 10 && y >= gate.y - 110 && y <= gate.y + 30; }
function pestPos(p) { const r = rects[p.sid]; if (!r) return null; return { x: r.cx + p.x * r.w, y: r.y - 14 }; }
function hitPest(x, y) {
  for (let i = pests.length - 1; i >= 0; i--) {
    const pos = pestPos(pests[i]); if (!pos) continue;
    if (Math.abs(x - pos.x) < 18 && Math.abs(y - pos.y) < 18) return i;
  }
  return -1;
}
function hitBird(x, y) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    if (p.kind !== 'bird' || !p.catchable) continue;
    if (x >= p.x - 12 && x <= p.x + 80 && Math.abs(y - p.y) < 16) return i;
  }
  return -1;
}
function shoo(i, x, y) {
  const p = pests.splice(i, 1)[0];
  for (let k = 0; k < 3; k++) particles.push({ kind: 'bird', text: '', x: x, y: y - 10 - k * 6, vx: -(90 + Math.random() * 60), vy: -60 - Math.random() * 40, age: 0, life: 2, size: 11, phase: k });
  if (p && plants[p.sid]) earn(p.sid, TUNING.shoo * clickPower(), x, y, 'shoo! +', 'crit', 'shoo');
}
function catchBird(i, x, y) {
  const b = particles.splice(i, 1)[0];
  const sid = (b.sid && plants[b.sid]) ? b.sid : (focused() ? focused().id : null);
  if (!sid) return;
  earn(sid, TUNING.bird * clickPower() * birdMult(), x, y, W_('birdFloat'), 'crit', 'bird');
  for (let k = 0; k < 6; k++) particles.push({ kind: 'spark', text: '', x: x + (Math.random() - 0.5) * 30, y, vx: (Math.random() - 0.5) * 120, vy: -40 - Math.random() * 80, age: 0, life: 0.8, size: 3 });
}

function click(sid, x, y, held) {
  claimWriter();
  const plant = plantFor(sid);
  combo = Math.min(1, combo + TUNING.comboStep);
  const cm = 1 + combo * (comboCap() - 1);
  const wm = windowMult(sid);
  const crit = Math.random() < critChance();
  const gain = clickPower() * yieldMult(plant) * meterFactor(plant) * cm * wm.m * (crit ? critMult() : 1);
  plant.clicks++; garden.clicks++; if (crit) garden.crits++;
  const b = minuteBucket(); b.clicks++; if (crit) b.crits++; if (held) { b.held = (b.held || 0) + 1; garden.held = (garden.held || 0) + 1; }
  earn(sid, gain, x, y, crit ? 'CRIT +' : '+', crit ? 'crit' : (wm.m > 1 ? 'window' : ''), crit ? 'crit' : (wm.m > 1 ? 'window' : 'click'));
  const n = crit ? 10 : 4;
  for (let i = 0; i < n; i++) particles.push({ kind: 'spark', text: '', x: x + (Math.random() - 0.5) * 30, y, vx: (Math.random() - 0.5) * (crit ? 160 : 60), vy: -40 - Math.random() * (crit ? 120 : 60), age: 0, life: 0.8, size: crit ? 4 : 3 });
}
let lastClick = 0;
let holding = null;   // the planter under a held button; the mouse saver repeats the click there
canvas.addEventListener('pointerdown', (e) => {
  if (!e.isTrusted || e.button !== 0) return;
  if (hitMailbox(e.clientX, e.clientY)) { const idx = letters.map((x) => !readIds.has(x.id)).lastIndexOf(true); openLetter(idx >= 0 ? idx : letters.length - 1, false); return; }
  if (hitDesk(e.clientX, e.clientY)) { openDesk(); return; }
  const bi = hitBird(e.clientX, e.clientY);
  if (bi >= 0) { catchBird(bi, e.clientX, e.clientY); return; }
  const ci = hitCritter(e.clientX, e.clientY);
  if (ci >= 0) { catchCritter(ci, e.clientX, e.clientY); return; }
  const ai = hitAmbient(e.clientX, e.clientY);
  if (ai >= 0) { catchAmbient(ai, e.clientX, e.clientY); return; }
  const pi = hitPest(e.clientX, e.clientY);
  if (pi >= 0) { shoo(pi, e.clientX, e.clientY); return; }
  const now = performance.now();
  if (now - lastClick < 60) return;
  const sid = hitPlanter(e.clientX, e.clientY) || (e.clientY > H * 0.4 && focused() ? focused().id : null);
  if (!sid) return;
  if (!stickyFocus || focusId !== sid) { stickyFocus = true; focusId = sid; }
  lastClick = now;
  click(sid, e.clientX, e.clientY);
  holding = { sid, x: e.clientX, y: e.clientY, acc: 0 };
});
const endHold = () => { holding = null; };
window.addEventListener('pointerup', endHold);
window.addEventListener('pointercancel', endHold);
window.addEventListener('blur', endHold);
canvas.addEventListener('pointerleave', endHold);
canvas.addEventListener('pointermove', (e) => { hover.x = e.clientX; hover.y = e.clientY; if (holding) { holding.x = e.clientX; holding.y = e.clientY; } updateTip(); });
canvas.addEventListener('pointerleave', () => { hover.x = -1; hover.y = -1; updateTip(); });

function updateTip() {
  const tip = $('tip');
  let head = '', body = '';
  const stakeSid = hitStake(hover.x, hover.y);
  const gateSession = liveSessions().find((s) => s.status === 'needs_you');
  const lanternSid = hitLantern(hover.x, hover.y);
  if (lanternSid && sessions[lanternSid]) {
    const l = lanterns[lanternSid];
    head = W_('lanternTitle') + ' ' + sessionLabel(sessions[lanternSid]);
    body = l.night ? W_('lanternOut') : 'Context ' + l.pct + '% full: ' + Math.round(l.left * 100) + '% ' + W_('lanternLeft') + (l.left < 0.25 ? '\n' + W_('lanternLow') : '');
  } else if (stakeSid && sessions[stakeSid]) {
    const s = sessions[stakeSid];
    const prompt = s.prompt || (plants[stakeSid] && plants[stakeSid].prompt) || '';
    head = 'You asked ' + sessionLabel(s); body = prompt ? oneLine(prompt, 600) : 'no prompt seen yet this session';
  } else if (hitHourglass(hover.x, hover.y)) {
    const s = focused(); const ms = turnElapsed(s);
    head = 'Hourglass';
    body = ms ? 'This turn of ' + sessionLabel(s) + ' has run ' + Math.floor(ms / 60000) + ' min ' + Math.floor((ms / 1000) % 60) + ' s. The sand flips every five minutes.' : 'No turn is running. The sand runs while Claude works on a turn.';
  } else if (hitGate(hover.x, hover.y) && !gateSession) {
    const pm = (focused() && focused().permissionMode) || '';
    head = W_('gateTitle');
    body = pm === 'plan' ? 'Plan mode: Claude is working out a plan and will not change anything until you approve it.'
      : pm === 'acceptEdits' ? 'Accept-edits mode: file edits go through, other tools wait at the gate for your permission.'
      : pm === 'default' ? 'Default mode: Claude waits at the gate for your permission before each new kind of tool.'
      : pm ? 'The gate is open: Claude runs tools without asking (' + pm + ' mode).' : 'Nothing is known about the permission mode yet.';
  } else if (hitGate(hover.x, hover.y) && gateSession) {
    head = sessionLabel(gateSession) + ' is waiting at the gate';
    body = (gateSession.note || 'Claude needs you') + (gateSession.pendingTool ? '\n' + prettyTool(gateSession.pendingTool.name) + ': ' + gateSession.pendingTool.text : '') + '\n\nAnswer it in the Claude app.';
  } else if (hitMailbox(hover.x, hover.y)) {
    head = W_('mailboxTitle'); body = unread ? unread + ' letter' + (unread === 1 ? '' : 's') + ' waiting for an answer' : W_('mailboxEmpty');
  } else if (hitDesk(hover.x, hover.y)) {
    const st = deskState();
    head = W_('deskTitle');
    body = st.mode === 'ready' ? 'Claude is standing by. Click to write to ' + sessionLabel(st.s) + '.'
      : st.mode === 'queue' ? 'Claude is busy in ' + sessionLabel(st.s) + '. Click to leave a note for when this turn ends.' + (queuedNotes[st.s.id] ? '\nA note is already waiting.' : '')
      : st.mode === 'later' ? 'Claude is idle in the app, and only the app can start a new turn. A note left here goes in with your next app message.' + (queuedNotes[st.s.id] ? '\nA note is already waiting.' : '')
      : 'No session to write to. Start one in the Claude app.';
  } else if (hitPest(hover.x, hover.y) >= 0) {
    head = W_('crowTitle'); body = 'A tool call failed here.' + (has('greenhouse') ? ' The ' + W_('greenhouse') + ' keeps it harmless.' : ' The trickle is halved while it stays.') + '\nClick to shoo it for ' + fmt(10 * clickPower()) + ' ' + W_('sap') + '.';
  } else if (hitBird(hover.x, hover.y) >= 0) {
    head = W_('birdTitle'); body = 'Catch it for ' + fmt(20 * clickPower() * birdMult()) + ' ' + W_('sap') + '.';
  } else if (hitCritter(hover.x, hover.y) >= 0) {
    head = W_('beeTitle'); body = W_('beeTip');
  } else if (hitAmbient(hover.x, hover.y) >= 0) {
    const a = ambient[hitAmbient(hover.x, hover.y)];
    head = W_(a.kind === 'star' ? 'starTitle' : a.kind === 'butterfly' ? 'butterflyTitle' : a.kind === 'cat' ? 'catTitle' : a.kind === 'snail' ? 'snailTitle' : 'ladybugTitle');
    body = a.kind === 'star' ? 'Quick, click to make a wish.' : a.kind === 'cat' ? 'Click to pet it. The first pet of a visit pays.' : a.kind === 'snail' ? 'In no hurry. Click it for a small bonus.' : 'Click it for a small bonus.';
  } else {
    const sid = hitPlanter(hover.x, hover.y);
    if (sid && sessions[sid] && plants[sid]) {
      const s = sessions[sid], p = plants[sid];
      const wm = windowMult(sid);
      const sp = speciesOf(p);
      head = sessionLabel(s) + ' · ' + speciesName(sp) + ' (' + RARITY[sp.rarity].name.toLowerCase() + ') · ' + stageName(plantStage(p));
      const wait = nextStageIn(p);
      body = speciesBlurb(sp) + '\nyield ×' + yieldMult(p).toFixed(1) + ' · ' + fmt(p.sap) + ' ' + W_('sap') + ' drawn · meters ×' + meterFactor(p).toFixed(2) + (wm.m > 1 ? ' · ' + wm.why + ' ×' + wm.m : '') + (wait != null ? '\nnext stage in ' + Math.floor(wait / 60) + 'm ' + (wait % 60) + 's' : '\nnot growing: meters too low') + '\n' + W_('tend');
    }
  }
  if (!head) { tip.className = 'hidden'; return; }
  tip.className = '';
  tip.innerHTML = '<div class="head">' + esc(head) + '</div>' + esc(body);
  const x = Math.min(hover.x + 14, W - tip.offsetWidth - 10), y = Math.max(10, hover.y - tip.offsetHeight - 12);
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}

$('pause').addEventListener('click', () => setPaused(!paused));
$('sound').addEventListener('click', () => { prefs.sound = !prefs.sound; saveJSON(PREF_KEY, prefs); if (prefs.sound) chime(660, 990); updateHud(); });

// ---------- simulation ----------
let hudClock = 0;
function tick(dt) {
  normalizeGarden();
  checkAchievements(dt);
  const held = pendingWeather();
  for (const k in weather) weather[k] = held.has(k) ? Math.max(weather[k], 0.45) : Math.max(0, weather[k] - dt * (k === 'wind' ? 0.25 : 0.12));
  tickCritters(dt, held);
  tickAmbient(dt, performance.now() / 1000);
  dawnFlash = Math.max(0, dawnFlash - dt * 0.7);
  combo = Math.max(0, combo - dt / comboSeconds());
  // Mouse saver: a held button repeats the click at the tier's rate (the first one landed on pointerdown).
  if (holding && holdRate() > 0 && plants[holding.sid]) {
    holding.acc += dt * holdRate();
    while (holding.acc >= 1) { holding.acc -= 1; click(holding.sid, holding.x + (Math.random() - 0.5) * 12, holding.y + (Math.random() - 0.5) * 12, true); }
  }
  // meters drain over fifteen to twenty minutes; an ordinary hour of Claude's work refills them
  const waterDrain = (has('barrel') ? 0.06 : 0.09) * drainMult();
  const lightDrain = (has('greenhouse') ? 0.075 : 0.11) * drainMult();
  const working = anyoneWorking();
  const power = passivePower();
  for (const [sid, p] of Object.entries(plants)) {
    const sp = speciesOf(p);
    p.water = Math.max(0, p.water - dt * waterDrain * sp.water);
    p.light = Math.max(0, p.light - dt * lightDrain * sp.light);
    p.nutrients = Math.max(0, (p.nutrients || 0) - dt * 0.09 * drainMult());
    if (plantStage(p) > (garden.maxStage || 0)) garden.maxStage = plantStage(p);
    // the plant grows while it is healthy; nothing else grows it
    p.grown = (p.grown || 0) + dt * 1000 * growthSpeed(p);
    // the trickle: Claude working keeps the plant alive at about a fifth of an active click rate
    const s = sessions[sid];
    if (working && s && s.status === 'working' && Date.now() - s.lastSeen < 60 * 1000) {
      let rate = TUNING.trickle * power * yieldMult(p) * meterFactor(p);
      if (!has('greenhouse') && pestsOn(sid)) rate *= 0.5;
      p.sap += rate * dt; garden.sap += rate * dt; garden.lifetime += rate * dt; garden.runLifetime = (garden.runLifetime || 0) + rate * dt;
      record('trickle', rate * dt);
    }
  }
  const pestLife = has('scarecrow') ? 20000 : 60000;
  for (let i = pests.length - 1; i >= 0; i--) if (Date.now() - pests[i].since > pestLife || !rects[pests[i].sid]) pests.splice(i, 1);

  tickLanes(dt);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.kind === 'bird') p.y += Math.sin(p.age * 3 + p.phase) * 25 * dt;
    if (p.kind === 'sun') p.vx += Math.sin(p.age * 4) * 12 * dt;
    if (p.kind === 'spark') p.vy += 160 * dt;
    if (p.kind === 'rain') p.vx = -10 - weather.wind * 120;
    if (p.age > p.life || p.y > H + 40 || p.x < -420 || p.x > W + 420) particles.splice(i, 1);
  }
  for (let i = floaters.length - 1; i >= 0; i--) { const f = floaters[i]; f.age += dt; f.y -= 40 * dt; if (f.age > 1.2) floaters.splice(i, 1); }

  hudClock += dt;
  if (hudClock > 0.12) { hudClock = 0; computeMode(); updateHud(); updateActivityClock(); }
}

// ---------- critters: the garden's own life during quiet stretches ----------
// A bee visits the focused plant when nothing has happened for a while. Click
// it to pollinate for a bonus; it leaves on its own after a few seconds.
const critters = [];
let critterClock = 20 + Math.random() * 20;
function tickCritters(dt, held) {
  const quiet = Date.now() - lastEventAt > 8000;
  critterClock -= dt * (quiet ? 1 : 0.35);
  const s = focused();
  if (critterClock <= 0 && s && rects[s.id] && critters.length < 2) {
    critterClock = 25 + Math.random() * 25;
    const r = rects[s.id];
    critters.push({ kind: 'bee', sid: s.id, x: r.cx + (Math.random() - 0.5) * 60, y: r.y - H * 0.25 * Math.max(0.6, r.scale), age: 0, life: 9 + Math.random() * 4, phase: Math.random() * 6 });
    fly(W_('beeVisit') + ' ' + sessionLabel(s), '#ffcb5c');
  }
  for (let i = critters.length - 1; i >= 0; i--) {
    const c = critters[i]; c.age += dt;
    const r = rects[c.sid]; if (!r || c.age > c.life) { critters.splice(i, 1); continue; }
    c.x += Math.sin(c.age * 1.3 + c.phase) * 40 * dt; c.y += Math.cos(c.age * 1.7 + c.phase) * 30 * dt;
    c.x = Math.max(r.x - 20, Math.min(r.x + r.w + 20, c.x));
  }
}
function hitCritter(x, y) { for (let i = critters.length - 1; i >= 0; i--) { const c = critters[i]; if (Math.abs(x - c.x) < 16 && Math.abs(y - c.y) < 16) return i; } return -1; }
function catchCritter(i, x, y) {
  const c = critters.splice(i, 1)[0];
  if (!plants[c.sid]) return;
  earn(c.sid, 15 * clickPower() * yieldMult(plants[c.sid]) * birdMult(), x, y, W_('beeFloat'), 'crit', 'bird');
  for (let k = 0; k < 6; k++) particles.push({ kind: 'spark', text: '', x: x + (Math.random() - 0.5) * 30, y, vx: (Math.random() - 0.5) * 120, vy: -40 - Math.random() * 80, age: 0, life: 0.8, size: 3 });
}
// ---------- ambient life: things that just happen ----------
// Purely for watching, though a few pay a little if you catch them:
// butterflies (5 clicks), ladybugs and snails (3 clicks), shooting stars (a wish, 25
// clicks), and a cat (8 clicks for the first pet of a visit). Rainbows follow rain,
// kites need wind, balloons and planes are rare, the owl comes out after dark, and
// mist lies on the ground while the context is fresh.
const ambient = [];
const ambientClocks = { gust: 15 + Math.random() * 30, cloud: 5 + Math.random() * 20, flock: 30 + Math.random() * 40, butterfly: 20 + Math.random() * 30, ladybug: 40 + Math.random() * 60, rabbit: 60 + Math.random() * 90, seeds: 25 + Math.random() * 40, star: 20 + Math.random() * 40, leaffall: 8 + Math.random() * 10,
  kite: 20 + Math.random() * 40, balloon: 120 + Math.random() * 240, plane: 90 + Math.random() * 180, cat: 60 + Math.random() * 120, snail: 60 + Math.random() * 120, owl: 30 + Math.random() * 60 };
let rainPeakAt = 0;
let gustUntil = 0;
function spawnAmbient(kind) {
  if (!W || !H) return;   // nothing has been laid out yet
  const foc = focused(); const r = foc && rects[foc.id];
  const a = { kind, age: 0, life: 10, phase: Math.random() * 6 };
  switch (kind) {
    case 'cloud': a.x = -140; a.y = 40 + Math.random() * (soilY * 0.35); a.vx = 8 + Math.random() * 8; a.w = 90 + Math.random() * 90; a.life = (W + 300) / a.vx; break;
    case 'flock': a.x = W + 20; a.y = 50 + Math.random() * (soilY * 0.3); a.vx = -(40 + Math.random() * 20); a.n = 3 + Math.floor(Math.random() * 4); a.life = (W + 120) / -a.vx; break;
    case 'butterfly': { const bx = r ? r.cx : W * 0.4; a.x = bx + (Math.random() - 0.5) * 200; a.y = soilY - 40 - Math.random() * H * 0.3; a.vx = (Math.random() - 0.5) * 30; a.vy = 0; a.hue = Math.floor(Math.random() * 360); a.life = 12 + Math.random() * 8; break; }
    case 'ladybug': { if (!r) return; a.sid = foc.id; a.u = Math.random(); a.dir = Math.random() < 0.5 ? 1 : -1; a.life = 18 + Math.random() * 10; break; }
    case 'rabbit': { const ltr = Math.random() < 0.5; a.x = ltr ? -30 : W + 30; a.vx = (ltr ? 1 : -1) * (55 + Math.random() * 25); a.y = soilY + 52 + Math.random() * 10; a.life = (W + 80) / Math.abs(a.vx); break; }
    case 'seeds': for (let i = 0; i < 6; i++) ambient.push({ kind: 'seed', age: -i * 0.3, life: 14, x: (r ? r.cx : W * 0.4) + (Math.random() - 0.5) * 60, y: soilY - 30 - Math.random() * 40, vx: 12 + Math.random() * 14, vy: -6 - Math.random() * 6, phase: Math.random() * 6 }); return;
    case 'star': a.x = W * (0.1 + Math.random() * 0.5); a.y = 30 + Math.random() * H * 0.25; a.vx = 260 + Math.random() * 120; a.vy = 90 + Math.random() * 40; a.life = 1.6; break;
    case 'leaffall': a.x = (r ? r.cx : W * 0.4) + (Math.random() - 0.5) * 120; a.y = soilY - H * 0.25 - Math.random() * H * 0.15; a.vx = 8; a.vy = 22 + Math.random() * 10; a.life = (soilY - a.y) / a.vy; a.hue = 20 + Math.random() * 30; break;
    case 'kite': a.ax = W * 0.1; a.ay = soilY + 36; a.x = a.ax + 80; a.y = soilY - H * 0.3; a.hue = Math.floor(Math.random() * 360); a.life = 22 + Math.random() * 12; break;
    case 'balloon': a.x = -60; a.y = 50 + Math.random() * H * 0.18; a.vx = 10 + Math.random() * 6; a.hue = Math.floor(Math.random() * 360); a.life = (W + 140) / a.vx; break;
    case 'plane': { const ltr = Math.random() < 0.5; a.x = ltr ? -80 : W + 80; a.vx = (ltr ? 1 : -1) * (70 + Math.random() * 40); a.y = 28 + Math.random() * 50; a.life = (W + 260) / Math.abs(a.vx); break; }
    case 'cat': { const ltr = Math.random() < 0.5; a.x = ltr ? -40 : W + 40; a.vx = (ltr ? 1 : -1) * 45; a.y = soilY + 34 + Math.random() * 12; a.tx = desk.x + desk.w + 30 + Math.random() * 40; a.state = 'walk'; a.sitFor = 14 + Math.random() * 12; a.coat = [[59, 58, 64], [217, 139, 58], [185, 179, 168], [242, 236, 223]][Math.floor(Math.random() * 4)]; a.purr = 0; a.life = 150; fly('a cat wandered into the garden', '#d9b38c'); break; }
    case 'snail': { if (!r) return; a.sid = foc.id; a.u = Math.random() < 0.5 ? 0.05 : 0.95; a.dir = a.u < 0.5 ? 1 : -1; a.life = 45 + Math.random() * 30; break; }
    case 'owl': a.life = 50 + Math.random() * 40; a.blink = 0; a.look = 0; break;
    case 'confetti': a.life = 2.6 + Math.random(); a.vy = -120 - Math.random() * 160; a.vx = (Math.random() - 0.5) * 220; a.hue = Math.floor(Math.random() * 360); a.spin = (Math.random() - 0.5) * 12; break;
    case 'rocket': a.life = 1.1 + Math.random() * 0.4; a.vy = -(H * 0.45) / a.life; a.hue = Math.floor(Math.random() * 360); break;
    case 'burst': a.life = 1.2 + Math.random() * 0.5; break;
    case 'rainbow': a.life = 16 + Math.random() * 6; a.cx = W * (0.35 + Math.random() * 0.3); a.r = Math.min(W, H) * 0.55; break;
    case 'debris': a.x = -20; a.y = soilY - 20 - Math.random() * H * 0.35; a.vx = 180 + Math.random() * 120; a.vy = (Math.random() - 0.5) * 30; a.life = (W + 60) / a.vx; a.hue = Math.random() < 0.6 ? 100 + Math.random() * 30 : 25 + Math.random() * 20; break;
    default: return;
  }
  ambient.push(a);
}
function tickAmbient(dt, t) {
  const dark = skyIsDark(), f = dayFraction(), dusk = !isNight() && f > 0.85;
  for (const k of Object.keys(ambientClocks)) {
    ambientClocks[k] -= dt;
    if (ambientClocks[k] > 0) continue;
    const reset = { gust: 25 + Math.random() * 45, cloud: 25 + Math.random() * 40, flock: 45 + Math.random() * 60, butterfly: 30 + Math.random() * 40, ladybug: 60 + Math.random() * 90, rabbit: 90 + Math.random() * 150, seeds: 40 + Math.random() * 60, star: 25 + Math.random() * 50, leaffall: 6 + Math.random() * 8,
      kite: 40 + Math.random() * 60, balloon: 240 + Math.random() * 300, plane: 180 + Math.random() * 240, cat: 150 + Math.random() * 200, snail: 120 + Math.random() * 180, owl: 90 + Math.random() * 120 }[k];
    ambientClocks[k] = reset;
    if (k === 'gust') { gustUntil = Date.now() + 2500 + Math.random() * 2000; for (let i = 0; i < 6 + Math.floor(Math.random() * 6); i++) setTimeout(() => spawnAmbient('debris'), i * 220); }
    else if (k === 'butterfly') { if (!dark) spawnAmbient('butterfly'); }
    else if (k === 'star') { if (dark) spawnAmbient('star'); }
    else if (k === 'leaffall') { if (dusk) spawnAmbient('leaffall'); }
    else if (k === 'seeds') { if (!dark) spawnAmbient('seeds'); }
    else if (k === 'kite') { if (weather.wind > 0.35 || Date.now() < gustUntil) spawnAmbient('kite'); else ambientClocks[k] = 8 + Math.random() * 8; }
    else if (k === 'balloon' || k === 'plane') { if (!dark && !isNight()) spawnAmbient(k); }
    else if (k === 'owl') { if (dark && connected) spawnAmbient('owl'); }
    else if (k === 'cat' || k === 'snail') { if (!ambient.some((a) => a.kind === k)) spawnAmbient(k); }
    else spawnAmbient(k);
  }
  if (Date.now() < gustUntil) weather.wind = Math.max(weather.wind, 0.6);
  // a rainbow when a spell of rain clears under a bright sky
  if (weather.rain > 0.6) rainPeakAt = Date.now();
  if (rainPeakAt && weather.rain < 0.25 && !dark) { if (!ambient.some((a) => a.kind === 'rainbow')) spawnAmbient('rainbow'); rainPeakAt = 0; }
  else if (rainPeakAt && Date.now() - rainPeakAt > 40000) rainPeakAt = 0;
  for (let i = ambient.length - 1; i >= 0; i--) {
    const a = ambient[i]; a.age += dt;
    if (a.age < 0) continue;
    if (a.age > a.life || ((a.kind === 'ladybug' || a.kind === 'snail') && !rects[a.sid]) || (a.kind === 'owl' && !skyIsDark())) { ambient.splice(i, 1); continue; }
    const gust = Date.now() < gustUntil ? 60 : 0;
    switch (a.kind) {
      case 'cloud': a.x += (a.vx + gust * 0.3) * dt; break;
      case 'flock': a.x += a.vx * dt; a.y += Math.sin(a.age + a.phase) * 6 * dt; break;
      case 'butterfly': a.vx += (Math.random() - 0.5) * 120 * dt; a.vx *= 0.98; a.x += (a.vx + gust * 0.4) * dt; a.y += Math.sin(a.age * 5 + a.phase) * 40 * dt + Math.cos(a.age * 0.7) * 10 * dt; break;
      case 'ladybug': a.u += a.dir * 0.03 * dt; if (a.u < 0 || a.u > 1) a.dir *= -1; break;
      case 'rabbit': a.x += a.vx * dt; break;
      case 'seed': a.x += (a.vx + gust) * dt; a.y += (a.vy + Math.sin(a.age * 2 + a.phase) * 8) * dt; break;
      case 'star': a.x += a.vx * dt; a.y += a.vy * dt; break;
      case 'leaffall': a.x += (a.vx + gust * 0.5 + Math.sin(a.age * 3 + a.phase) * 20) * dt; a.y += a.vy * dt; break;
      case 'debris': a.x += a.vx * dt; a.y += (a.vy + Math.sin(a.age * 6 + a.phase) * 25) * dt; break;
      case 'kite': { const wind = 0.4 + weather.wind + (Date.now() < gustUntil ? 0.6 : 0); a.x += ((a.ax + 60 + wind * 120 + Math.sin(a.age * 0.9 + a.phase) * 30) - a.x) * 1.2 * dt; a.y += ((soilY - H * (0.22 + wind * 0.12) + Math.sin(a.age * 1.7 + a.phase) * 18) - a.y) * 1.2 * dt; break; }
      case 'balloon': a.x += (a.vx + gust * 0.2) * dt; a.y += Math.sin(a.age * 0.4 + a.phase) * 6 * dt; break;
      case 'plane': a.x += a.vx * dt; break;
      case 'cat':
        if (a.state === 'walk') { a.x += a.vx * dt; if ((a.vx > 0 && a.x >= a.tx) || (a.vx < 0 && a.x <= a.tx)) { a.state = 'sit'; a.sat = 0; } }
        else if (a.state === 'sit') { a.sat += dt; if (a.sat > a.sitFor) { a.state = 'leave'; a.vx = -a.vx; } }
        else { a.x += a.vx * dt; if (a.x < -50 || a.x > W + 50) a.age = a.life + 1; }
        a.purr = Math.max(0, a.purr - dt);
        break;
      case 'snail': a.u += a.dir * 0.006 * dt; if (a.u < 0.02 || a.u > 0.98) a.dir *= -1; break;
      case 'owl': a.blink = Math.max(0, a.blink - dt); if (Math.random() < dt * 0.15) a.blink = 0.2; if (Math.random() < dt * 0.1) a.look = [-1, 0, 1][Math.floor(Math.random() * 3)]; break;
      case 'rainbow': break;
      case 'confetti': a.vy += 260 * dt; a.vx *= 0.985; a.x += (a.vx + gust) * dt; a.y += a.vy * dt; break;
      case 'rocket': a.x += Math.sin(a.age * 9 + a.phase) * 10 * dt; a.y += a.vy * dt; if (a.age >= a.life) { for (let k = 0; k < 26; k++) { const ang = (k / 26) * Math.PI * 2, sp = 70 + Math.random() * 90; ambient.push({ kind: 'burst', age: 0, life: 1.2 + Math.random() * 0.5, phase: 0, x: a.x, y: a.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, hue: a.hue }); } } break;
      case 'burst': a.vy += 90 * dt; a.vx *= 0.97; a.vy *= 0.97; a.x += a.vx * dt; a.y += a.vy * dt; break;
      default: break;
    }
  }
}
function ambientPos(a) {
  if (a.kind === 'ladybug' || a.kind === 'snail') { const r = rects[a.sid]; if (!r) return { x: -100, y: -100 }; return { x: r.x + a.u * r.w, y: r.y - (a.kind === 'snail' ? 5 : 8) }; }
  return { x: a.x, y: a.y };
}
function hitAmbient(x, y) {
  for (let i = ambient.length - 1; i >= 0; i--) {
    const a = ambient[i]; if (a.age < 0) continue;
    if (!/^(butterfly|ladybug|star|cat|snail)$/.test(a.kind)) continue;
    const p = ambientPos(a); const rad = a.kind === 'star' ? 26 : a.kind === 'cat' ? 24 : 16;
    if (a.kind === 'cat') { if (Math.abs(x - p.x) < rad && y > p.y - 34 && y < p.y + 8) return i; continue; }
    if (Math.abs(x - p.x) < rad && Math.abs(y - p.y) < rad) return i;
  }
  return -1;
}
function catchAmbient(i, x, y) {
  const s = focused(); if (!s || !plants[s.id]) return;
  if (ambient[i].kind === 'cat') {
    // petting: hearts every time, sap only for the first pet of a visit
    const c = ambient[i]; c.purr = 1.5;
    for (let k = 0; k < 4; k++) particles.push({ kind: 'spark', text: '', x: x + (Math.random() - 0.5) * 24, y: y - 12, vx: (Math.random() - 0.5) * 40, vy: -30 - Math.random() * 40, age: 0, life: 1.1, size: 3 });
    if (!c.paid) { c.paid = true; garden.petted = (garden.petted || 0) + 1; earn(s.id, 8 * clickPower() * yieldMult(plants[s.id]), x, y, '🐈 purr +', 'window', 'bird'); }
    return;
  }
  const a = ambient.splice(i, 1)[0];
  const mult = a.kind === 'star' ? 25 : a.kind === 'butterfly' ? 5 : 3;
  const label = a.kind === 'star' ? '✨ a wish +' : a.kind === 'butterfly' ? '🦋 +' : a.kind === 'snail' ? '🐌 +' : '🐞 +';
  earn(s.id, mult * clickPower() * yieldMult(plants[s.id]), x, y, label, a.kind === 'star' ? 'crit' : 'window', 'bird');
  for (let k = 0; k < (a.kind === 'star' ? 12 : 5); k++) particles.push({ kind: 'spark', text: '', x: x + (Math.random() - 0.5) * 30, y, vx: (Math.random() - 0.5) * 140, vy: -40 - Math.random() * 90, age: 0, life: 0.9, size: 3 });
}
function drawAmbient(layer, t) {
  const dl = daylight();
  for (const a of ambient) {
    if (a.age < 0) continue;
    const fade = Math.min(1, a.age * 2, (a.life - a.age) * 1.5);
    if (theme.draw.ambient && theme.draw.ambient(a, layer, t, fade)) continue;
    if (layer === 'back') {
      if (a.kind === 'cloud') {
        ctx.fillStyle = 'rgba(255,255,255,' + (0.35 * dl * fade).toFixed(2) + ')';
        const w = a.w, h = w * 0.32;
        ctx.beginPath(); ctx.ellipse(a.x, a.y, w * 0.5, h * 0.5, 0, 0, Math.PI * 2); ctx.ellipse(a.x - w * 0.25, a.y + h * 0.15, w * 0.28, h * 0.4, 0, 0, Math.PI * 2); ctx.ellipse(a.x + w * 0.25, a.y + h * 0.1, w * 0.3, h * 0.42, 0, 0, Math.PI * 2); ctx.fill();
      } else if (a.kind === 'flock') {
        ctx.strokeStyle = 'rgba(40,40,60,' + (0.6 * fade).toFixed(2) + ')'; ctx.lineWidth = 1.2;
        for (let k = 0; k < a.n; k++) {
          const bx = a.x + Math.abs(k - (a.n - 1) / 2) * 14, by = a.y + (k - (a.n - 1) / 2) * 7, flap = Math.sin(t * 10 + k) * 2;
          ctx.beginPath(); ctx.moveTo(bx - 5, by - flap); ctx.lineTo(bx, by + 2); ctx.lineTo(bx + 5, by - flap); ctx.stroke();
        }
      } else if (a.kind === 'star') {
        const g = ctx.createLinearGradient(a.x - a.vx * 0.25, a.y - a.vy * 0.25, a.x, a.y);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,' + fade.toFixed(2) + ')');
        ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a.x - a.vx * 0.25, a.y - a.vy * 0.25); ctx.lineTo(a.x, a.y); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,' + fade.toFixed(2) + ')'; ctx.beginPath(); ctx.arc(a.x, a.y, 2.5, 0, Math.PI * 2); ctx.fill();
      } else if (a.kind === 'balloon') {
        ctx.save(); ctx.translate(a.x, a.y); ctx.globalAlpha = fade * (0.5 + 0.5 * dl);
        ctx.fillStyle = 'hsl(' + a.hue + ',70%,55%)'; ctx.beginPath(); ctx.ellipse(0, 0, 15, 18, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.ellipse(-5.5, 0, 3.5, 17, 0, 0, Math.PI * 2); ctx.ellipse(5.5, 0, 3.5, 17, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'hsl(' + a.hue + ',50%,35%)'; ctx.beginPath(); ctx.moveTo(-8, 14); ctx.lineTo(8, 14); ctx.lineTo(3, 24); ctx.lineTo(-3, 24); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(60,40,20,0.8)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-3.5, 23); ctx.lineTo(-4.5, 31); ctx.moveTo(3.5, 23); ctx.lineTo(4.5, 31); ctx.stroke();
        ctx.fillStyle = '#7a5433'; ctx.fillRect(-6, 31, 12, 7);
        ctx.restore();
      } else if (a.kind === 'plane') {
        const dir = a.vx > 0 ? 1 : -1;
        const g = ctx.createLinearGradient(a.x - dir * 170, 0, a.x - dir * 12, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,' + (0.55 * fade * dl).toFixed(2) + ')');
        ctx.strokeStyle = g; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(a.x - dir * 170, a.y + 1); ctx.lineTo(a.x - dir * 12, a.y + 1); ctx.stroke();
        ctx.fillStyle = 'rgba(235,240,250,' + (0.9 * fade).toFixed(2) + ')';
        ctx.beginPath(); ctx.moveTo(a.x + dir * 10, a.y); ctx.lineTo(a.x - dir * 8, a.y - 2.2); ctx.lineTo(a.x - dir * 10, a.y); ctx.lineTo(a.x - dir * 8, a.y + 2.2); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(a.x - dir * 2, a.y); ctx.lineTo(a.x - dir * 7, a.y - 6); ctx.lineTo(a.x - dir * 4, a.y); ctx.lineTo(a.x - dir * 7, a.y + 6); ctx.closePath(); ctx.fill();
        ctx.fillRect(a.x - dir * 10 - 1, a.y - 3.5, 2, 3.5);
      } else if (a.kind === 'rainbow') {
        const bands = ['#ff4d4d', '#ffa64d', '#ffe74d', '#66d96b', '#4da6ff', '#8a5cff'];
        const lw = Math.max(4, a.r * 0.028); ctx.lineWidth = lw;
        for (let k = 0; k < bands.length; k++) { ctx.strokeStyle = bands[k]; ctx.globalAlpha = 0.26 * fade * dl; ctx.beginPath(); ctx.arc(a.cx, soilY + 30, Math.max(1, a.r - k * lw), Math.PI, Math.PI * 2); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
      continue;
    }
    if (a.kind === 'butterfly') {
      ctx.save(); ctx.translate(a.x, a.y); ctx.globalAlpha = fade;
      const flap = Math.abs(Math.sin(t * 14 + a.phase));
      ctx.fillStyle = 'hsl(' + a.hue + ',80%,65%)';
      ctx.beginPath(); ctx.ellipse(-5 * flap - 1, -2, 6 * (0.4 + flap * 0.6), 5, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(5 * flap + 1, -2, 6 * (0.4 + flap * 0.6), 5, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'hsl(' + a.hue + ',60%,45%)'; ctx.beginPath(); ctx.ellipse(-4 * flap, 3, 4 * (0.4 + flap * 0.6), 3, -0.3, 0, Math.PI * 2); ctx.ellipse(4 * flap, 3, 4 * (0.4 + flap * 0.6), 3, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2b2620'; ctx.fillRect(-0.8, -5, 1.6, 10);
      ctx.restore();
    } else if (a.kind === 'ladybug') {
      const p = ambientPos(a);
      ctx.save(); ctx.translate(p.x, p.y); ctx.globalAlpha = fade; ctx.scale(a.dir, 1);
      ctx.fillStyle = '#d7263d'; ctx.beginPath(); ctx.ellipse(0, 0, 5, 3.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1c1c24'; ctx.beginPath(); ctx.arc(4, 0, 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(-0.4, -3.6, 0.8, 7.2); for (const [sx, sy] of [[-2, -1.5], [-2, 1.5], [1, -1.8], [1, 1.8]]) { ctx.beginPath(); ctx.arc(sx, sy, 0.8, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    } else if (a.kind === 'rabbit') {
      ctx.save(); ctx.translate(a.x, a.y - Math.abs(Math.sin(a.age * 6)) * 9); ctx.globalAlpha = fade; ctx.scale(a.vx > 0 ? 1 : -1, 1);
      ctx.fillStyle = col([225, 214, 196], dl); ctx.beginPath(); ctx.ellipse(0, 0, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(9, -3, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(9, -10, 1.6, 5, 0.2, 0, Math.PI * 2); ctx.ellipse(6, -10, 1.6, 5, -0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-10, -1, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2b2620'; ctx.beginPath(); ctx.arc(10.5, -3.5, 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (a.kind === 'seed') {
      ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(Math.sin(a.age * 2 + a.phase) * 0.4); ctx.globalAlpha = 0.8 * fade;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1;
      for (let k = 0; k < 7; k++) { const ang = -Math.PI / 2 + (k - 3) * 0.32; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(ang) * 7, Math.sin(ang) * 7); ctx.stroke(); }
      ctx.fillStyle = '#8a7a5a'; ctx.beginPath(); ctx.ellipse(0, 3, 1.2, 2.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (a.kind === 'confetti') {
      ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.age * a.spin + a.phase); ctx.globalAlpha = Math.min(1, (a.life - a.age) * 1.5);
      ctx.fillStyle = 'hsl(' + a.hue + ',85%,60%)'; ctx.fillRect(-3.5, -2, 7, 4);
      ctx.restore();
    } else if (a.kind === 'rocket') {
      ctx.strokeStyle = 'hsla(' + a.hue + ',90%,75%,0.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a.x, a.y + 18); ctx.lineTo(a.x, a.y); ctx.stroke();
      ctx.fillStyle = '#fff8d0'; ctx.beginPath(); ctx.arc(a.x, a.y, 2.5, 0, Math.PI * 2); ctx.fill();
    } else if (a.kind === 'burst') {
      const life = Math.max(0, 1 - a.age / a.life);
      ctx.fillStyle = 'hsla(' + a.hue + ',90%,' + (55 + 30 * life) + '%,' + life.toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(a.x, a.y, 1.5 + 1.5 * life, 0, Math.PI * 2); ctx.fill();
    } else if (a.kind === 'kite') {
      ctx.save(); ctx.globalAlpha = fade;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.ax, a.ay); ctx.quadraticCurveTo((a.ax + a.x) / 2 - 20, (a.ay + a.y) / 2 + 30, a.x, a.y); ctx.stroke();
      ctx.translate(a.x, a.y); ctx.rotate(0.35 + Math.sin(a.age * 1.7 + a.phase) * 0.15);
      ctx.fillStyle = 'hsl(' + a.hue + ',80%,60%)'; ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(11, 0); ctx.lineTo(0, 18); ctx.lineTo(-11, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(40,30,30,0.5)'; ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(0, 18); ctx.moveTo(-11, 0); ctx.lineTo(11, 0); ctx.stroke();
      ctx.strokeStyle = 'hsl(' + ((a.hue + 40) % 360) + ',80%,65%)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, 18);
      for (let k = 1; k <= 5; k++) ctx.lineTo(Math.sin(a.age * 6 + k) * 6, 18 + k * 7);
      ctx.stroke();
      ctx.restore();
    } else if (a.kind === 'cat') {
      ctx.save(); ctx.translate(a.x, a.y); ctx.globalAlpha = fade; ctx.scale(a.vx > 0 ? 1 : -1, 1);
      const sit = a.state === 'sit', step = sit ? 0 : Math.sin(a.age * 9) * 2;
      shadow(0, 4, 30, 3, 0.18);
      const coat = col(a.coat, dl); ctx.fillStyle = coat;
      if (sit) { ctx.beginPath(); ctx.ellipse(0, -9, 9, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(-2, 0, 11, 4, 0, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.beginPath(); ctx.ellipse(0, -7, 14, 6, 0, 0, Math.PI * 2); ctx.fill(); for (const lx of [-9, -3, 4, 10]) ctx.fillRect(lx - 1, -5, 2.5, 6 + (lx % 2 ? step : -step)); }
      const hx = sit ? 1 : 13, hy = sit ? -23 : -13;
      ctx.beginPath(); ctx.arc(hx, hy, 6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(hx - 5.5, hy - 2); ctx.lineTo(hx - 4.5, hy - 10); ctx.lineTo(hx - 1, hy - 5); ctx.moveTo(hx + 5.5, hy - 2); ctx.lineTo(hx + 4.5, hy - 10); ctx.lineTo(hx + 1, hy - 5); ctx.fill();
      ctx.strokeStyle = coat; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.beginPath();
      if (sit) { ctx.moveTo(7, 1); ctx.quadraticCurveTo(17 + Math.sin(a.age * 2) * 4, 0, 19 + Math.sin(a.age * 2) * 6, -9); } else { ctx.moveTo(-13, -9); ctx.quadraticCurveTo(-21, -19 + step * 2, -17, -25); }
      ctx.stroke();
      if (a.purr > 0) { ctx.strokeStyle = '#2b2620'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(hx - 2.2, hy - 1, 1.4, Math.PI, 0); ctx.moveTo(hx + 3.6, hy - 1); ctx.arc(hx + 2.2, hy - 1, 1.4, Math.PI, 0); ctx.stroke(); }
      else { ctx.fillStyle = dl < 0.5 ? '#c8ff5c' : '#2b2620'; ctx.beginPath(); ctx.arc(hx - 2.2, hy - 1, 1, 0, Math.PI * 2); ctx.arc(hx + 2.2, hy - 1, 1, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
      if (a.purr > 0) { ctx.fillStyle = 'rgba(255,110,150,' + Math.min(1, a.purr).toFixed(2) + ')'; ctx.font = '13px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('♥', a.x + (a.vx > 0 ? 10 : -10), a.y - 36 - (1.5 - a.purr) * 18); }
    } else if (a.kind === 'snail') {
      const p = ambientPos(a);
      ctx.save(); ctx.translate(p.x, p.y); ctx.globalAlpha = fade; ctx.scale(a.dir, 1);
      ctx.fillStyle = col([190, 170, 130], dl); ctx.beginPath(); ctx.ellipse(1, 1, 7, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col([200, 140, 80], dl); ctx.beginPath(); ctx.arc(-2, -3, 4.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col([120, 70, 40], dl); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(-2, -3, 2.4, 0, Math.PI * 1.5); ctx.stroke();
      ctx.strokeStyle = col([190, 170, 130], dl); ctx.beginPath(); ctx.moveTo(6, -1); ctx.lineTo(8, -5); ctx.moveTo(4, -1); ctx.lineTo(5, -5); ctx.stroke();
      ctx.restore();
    } else if (a.kind === 'owl') {
      ctx.save(); ctx.translate(mailbox.x + mailbox.w / 2, mailbox.y - mailbox.h - 2); ctx.globalAlpha = fade;
      ctx.fillStyle = '#5a4634'; ctx.beginPath(); ctx.ellipse(0, -9, 7, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-6, -17); ctx.lineTo(-4, -23); ctx.lineTo(-1, -18); ctx.moveTo(6, -17); ctx.lineTo(4, -23); ctx.lineTo(1, -18); ctx.fill();
      ctx.fillStyle = '#8a7256'; ctx.beginPath(); ctx.ellipse(0, -6, 4, 6, 0, 0, Math.PI * 2); ctx.fill();
      const open = a.blink > 0 ? 0.15 : 1, lx = a.look * 1.1;
      ctx.fillStyle = '#ffd45c'; ctx.beginPath(); ctx.ellipse(-2.6 + lx, -14, 2.2, 2.2 * open, 0, 0, Math.PI * 2); ctx.ellipse(2.6 + lx, -14, 2.2, 2.2 * open, 0, 0, Math.PI * 2); ctx.fill();
      if (open > 0.5) { ctx.fillStyle = '#1c1c24'; ctx.beginPath(); ctx.arc(-2.6 + lx * 1.4, -14, 1, 0, Math.PI * 2); ctx.arc(2.6 + lx * 1.4, -14, 1, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = '#e8b04a'; ctx.beginPath(); ctx.moveTo(-1.5, -11.5); ctx.lineTo(1.5, -11.5); ctx.lineTo(0, -9); ctx.closePath(); ctx.fill();
      ctx.restore();
    } else if (a.kind === 'leaffall' || a.kind === 'debris') {
      ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.age * (a.kind === 'debris' ? 9 : 3) + a.phase); ctx.globalAlpha = 0.85 * fade;
      ctx.fillStyle = 'hsl(' + a.hue + ',55%,' + (a.kind === 'debris' && a.hue > 90 ? 42 : 50) + '%)';
      ctx.beginPath(); ctx.ellipse(0, 0, 5, 2.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  // morning mist on the ground while the context is fresh
  if (layer === 'front' && connected && !isNight() && dayFraction() < 0.14) {
    const al = (0.14 - dayFraction()) / 0.14 * 0.28;
    for (let i = 0; i < 4; i++) {
      const mx = (((i * 0.27 + t * 0.012 * (1 + i * 0.3)) % 1.3) - 0.15) * W, my = soilY + 14 + i * 16;
      const g = ctx.createRadialGradient(mx, my, 0, mx, my, W * 0.22);
      g.addColorStop(0, 'rgba(255,255,255,' + al.toFixed(2) + ')'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(mx, my, W * 0.22, 18, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  // fireflies over the ground at night
  if (layer === 'front' && skyIsDark() && connected) {
    for (let i = 0; i < 14; i++) {
      const fx = ((i * 0.137 + t * 0.006 * ((i % 3) + 1)) % 1) * W, fy = soilY - 10 + Math.sin(t * 0.9 + i * 1.7) * 30 + (i % 4) * 12;
      const al = Math.max(0, Math.sin(t * 2.2 + i * 2.1));
      ctx.fillStyle = (theme.firefly || 'rgba(220,255,160,') + (0.85 * al).toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(fx, fy, 1.8, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawCritters(t) {
  for (const c of critters) {
    const fade = Math.min(1, c.age * 3, (c.life - c.age) * 2);
    ctx.save(); ctx.globalAlpha = fade; ctx.translate(c.x, c.y);
    ctx.fillStyle = 'rgba(200,220,255,0.7)';
    const wing = Math.sin(t * 40) * 0.5;
    ctx.beginPath(); ctx.ellipse(-3, -5, 5, 2.5, -0.6 + wing, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(3, -5, 5, 2.5, 0.6 - wing, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f2c14e'; ctx.beginPath(); ctx.ellipse(0, 0, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2b2620'; ctx.fillRect(-2, -5, 2, 10); ctx.fillRect(2, -5, 2, 10);
    ctx.beginPath(); ctx.arc(-7, 0, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

// ---------- drawing ----------
function mix(a, b, t) { t = Math.max(0, Math.min(1, t)); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function rgb(c, a) { return 'rgba(' + c[0].toFixed(0) + ',' + c[1].toFixed(0) + ',' + c[2].toFixed(0) + ',' + (a == null ? 1 : a) + ')'; }

const DAY = [
  [0.00, [95, 70, 125], [255, 175, 125]],
  [0.12, [80, 135, 205], [175, 210, 235]],
  [0.60, [65, 125, 200], [160, 200, 232]],
  [0.80, [80, 105, 175], [255, 200, 140]],
  [0.92, [55, 35, 95], [240, 120, 70]],
  [1.00, [22, 18, 52], [130, 60, 65]],
];
const NIGHT = [[10, 14, 34], [34, 44, 78]];
const dayTable = () => (theme.palette && theme.palette.DAY) || DAY;
const nightTable = () => (theme.palette && theme.palette.NIGHT) || NIGHT;
function dayColors(f) {
  const D = dayTable();
  for (let i = 1; i < D.length; i++) {
    if (f <= D[i][0]) {
      const t = (f - D[i - 1][0]) / (D[i][0] - D[i - 1][0]);
      return [mix(D[i - 1][1], D[i][1], t), mix(D[i - 1][2], D[i][2], t)];
    }
  }
  return [D[D.length - 1][1], D[D.length - 1][2]];
}

function skyIsDark() { return !connected || isNight() || dayFraction() > 0.92 || mode === 'idle' || weather.rain > 0.5; }

function skyColors(t) {
  let top, bottom;
  if (!connected) { top = [20, 22, 34]; bottom = [50, 54, 70]; }
  else if (isNight()) { top = nightTable()[0]; bottom = nightTable()[1]; }
  else { [top, bottom] = dayColors(dayFraction()); }
  if (connected && mode === 'needs_you') {
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    top = mix(top, mix([70, 20, 30], [120, 40, 30], pulse * 0.6), 0.85); bottom = mix(bottom, [200, 90, 40], 0.85);
  }
  if (connected && mode === 'idle') { top = mix(top, [120, 125, 135], 0.35); bottom = mix(bottom, [150, 155, 165], 0.45); }
  top = mix(top, [60, 70, 90], weather.rain * 0.7); bottom = mix(bottom, [110, 125, 145], weather.rain * 0.7);
  top = mix(top, [255, 205, 130], weather.sun * 0.35); bottom = mix(bottom, [255, 232, 175], weather.sun * 0.35);
  top = mix(top, [120, 125, 135], weather.cloud * 0.4); bottom = mix(bottom, [170, 175, 185], weather.cloud * 0.25);
  if (dawnFlash > 0) { top = mix(top, [255, 255, 255], dawnFlash * 0.45); bottom = mix(bottom, [255, 255, 255], dawnFlash * 0.45); }
  return [top, bottom];
}

const stars = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random() * 0.6, r: Math.random() * 1.4 + 0.3, tw: Math.random() * 6 }));

function drawSky(t) {
  const [top, bottom] = skyColors(t);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgb(top)); g.addColorStop(1, rgb(bottom));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  const f = dayFraction();
  const night = connected && isNight();
  const starA = night ? 1 : Math.max(0, (f - 0.85) / 0.15);
  if (connected && starA > 0) {
    for (const s of stars) {
      const a = (0.4 + 0.6 * Math.abs(Math.sin(t * 0.8 + s.tw))) * starA;
      ctx.fillStyle = 'rgba(255,255,255,' + (a * (1 - weather.cloud)).toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2); ctx.fill();
    }
  }

  if (connected && night) {
    const mx = W * 0.78, my = H * 0.18, r = 22;
    ctx.fillStyle = 'rgba(235,238,250,0.95)'; ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgb(nightTable()[0]); ctx.beginPath(); ctx.arc(mx - 9, my - 5, r * 0.85, 0, Math.PI * 2); ctx.fill();
  } else if (connected) {
    const sx = W * 0.08 + f * W * 0.84;
    const sy = H * 0.62 - Math.sin(f * Math.PI) * H * 0.5;
    const warmth = Math.max(0, 1 - Math.sin(f * Math.PI) * 1.4);
    const r = 24 + weather.sun * 18 + warmth * 10;
    const glowA = 0.35 + weather.sun * 0.35 + warmth * 0.2;
    const core = mix([255, 240, 180], [255, 140, 70], warmth);
    const glow = ctx.createRadialGradient(sx, sy, r * 0.4, sx, sy, r * 4);
    glow.addColorStop(0, rgb(core, glowA.toFixed(2))); glow.addColorStop(1, rgb(core, 0));
    ctx.fillStyle = glow; ctx.fillRect(sx - r * 4, sy - r * 4, r * 8, r * 8);
    ctx.fillStyle = rgb(core, 0.95);
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
  }

  if (weather.rain > 0.15) {
    ctx.fillStyle = 'rgba(90,100,120,' + (weather.rain * 0.7).toFixed(2) + ')';
    for (let i = 0; i < 5; i++) {
      const cx = ((i + 0.5) / 5) * W + Math.sin(t * 0.3 + i) * 20, cy = 30 + (i % 2) * 20;
      ctx.beginPath(); ctx.ellipse(cx, cy, W * 0.14, 26, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawWindows(t) {
  const now = Date.now();
  for (const [sid, r] of Object.entries(rects)) {
    const until = sunbeams[sid];
    if (until && until > now) {
      const left = (until - now) / 1000, total = sunbeamSeconds();
      const a = Math.min(1, left / 1.5) * 0.9;
      const g = ctx.createLinearGradient(0, 0, 0, r.y);
      g.addColorStop(0, 'rgba(255,240,170,' + (0.05 * a).toFixed(3) + ')'); g.addColorStop(1, 'rgba(255,230,140,' + (0.42 * a).toFixed(3) + ')');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(r.cx - 30, -10); ctx.lineTo(r.cx + 30, -10); ctx.lineTo(r.x + r.w + 24, r.y + 4); ctx.lineTo(r.x - 24, r.y + 4); ctx.closePath(); ctx.fill();
      // timer ring above the planter
      const ry = r.y - H * 0.6 * Math.max(0.5, r.scale) - 20;
      ctx.strokeStyle = 'rgba(255,240,170,' + (0.9 * a).toFixed(2) + ')'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(r.cx, Math.max(70, ry), 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (left / total)); ctx.stroke();
      ctx.fillStyle = 'rgba(255,245,200,' + a.toFixed(2) + ')'; ctx.font = 'bold 12px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('×' + sunbeamMult(), r.cx, Math.max(70, ry));
    }
    if (lastRain[sid] && now - lastRain[sid] < puddleMs()) {
      const a = Math.min(1, (6000 - (now - lastRain[sid])) / 1500) * 0.7;
      ctx.fillStyle = 'rgba(120,180,255,' + (0.35 * a).toFixed(2) + ')';
      ctx.beginPath(); ctx.ellipse(r.cx, r.y - 3, r.w / 2 - 6, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(200,230,255,' + a.toFixed(2) + ')'; ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(W_('puddle') + ' ×' + puddleMult(), r.cx, r.y + 16 + Math.sin(t * 4) * 1.5);
    }
  }
}

function drawParticles(layer) {
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
  for (const p of particles) {
    const back = p.kind === 'cloud' || p.kind === 'bird';
    if (layer === 'back' ? !back : back) continue;
    const fade = Math.min(1, p.age * 4, (p.life - p.age) * 2);
    if (fade <= 0) continue;
    ctx.font = p.size + 'px Consolas, "Cascadia Mono", monospace';
    if (p.kind === 'rain') {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(p.vy, p.vx));
      ctx.fillStyle = 'rgba(120,180,255,' + (0.85 * fade).toFixed(2) + ')'; ctx.textAlign = 'left';
      ctx.fillText(p.text, 0, 0); ctx.restore();
    } else if (p.kind === 'sun') {
      ctx.fillStyle = 'rgba(255,215,120,' + (0.9 * fade).toFixed(2) + ')'; ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x, p.y);
    } else if (p.kind === 'wind') {
      ctx.fillStyle = 'rgba(235,240,245,' + (0.8 * fade).toFixed(2) + ')'; ctx.textAlign = 'center';
      ctx.fillText('$ ' + p.text, p.x, p.y);
    } else if (p.kind === 'line') {
      ctx.font = '12px Consolas, "Cascadia Mono", monospace'; ctx.textAlign = 'left';
      ctx.fillStyle = p.color; ctx.globalAlpha = 0.92 * fade;
      ctx.fillText(p.text, p.x, p.y); ctx.globalAlpha = 1;
    } else if (p.kind === 'cloud') {
      const w = Math.max(90, ctx.measureText(p.text).width + 30);
      ctx.fillStyle = 'rgba(230,234,240,' + (0.75 * fade).toFixed(2) + ')';
      ctx.beginPath(); ctx.ellipse(p.x, p.y, w / 2, 20, 0, 0, Math.PI * 2);
      ctx.ellipse(p.x - w * 0.25, p.y + 4, w * 0.25, 14, 0, 0, Math.PI * 2);
      ctx.ellipse(p.x + w * 0.25, p.y + 4, w * 0.25, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(40,50,70,' + fade.toFixed(2) + ')'; ctx.textAlign = 'center'; ctx.fillText(p.text, p.x, p.y);
    } else if (p.kind === 'bird') {
      ctx.fillStyle = (skyIsDark() ? 'rgba(225,230,245,' : 'rgba(40,40,60,') + (0.9 * fade).toFixed(2) + ')'; ctx.textAlign = 'left';
      const flap = Math.sin(p.age * 12 + (p.phase || 0)) > 0 ? '⌄' : '–';
      ctx.fillText(flap + ' ' + p.text, p.x, p.y);
      if (p.catchable) { ctx.fillStyle = 'rgba(255,220,120,' + (0.5 * fade).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(p.x + 4, p.y, 3, 0, Math.PI * 2); ctx.fill(); }
    } else if (p.kind === 'spark') {
      ctx.fillStyle = 'rgba(150,240,170,' + fade.toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    } else if (p.kind === 'tag') {
      // a readable chip: what a tool call actually did
      ctx.save(); ctx.shadowBlur = 0;
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
      const w1 = ctx.measureText(p.text).width;
      ctx.font = '11px Consolas, "Cascadia Mono", monospace';
      const w2 = p.detail ? ctx.measureText(p.detail).width : 0;
      const bw = Math.min(W - 20, Math.max(w1, w2) + 22), bh = p.detail ? 38 : 24;
      const bx = Math.max(10, Math.min(W - bw - 10, p.x - bw / 2)), by = p.y - bh / 2;
      ctx.fillStyle = 'rgba(10,16,28,' + (0.78 * fade).toFixed(2) + ')';
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 7); ctx.fill();
      ctx.fillStyle = p.color; ctx.globalAlpha = fade; ctx.fillRect(bx, by + 6, 3, bh - 12);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif'; ctx.fillStyle = '#e9eef5';
      ctx.fillText(clipText(p.text, bw - 20), bx + 11, by + (p.detail ? 12 : bh / 2));
      if (p.detail) { ctx.font = '11px Consolas, "Cascadia Mono", monospace'; ctx.fillStyle = 'rgba(233,238,245,0.75)'; ctx.fillText(clipText(p.detail, bw - 20), bx + 11, by + 27); }
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(220,225,235,' + (0.7 * fade).toFixed(2) + ')'; ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x, p.y);
    }
  }
  ctx.restore();
}

// ---------- species ----------
const RARITY = {
  common: { name: 'Common', color: '#c7d2e0' },
  uncommon: { name: 'Uncommon', color: '#6fd38a' },
  rare: { name: 'Rare', color: '#5aa9ff' },
  epic: { name: 'Epic', color: '#c7b3ff' },
  legendary: { name: 'Legendary', color: '#ffcb5c' },
};
const SPECIES = {
  leafy: { name: 'Leafy green', rarity: 'common', weight: 40, shape: 'branch', yield: 1, water: 1, light: 1, blurb: 'The everyday plant. Branches, flowers, berries.' },
  sunflower: { name: 'Sunflower', rarity: 'common', weight: 22, shape: 'stem', yield: 1, water: 1, light: 0.6, blurb: 'One tall stem and a head that follows the sun. Light drains slower.' },
  cactus: { name: 'Cactus', rarity: 'uncommon', weight: 14, shape: 'cactus', yield: 1.05, water: 0.4, light: 1, blurb: 'Pads, spines, and pink blooms. Water drains at less than half speed.' },
  lavender: { name: 'Lavender', rarity: 'uncommon', weight: 10, shape: 'spikes', yield: 1.05, water: 1, light: 1, blurb: 'A clump of purple spikes that thickens with every stage.' },
  rose: { name: 'Rose bush', rarity: 'rare', weight: 7, shape: 'branch', yield: 1.15, water: 1, light: 1, thorns: true, blurb: 'Thorny from the start, roses from flowering. Yields 15% more.' },
  bonsai: { name: 'Bonsai', rarity: 'rare', weight: 4.5, shape: 'bonsai', yield: 1.15, water: 0.8, light: 1, blurb: 'A gnarled trunk with cloud-shaped pads and pink blossom. Yields 15% more.' },
  crystalfern: { name: 'Crystal fern', rarity: 'epic', weight: 2, shape: 'fronds', yield: 1.3, water: 1, light: 0.8, blurb: 'Translucent glowing fronds. Yields 30% more.' },
  moonbloom: { name: 'Moonbloom', rarity: 'legendary', weight: 0.5, shape: 'moon', yield: 1.6, water: 0.8, light: 0.8, blurb: 'A single silver bloom that opens wider with every stage. Yields 60% more.' },
};
for (const [id, sp] of Object.entries(SPECIES)) sp.id = id;
function pickSpecies(rand) {
  const roll = (rand || Math.random)() * Object.values(SPECIES).reduce((a, s) => a + s.weight, 0);
  let acc = 0;
  for (const [id, s] of Object.entries(SPECIES)) { acc += s.weight; if (roll < acc) return id; }
  return 'leafy';
}
const speciesOf = (p) => SPECIES[p && p.species] || SPECIES.leafy;

// ---------- ground ----------
function daylight() {
  if (!connected) return 0.55;
  if (isNight()) return 0.32;
  const f = dayFraction();
  if (f > 0.8) return 1 - ((f - 0.8) / 0.2) * 0.55;
  if (f < 0.1) return 0.72 + f * 2.8;
  return 1;
}
function col(c, k, a) { return 'rgba(' + Math.round(c[0] * k) + ',' + Math.round(c[1] * k) + ',' + Math.round(c[2] * k) + ',' + (a == null ? 1 : a) + ')'; }
const tufts = Array.from({ length: 90 }, (_, i) => ({ x: (i * 0.0613 + 0.02) % 1, y: ((i * 0.377) % 1), h: 5 + (i * 7) % 6, lean: ((i * 13) % 5 - 2) * 0.4 }));
const pebbles = Array.from({ length: 18 }, (_, i) => ({ x: (i * 0.173 + 0.05) % 1, y: ((i * 0.59 + 0.2) % 1), r: 1.5 + (i % 3) }));

function drawGround(t) {
  const dl = daylight();
  const [, skyBottom] = skyColors(t);
  // far hills, tinted by the sky
  for (let layer = 0; layer < 2; layer++) {
    const base = soilY - 18 - layer * 26;
    const c = mix([70, 120, 90], skyBottom, layer ? 0.55 : 0.35);
    ctx.fillStyle = col(c, dl * (layer ? 1 : 0.9));
    ctx.beginPath(); ctx.moveTo(0, soilY);
    for (let x = 0; x <= W; x += 16) {
      const y = base - Math.sin(x * 0.0035 + layer * 2.1) * 22 - Math.sin(x * 0.012 + layer) * 8 - Math.sin(x * 0.03) * 3;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, soilY); ctx.closePath(); ctx.fill();
  }
  // the ground itself
  const g = ctx.createLinearGradient(0, soilY - 8, 0, H);
  g.addColorStop(0, col([118, 168, 84], dl)); g.addColorStop(0.35, col([92, 140, 66], dl)); g.addColorStop(1, col([64, 96, 48], dl));
  ctx.fillStyle = g; ctx.fillRect(0, soilY - 8, W, H - soilY + 8);
  // a worn path along the middle of the ground
  ctx.fillStyle = col([150, 128, 92], dl, 0.35);
  ctx.beginPath(); ctx.moveTo(0, soilY + 40); ctx.quadraticCurveTo(W * 0.5, soilY + 58, W, soilY + 44); ctx.lineTo(W, soilY + 70); ctx.quadraticCurveTo(W * 0.5, soilY + 84, 0, soilY + 66); ctx.closePath(); ctx.fill();
  // grass tufts and pebbles
  ctx.strokeStyle = col([70, 120, 50], dl); ctx.lineWidth = 1.2; ctx.lineCap = 'round';
  for (const tf of tufts) {
    const x = tf.x * W, y = soilY + 4 + tf.y * (H - soilY - 8);
    const sway = Math.sin(t * 1.6 + x * 0.05) * 0.8 * (1 + weather.wind * 4);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + tf.lean + sway, y - tf.h); ctx.moveTo(x, y); ctx.lineTo(x + tf.lean * 0.4 + sway + 2, y - tf.h * 0.7); ctx.stroke();
  }
  ctx.fillStyle = col([160, 150, 135], dl);
  for (const pb of pebbles) { ctx.beginPath(); ctx.ellipse(pb.x * W, soilY + 10 + pb.y * (H - soilY - 20), pb.r * 1.4, pb.r, 0, 0, Math.PI * 2); ctx.fill(); }
}
function shadow(x, y, w, h, a) {
  ctx.fillStyle = 'rgba(20,30,20,' + (a == null ? 0.22 : a) + ')';
  ctx.beginPath(); ctx.ellipse(x, y, w / 2, h == null ? w * 0.14 : h, 0, 0, Math.PI * 2); ctx.fill();
}

// ---------- planter, stake, gate ----------
function drawPlanter(r, s, plant, isFocus) {
  const { x, w, y, h, cx } = r;
  const dl = daylight();
  shadow(cx, y + h + 3, w * 1.05, w * 0.06);
  // body with a lit left side and a darker right side
  const body = ctx.createLinearGradient(x, 0, x + w, 0);
  body.addColorStop(0, col(isFocus ? [214, 122, 72] : [200, 112, 66], dl)); body.addColorStop(0.55, col([181, 98, 58], dl)); body.addColorStop(1, col([140, 74, 44], dl));
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - 12, y + h); ctx.lineTo(x + 12, y + h); ctx.closePath(); ctx.fill();
  // one ring per compaction this session has lived through
  const rings = Math.min(6, (s && s.compactions) || 0);
  if (rings) {
    ctx.strokeStyle = col([120, 60, 36], dl, 0.55); ctx.lineWidth = 2;
    for (let i = 0; i < rings; i++) { const yy = y + 14 + i * 7, k = (yy - y) / h; ctx.beginPath(); ctx.moveTo(x + 12 * k + 2, yy); ctx.lineTo(x + w - 12 * k - 2, yy); ctx.stroke(); }
  }
  // rim
  const rim = ctx.createLinearGradient(x, 0, x + w, 0);
  rim.addColorStop(0, col([226, 140, 88], dl)); rim.addColorStop(1, col([160, 88, 52], dl));
  ctx.fillStyle = rim; ctx.beginPath(); ctx.roundRect(x - 5, y - 9, w + 10, 12, 3); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,' + (0.12 * dl).toFixed(2) + ')'; ctx.fillRect(x - 3, y - 8, w + 6, 2);
  // soil with a little texture
  ctx.fillStyle = col([74, 50, 34], dl); ctx.beginPath(); ctx.ellipse(cx, y - 3, w / 2 - 4, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = col([96, 66, 44], dl);
  for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.arc(cx - w / 2 + 10 + ((i * 37) % Math.max(20, w - 20)), y - 3 + ((i * 5) % 7) - 3, 1.4, 0, Math.PI * 2); ctx.fill(); }
  if (plant) {
    ctx.fillStyle = 'rgba(30,40,70,' + ((plant.water / waterCap()) * 0.35).toFixed(2) + ')';
    ctx.beginPath(); ctx.ellipse(cx, y - 3, w / 2 - 4, 8, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (s) {
    const label = sessionLabel(s);
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = Math.min(w - 16, ctx.measureText(label).width + 26);
    ctx.fillStyle = 'rgba(255,245,225,0.94)';
    ctx.beginPath(); ctx.roundRect(cx - tw / 2, y + h / 2 - 10, tw, 20, 5); ctx.fill();
    const lamp = { working: '#6fd38a', needs_you: '#ff8f4d', your_turn: '#ffcb5c', idle: '#8a93a6' }[s.status] || '#8a93a6';
    ctx.fillStyle = lamp; ctx.beginPath(); ctx.arc(cx - tw / 2 + 10, y + h / 2, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2b2620';
    ctx.save(); ctx.beginPath(); ctx.rect(cx - tw / 2 + 16, y, tw - 20, h); ctx.clip();
    ctx.fillText(label, cx + 6, y + h / 2); ctx.restore();
    // how full this session's context is, as a small line under the tag
    const pct = Math.round(100 * contextFraction(s));
    const ctxText = s.night ? '☽ compacting' : 'context ' + pct + '%';
    ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
    const cw = ctx.measureText(ctxText).width + 14;
    const warn = !s.night && pct >= 100 * compactAt * 0.85;
    ctx.fillStyle = warn ? 'rgba(255,170,90,0.94)' : 'rgba(255,245,225,0.85)';
    ctx.beginPath(); ctx.roundRect(cx - cw / 2, y + h / 2 + 12, cw, 15, 4); ctx.fill();
    ctx.fillStyle = warn ? '#3a1d05' : '#4a4036'; ctx.fillText(ctxText, cx, y + h / 2 + 19.5);
  }
}

function drawStake(r, s) {
  const prompt = (s && (s.prompt || (plants[s.id] && plants[s.id].prompt))) || '';
  const dl = daylight();
  const sx = r.x + r.w - 14, sy = r.y - 34;
  ctx.fillStyle = col([122, 84, 51], dl); ctx.fillRect(sx - 2, sy, 4, 34);
  const bw = Math.min(150, Math.max(70, r.w * 0.8)), bh = 24;
  const g = ctx.createLinearGradient(0, sy - 12, 0, sy + 12);
  g.addColorStop(0, col([226, 190, 122], dl)); g.addColorStop(1, col([200, 160, 96], dl));
  ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(sx - bw / 2, sy - 12, bw, bh, 4); ctx.fill();
  ctx.strokeStyle = col([120, 90, 50], dl); ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#3b2a12'; ctx.font = '11px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let text = prompt ? oneLine(prompt, 60) : 'no prompt yet';
  while (text.length > 4 && ctx.measureText(text).width > bw - 12) text = text.slice(0, -2) + '…';
  ctx.fillText(text, sx, sy);
}

// A lantern hangs from each stake and burns down as that session's context
// fills: full and bright when fresh, oil dropping and the flame guttering as
// compaction nears, out and smoking while compaction runs. It is per planter
// and gradual, so switching focus never changes it and nothing snaps.
const lanterns = {};
function drawLantern(r, s, t) {
  if (!s) return;
  const dl = daylight();
  const left = s.night ? 0 : Math.max(0, Math.min(1, 1 - contextFraction(s) / compactAt));
  // standing on the ground against the left side of the pot
  const k = Math.max(0.8, Math.min(1.3, r.scale || 1));
  const bx = r.x - 20 * k, by = r.y + r.h;            // base centre on the ground
  const gw = 28 * k, gh = 44 * k;                      // glass
  const gx = bx - gw / 2, gy = by - 5 * k - gh;
  shadow(bx + 4, by + 2, gw + 14, 3, 0.2);
  const metal = col([62, 58, 64], dl), metalDark = col([44, 42, 48], dl);
  // base and feet
  ctx.fillStyle = metal; ctx.beginPath(); ctx.roundRect(gx - 3, by - 6 * k, gw + 6, 6 * k, 2); ctx.fill();
  // glass, tinted by what is behind it
  ctx.fillStyle = 'rgba(255,250,230,' + (0.16 + 0.12 * dl).toFixed(2) + ')'; ctx.beginPath(); ctx.roundRect(gx, gy, gw, gh, 3); ctx.fill();
  // oil: the level is the context that is left
  const fillH = (gh - 4) * 0.62;               // the well: from the bottom of the glass up to the max line
  const oilH = fillH * left;
  ctx.fillStyle = 'rgba(232,160,48,0.88)'; ctx.beginPath(); ctx.roundRect(gx + 2, gy + gh - 2 - oilH, gw - 4, oilH, [0, 0, 2, 2]); ctx.fill();
  ctx.fillStyle = 'rgba(255,220,140,0.5)'; ctx.fillRect(gx + 2, gy + gh - 2 - oilH, gw - 4, 1.5 * k);
  // max fill line, with ticks at three quarters, half, and a quarter
  const lineY = gy + gh - 2 - fillH;
  ctx.strokeStyle = 'rgba(60,50,40,0.8)'; ctx.lineWidth = 1.2 * k; ctx.beginPath(); ctx.moveTo(gx + 2, lineY); ctx.lineTo(gx + gw - 2, lineY); ctx.stroke();
  ctx.lineWidth = 1; for (const q of [0.75, 0.5, 0.25]) { const ty = gy + gh - 2 - fillH * q; ctx.beginPath(); ctx.moveTo(gx + 2, ty); ctx.lineTo(gx + 2 + 4 * k, ty); ctx.stroke(); }
  ctx.fillStyle = 'rgba(60,50,40,0.8)'; ctx.font = (7 * k).toFixed(1) + 'px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText('max', gx + gw - 3, lineY - 1);
  // wick and flame
  const wx = gx + gw / 2, wy = gy + gh - 2 - oilH;
  ctx.fillStyle = metalDark; ctx.fillRect(wx - 0.8 * k, wy - 4 * k, 1.6 * k, 4 * k);
  if (left > 0) {
    const low = left < 0.25;
    const jitter = (low ? 0.7 : 0.15) * (Math.sin(t * 23 + r.x) * 0.5 + Math.sin(t * 37 + r.x) * 0.5);
    const fr = (3 + 6 * left + jitter) * k;
    const fy = wy - 4 * k - fr;
    const c = mix([255, 240, 190], [255, 120, 50], 1 - left);
    ctx.fillStyle = rgb(c, 0.95); ctx.beginPath(); ctx.ellipse(wx, fy, fr * 0.55, fr, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.ellipse(wx, fy + fr * 0.35, fr * 0.28, fr * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(120,120,130,0.35)';
    for (let i = 0; i < 3; i++) { const ph = (t * 0.6 + i * 0.33) % 1; ctx.beginPath(); ctx.arc(wx + Math.sin(ph * 6 + i) * 4 * k, gy + 6 * k - ph * 34 * k, (1.5 + ph * 3) * k, 0, Math.PI * 2); ctx.fill(); }
  }
  // frame, cap, and handle
  ctx.strokeStyle = metalDark; ctx.lineWidth = 1.4 * k; ctx.beginPath(); ctx.roundRect(gx, gy, gw, gh, 3); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(gx + gw * 0.33, gy); ctx.lineTo(gx + gw * 0.33, gy + gh); ctx.moveTo(gx + gw * 0.67, gy); ctx.lineTo(gx + gw * 0.67, gy + gh); ctx.stroke();
  ctx.fillStyle = metal; ctx.beginPath(); ctx.moveTo(gx - 3, gy); ctx.lineTo(gx + gw + 3, gy); ctx.lineTo(gx + gw - 3 * k, gy - 6 * k); ctx.lineTo(gx + 3 * k, gy - 6 * k); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = metal; ctx.lineWidth = 1.6 * k; ctx.beginPath(); ctx.arc(bx, gy - 6 * k, 6 * k, Math.PI, 0); ctx.stroke();
  // glow on the pot and plant, mostly after dark
  if (left > 0) {
    const ga = (0.06 + 0.32 * (1 - dl)) * (0.3 + 0.7 * left);
    const g = ctx.createRadialGradient(bx, gy + gh * 0.5, 4, bx, gy + gh * 0.5, (70 + 50 * left) * k);
    g.addColorStop(0, 'rgba(255,200,110,' + ga.toFixed(2) + ')'); g.addColorStop(1, 'rgba(255,200,110,0)');
    ctx.fillStyle = g; ctx.fillRect(bx - 140, gy - 120, 280, 280);
  }
  lanterns[s.id] = { x: bx, y: gy + gh / 2, w: gw, h: gh + 12 * k, left, pct: Math.round(100 * contextFraction(s)), night: Boolean(s.night) };
}
function hitLantern(x, y) {
  for (const [sid, l] of Object.entries(lanterns)) { if (!rects[sid]) continue; if (Math.abs(x - l.x) < l.w / 2 + 6 && Math.abs(y - l.y) < l.h / 2 + 4) return sid; }
  return null;
}

// 2. Something got done: a commit throws confetti over the planter, a push sends up
// fireworks, and a passing test run opens a sunbeam. The command text is enough.
function celebrateCommand(sid, command) {
  const r = rects[sid]; if (!r || !command) return;
  const cmd = String(command);
  const isGit = /(^|[\s;&|])git\s/.test(cmd);
  if (isGit && /\bpush\b/.test(cmd)) {
    for (let k = 0; k < 3; k++) setTimeout(() => { if (!W) return; ambient.push({ kind: 'rocket', age: 0, life: 1.1 + Math.random() * 0.4, phase: Math.random() * 6, x: r.cx + (Math.random() - 0.5) * 160, y: soilY - 10, vy: 0, hue: Math.floor(Math.random() * 360) }); const a = ambient[ambient.length - 1]; a.vy = -(H * 0.45) / a.life; }, k * 350);
    garden.fireworks = (garden.fireworks || 0) + 1;
    fly('pushed: fireworks!', '#ffcb5c');
  } else if (isGit && /\bcommit\b/.test(cmd)) {
    for (let k = 0; k < 40; k++) ambient.push({ kind: 'confetti', age: -Math.random() * 0.3, life: 2.6 + Math.random(), phase: Math.random() * 6, x: r.cx + (Math.random() - 0.5) * 40, y: r.y - H * 0.25, vx: (Math.random() - 0.5) * 220, vy: -120 - Math.random() * 160, hue: Math.floor(Math.random() * 360), spin: (Math.random() - 0.5) * 12 });
    fly('committed: confetti', '#9ad9a8');
  } else if (/\b(npm|pnpm|yarn|bun)( run)? test\b|\bpytest\b|\bjest\b|\bvitest\b|\bcargo test\b|\bgo test\b|\bnode --test\b|\bdotnet test\b/.test(cmd)) {
    sunbeams[sid] = Date.now() + sunbeamSeconds() * 1000;
    fly('tests passed: a sunbeam', '#ffcb5c');
  }
}

// 1. Helper gardeners: one per running subagent, working beside the planter until it stops.
function drawGardeners(r, s, t) {
  const agents = s && s.agents ? Object.entries(s.agents) : [];
  if (!agents.length) return;
  const dl = daylight();
  agents.slice(0, 4).forEach(([id, ag], i) => {
    const seed = (id.charCodeAt(0) || 7) + (id.charCodeAt(1) || 3);
    const gx = r.x + r.w + 22 + i * 26, gy = r.y + r.h;
    const work = Math.sin(t * 3.2 + seed);
    shadow(gx, gy + 2, 22, 3, 0.2);
    ctx.save(); ctx.translate(gx, gy);
    const shirt = [[86, 130, 92], [120, 96, 150], [170, 110, 70], [90, 110, 150]][seed % 4];
    ctx.fillStyle = col([70, 60, 80], dl); ctx.fillRect(-5, -12, 4, 12); ctx.fillRect(1, -12, 4, 12);
    ctx.fillStyle = col(shirt, dl); ctx.beginPath(); ctx.roundRect(-7, -30, 14, 19, 4); ctx.fill();
    ctx.fillStyle = col([241, 201, 165], dl); ctx.beginPath(); ctx.arc(0, -36, 6, 0, Math.PI * 2); ctx.fill();
    if (theme.hat === 'reef') { ctx.fillStyle = 'rgba(120,200,255,0.5)'; ctx.beginPath(); ctx.roundRect(-7, -40, 14, 8, 3); ctx.fill(); ctx.strokeStyle = col([40, 40, 60], dl); ctx.lineWidth = 1.5; ctx.stroke(); ctx.fillStyle = col([255, 120, 60], dl); ctx.fillRect(6, -50, 2.5, 16); }
    else if (theme.hat === 'clockwork') { ctx.fillStyle = col([40, 34, 34], dl); ctx.fillRect(-9, -41, 18, 3); ctx.fillRect(-6, -54, 12, 13); ctx.strokeStyle = col([200, 160, 80], dl); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(-3, -42, 2.5, 0, Math.PI * 2); ctx.arc(3, -42, 2.5, 0, Math.PI * 2); ctx.stroke(); }
    else if (theme.hat === 'bakery') { ctx.fillStyle = '#fff'; ctx.fillRect(-6, -44, 12, 5); ctx.beginPath(); ctx.arc(-4, -47, 4.5, 0, Math.PI * 2); ctx.arc(1, -49, 5, 0, Math.PI * 2); ctx.arc(5, -46, 4, 0, Math.PI * 2); ctx.fill(); }
    else if (theme.hat === 'space') { ctx.fillStyle = 'rgba(200,230,255,0.45)'; ctx.beginPath(); ctx.arc(0, -36, 9, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = col([200, 210, 230], dl); ctx.lineWidth = 1.5; ctx.stroke(); ctx.fillStyle = col([200, 210, 230], dl); ctx.fillRect(-6, -27, 12, 3); }
    else if (theme.hat === 'dino') { ctx.strokeStyle = col([120, 80, 50], dl); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-6, -40); ctx.lineTo(6, -40); ctx.stroke(); ctx.fillStyle = ['#e04a3a', '#f2c94c', '#3aa0e0'][seed % 3]; ctx.beginPath(); ctx.ellipse(4, -48 + Math.sin(t * 2 + seed), 2, 7, 0.3, 0, Math.PI * 2); ctx.fill(); }
    else if (theme.hat === 'wizard') { ctx.fillStyle = col([70, 50, 130], dl); ctx.beginPath(); ctx.ellipse(0, -40, 11, 3, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(-7, -40); ctx.lineTo(7, -40); ctx.lineTo(2 + Math.sin(t * 2 + seed) * 2, -60); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#ffd45c'; ctx.beginPath(); ctx.arc(0, -50, 1.6, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.fillStyle = col([200, 160, 90], dl); ctx.beginPath(); ctx.ellipse(0, -40, 10, 3, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.roundRect(-5, -47, 10, 8, 2); ctx.fill(); }
    // arms and rake, swinging as they work
    ctx.strokeStyle = col([241, 201, 165], dl); ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(6, -26); ctx.lineTo(14 + work * 3, -18 + work * 2); ctx.stroke();
    ctx.strokeStyle = col([122, 84, 51], dl); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(14 + work * 3, -18 + work * 2); ctx.lineTo(22 + work * 6, 0); ctx.stroke();
    ctx.lineWidth = 1.5; for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(22 + work * 6, 0); ctx.lineTo(22 + work * 6 + k * 4, 4); ctx.stroke(); }
    ctx.restore();
    if (ag.type) { ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '9px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(oneLine(ag.type, 12), gx, gy + 5); }
  });
}

// 6. An hourglass by the desk for the running turn: sand runs while Claude works, flips every five minutes.
const hourglass = { x: 0, y: 0, w: 22, h: 36 };
function turnElapsed(s) { if (!s || !(s.status === 'working' || s.status === 'needs_you' || s.status === 'limit')) return 0; const from = s.promptAt || s.firstSeen; return from ? Date.now() - from : 0; }
function drawHourglass(t) {
  const s = focused();
  const dl = daylight();
  hourglass.x = desk.x + desk.w + 16; hourglass.y = soilY;
  const { x, y, w, h } = hourglass;
  const ms = turnElapsed(s), running = ms > 0;
  const frac = running ? (ms % 300000) / 300000 : 0;
  shadow(x, y + 2, w + 8, 3, 0.18);
  const wood = col([122, 84, 51], dl);
  ctx.fillStyle = wood; ctx.fillRect(x - w / 2 - 2, y - h - 4, w + 4, 4); ctx.fillRect(x - w / 2 - 2, y - 4, w + 4, 4);
  ctx.fillStyle = wood; ctx.fillRect(x - w / 2 - 1, y - h, 2, h); ctx.fillRect(x + w / 2 - 1, y - h, 2, h);
  const top = y - h, mid = y - h / 2, bot = y - 4;
  const glass = () => { ctx.beginPath(); ctx.moveTo(x - w / 2 + 2, top); ctx.lineTo(x + w / 2 - 2, top); ctx.lineTo(x + 2, mid); ctx.lineTo(x + w / 2 - 2, bot); ctx.lineTo(x - w / 2 + 2, bot); ctx.lineTo(x - 2, mid); ctx.closePath(); };
  glass(); ctx.fillStyle = 'rgba(255,250,230,' + (0.16 + 0.12 * dl).toFixed(2) + ')'; ctx.fill();
  ctx.save(); glass(); ctx.clip();
  const sand = col([222, 190, 120], dl);
  ctx.fillStyle = sand;
  const topH = (h / 2 - 4) * (running ? 1 - frac : 1);
  ctx.fillRect(x - w / 2, mid - 2 - topH, w, topH);
  const botH = (h / 2 - 4) * (running ? frac : 0);
  ctx.beginPath(); ctx.moveTo(x - w / 2, bot); ctx.lineTo(x + w / 2, bot); ctx.lineTo(x + w / 2, bot - botH * 0.6); ctx.lineTo(x, bot - botH); ctx.lineTo(x - w / 2, bot - botH * 0.6); ctx.closePath(); ctx.fill();
  if (running && anyoneWorking()) { ctx.fillStyle = sand; ctx.fillRect(x - 0.7, mid - 2, 1.4, bot - mid); }
  ctx.restore();
  glass(); ctx.strokeStyle = 'rgba(60,50,40,0.6)'; ctx.lineWidth = 1; ctx.stroke();
  if (running) {
    const sec = Math.floor(ms / 1000), label = sec >= 60 ? Math.floor(sec / 60) + 'm ' + String(sec % 60).padStart(2, '0') + 's' : sec + 's';
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '600 10px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(label, x, y + 6);
  }
}
function hitHourglass(x, y) { return Math.abs(x - hourglass.x) < hourglass.w / 2 + 6 && y > hourglass.y - hourglass.h - 8 && y < hourglass.y + 18; }

function drawGate(t) {
  const { x, y, w } = gate;
  const dl = daylight();
  const wood = (k) => col([138, 106, 72], dl * k), woodLight = (k) => col([170, 132, 90], dl * k);
  shadow(x + w / 2, y + 4, w + 40, 5, 0.16);
  const post = (px) => {
    ctx.fillStyle = wood(1); ctx.fillRect(px - 3, y - 64, 6, 70);
    ctx.fillStyle = woodLight(1); ctx.fillRect(px - 3, y - 64, 2, 70);
    ctx.fillStyle = wood(0.8); ctx.beginPath(); ctx.moveTo(px - 5, y - 64); ctx.lineTo(px, y - 70); ctx.lineTo(px + 5, y - 64); ctx.closePath(); ctx.fill();
  };
  post(x); post(x + w);
  for (let fx = x + w + 14; fx < W - 6; fx += 16) {
    ctx.fillStyle = wood(1); ctx.fillRect(fx - 2, y - 48, 4, 54);
    ctx.fillStyle = woodLight(1); ctx.fillRect(fx - 2, y - 48, 1.5, 54);
    ctx.fillStyle = wood(0.85); ctx.beginPath(); ctx.moveTo(fx - 3, y - 48); ctx.lineTo(fx, y - 53); ctx.lineTo(fx + 3, y - 48); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = woodLight(0.95); ctx.fillRect(x + w + 4, y - 40, W - x - w - 4, 4); ctx.fillRect(x + w + 4, y - 18, W - x - w - 4, 4);
  const pm = (focused() && focused().permissionMode) || '';
  const openMode = !pm || pm === 'auto' || pm === 'bypassPermissions';
  ctx.save();
  ctx.translate(x + 3, y);
  if (!paused && !openMode) {
    // closed: Claude asks before acting (default or accept-edits), or is planning
    ctx.fillStyle = woodLight(1);
    for (let gx = 6; gx < w - 6; gx += 14) ctx.fillRect(gx, -52, 5, 56);
    ctx.fillRect(0, -40, w - 6, 4); ctx.fillRect(0, -16, w - 6, 4);
    ctx.fillStyle = wood(0.7); ctx.fillRect(w - 16, -30, 10, 4);
    if (pm === 'plan') {
      ctx.fillStyle = col([226, 190, 122], dl); ctx.beginPath(); ctx.roundRect((w - 6) / 2 - 24, -34, 48, 14, 3); ctx.fill();
      ctx.fillStyle = '#3b2a12'; ctx.font = '600 9px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('planning', (w - 6) / 2, -27);
    }
  } else if (paused) {
    ctx.fillStyle = woodLight(1);
    for (let gx = 6; gx < w - 6; gx += 14) ctx.fillRect(gx, -52, 5, 56);
    ctx.fillRect(0, -40, w - 6, 4); ctx.fillRect(0, -16, w - 6, 4);
    ctx.fillStyle = '#c94a3a'; ctx.beginPath(); ctx.arc((w - 6) / 2, -28, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7a2a1e'; ctx.fillRect((w - 6) / 2 - 2, -28, 4, 6);
  } else {
    ctx.transform(0.35, -0.18, 0, 1, 0, 0);
    ctx.fillStyle = col([176, 138, 94], dl, 0.9);
    for (let gx = 6; gx < w - 6; gx += 14) ctx.fillRect(gx, -52, 5, 56);
    ctx.fillRect(0, -40, w - 6, 4); ctx.fillRect(0, -16, w - 6, 4);
  }
  ctx.restore();
  drawGateVisitor(t);
}
// Whoever is waiting at the gate for permission, with their speech bubble.
function drawGateVisitor(t) {
  const { x, y, w } = gate;
  const s = liveSessions().find((v) => v.status === 'needs_you');
  if (!s) return;
  const vx = x + w / 2, vy = y - 8 + Math.sin(t * 2.2) * 2;
  shadow(vx, y + 2, 30, 4, 0.2);
  ctx.fillStyle = '#2f3c5a'; ctx.beginPath(); ctx.roundRect(vx - 11, vy - 46, 22, 40, 6); ctx.fill();
  ctx.fillStyle = '#3b4a6e'; ctx.fillRect(vx - 11, vy - 46, 6, 40);
  ctx.fillStyle = '#f1c9a5'; ctx.beginPath(); ctx.arc(vx, vy - 56, 11, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5a3a24'; ctx.beginPath(); ctx.arc(vx, vy - 60, 11, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#ff8f4d'; ctx.beginPath(); ctx.arc(vx, vy - 74, 4 + Math.sin(t * 6) * 1.5, 0, Math.PI * 2); ctx.fill();
  const line1 = s.pendingTool ? prettyTool(s.pendingTool.name) : 'permission';
  const line2 = s.pendingTool && s.pendingTool.text ? oneLine(s.pendingTool.text, 42) : (s.note || '');
  ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
  const bw = Math.min(260, Math.max(120, Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 24)), bh = line2 ? 42 : 26;
  const bx = Math.min(vx - bw / 2, W - bw - 8), by = vy - 86 - bh;
  ctx.fillStyle = 'rgba(255,250,235,0.96)'; ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 6); ctx.fill();
  ctx.strokeStyle = '#ff8f4d'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#7a2a1e'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(line1, bx + 10, by + 13);
  if (line2) { ctx.font = '11px Consolas, "Cascadia Mono", monospace'; ctx.fillStyle = '#3b2a12'; let tx = line2; while (tx.length > 4 && ctx.measureText(tx).width > bw - 20) tx = tx.slice(0, -2) + '…'; ctx.fillText(tx, bx + 10, by + 30); }
}

function qpoint(p0, p1, p2, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}

// ---------- plant renderer ----------
function seededRandom(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function tapered(p0, p1, p2, w0, w1, color) {
  const L = [], R = [], N = 8;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const [x, y] = qpoint(p0, p1, p2, u);
    const [x2, y2] = qpoint(p0, p1, p2, Math.min(1, u + 0.02));
    const dx = x2 - x, dy = y2 - y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len, w = (w0 + (w1 - w0) * u) / 2;
    L.push([x + nx * w, y + ny * w]); R.push([x - nx * w, y - ny * w]);
  }
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(L[0][0], L[0][1]);
  for (const p of L) ctx.lineTo(p[0], p[1]);
  for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
  ctx.closePath(); ctx.fill();
}

function leaf(x, y, angle, len, wid, fill, glow) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 10; }
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(len * 0.45, -wid, len, 0); ctx.quadraticCurveTo(len * 0.45, wid, 0, 0); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(len - 3, 0); ctx.stroke();
  ctx.restore();
}

function flower(x, y, r, petals, c1, c2, rot) {
  for (let k = 0; k < petals; k++) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot + (k / petals) * Math.PI * 2);
    ctx.fillStyle = c1; ctx.beginPath(); ctx.ellipse(r * 0.7, 0, r * 0.72, r * 0.36, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = c2; ctx.beginPath(); ctx.arc(x, y, r * 0.4, 0, Math.PI * 2); ctx.fill();
}

function rose(x, y, r, color, t) {
  ctx.save(); ctx.translate(x, y);
  for (let ring = 3; ring >= 0; ring--) {
    const rr = r * (0.35 + ring * 0.22), n = 4 + ring * 2;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + ring * 0.6 + t * 0.05;
      ctx.fillStyle = ring === 0 ? '#ffb3c1' : color;
      ctx.beginPath(); ctx.ellipse(Math.cos(a) * rr * 0.55, Math.sin(a) * rr * 0.55, rr * 0.6, rr * 0.38, a, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(80,0,20,0.25)'; ctx.lineWidth = 0.6; ctx.stroke();
    }
  }
  ctx.restore();
}

function berries(x, y, r, color) {
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + 0.4, bx = x + Math.cos(a) * r * 0.8, by = y + Math.sin(a) * r * 0.8;
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(bx - r * 0.3, by - r * 0.3, r * 0.3, 0, Math.PI * 2); ctx.fill();
  }
}

function gem(x, y, r, hue, t) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t * 0.8 + x * 0.01) * 0.15);
  ctx.shadowColor = 'hsla(' + hue + ',90%,70%,0.9)'; ctx.shadowBlur = 12;
  ctx.fillStyle = 'hsla(' + hue + ',85%,62%,0.95)';
  ctx.beginPath(); ctx.moveTo(0, -r * 1.3); ctx.lineTo(r * 0.8, 0); ctx.lineTo(0, r * 1.3); ctx.lineTo(-r * 0.8, 0); ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.moveTo(0, -r * 1.3); ctx.lineTo(r * 0.8, 0); ctx.lineTo(0, -r * 0.1); ctx.closePath(); ctx.fill();
  const tw = 0.5 + 0.5 * Math.sin(t * 5 + x);
  ctx.strokeStyle = 'rgba(255,255,255,' + (0.9 * tw).toFixed(2) + ')'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-r * 1.6, -r * 0.9); ctx.lineTo(-r * 0.6, -r * 0.9); ctx.moveTo(-r * 1.1, -r * 1.4); ctx.lineTo(-r * 1.1, -r * 0.4); ctx.stroke();
  ctx.restore();
}

const FLOWER_PALETTES = [['#ffd166', '#fff3b0'], ['#ff8fab', '#ffe1ea'], ['#c7b3ff', '#efe8ff'], ['#ffb37a', '#fff0d6'], ['#8fd3ff', '#e6f5ff']];

function branch(x, y, angle, len, width, depth, cfg, rnd, t, out) {
  const swayAmt = cfg.sway * (0.35 + depth * 0.3);
  const a = angle + swayAmt + cfg.wilt * (depth ? 0.25 : 0.12);
  const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
  const bend = (rnd() - 0.5) * len * 0.4;
  const mx = (x + ex) / 2 + Math.cos(a + Math.PI / 2) * bend, my = (y + ey) / 2 + Math.sin(a + Math.PI / 2) * bend;
  tapered([x, y], [mx, my], [ex, ey], width, Math.max(1.2, width * 0.58), cfg.bark);
  if (cfg.thorns && width > 2.2) {
    ctx.fillStyle = '#5a3d2a';
    for (let i = 1; i < 4; i++) {
      const [tx, ty] = qpoint([x, y], [mx, my], [ex, ey], i / 4); const side = i % 2 ? 1 : -1;
      const na = a + side * Math.PI / 2;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + Math.cos(na) * width * 0.9 + Math.cos(a) * 3, ty + Math.sin(na) * width * 0.9 + Math.sin(a) * 3); ctx.lineTo(tx + Math.cos(a) * 4, ty + Math.sin(a) * 4); ctx.closePath(); ctx.fill();
    }
  }
  const n = cfg.noLeaves ? 0 : Math.max(0, Math.round(cfg.leafDensity * len / 16 * (depth >= 3 ? 0.55 : depth === 2 ? 0.8 : 1)));
  for (let i = 0; i < n; i++) {
    const u = (i + 0.7) / (n + 0.4);
    const [lx, ly] = qpoint([x, y], [mx, my], [ex, ey], u);
    const side = i % 2 ? 1 : -1;
    const flutter = Math.sin(t * 1.7 + i * 1.3 + depth) * 0.06 * (1 + weather.wind * 3);
    const la = a + side * (0.95 + (rnd() - 0.5) * 0.5) + flutter + cfg.wilt * 0.6 * (side > 0 ? 1 : -1) * 0.5;
    const L = cfg.leafLen * (0.7 + rnd() * 0.5);
    leaf(lx, ly, la, L, L * cfg.leafAspect, cfg.leafColor(rnd, i, depth), (i + depth) % 3 === 0 ? cfg.leafGlow : null);
    if (cfg.vines && depth <= 1 && i === 0 && rnd() < 0.6) out.vines.push([lx, ly]);
  }
  if (depth < cfg.depth) {
    for (let c = 0; c < 2; c++) {
      const spread = (c === 0 ? -1 : 1) * (cfg.spread + rnd() * 0.38);
      branch(ex, ey, angle + spread, len * (cfg.shrink + rnd() * 0.16), width * 0.62, depth + 1, cfg, rnd, t, out);
    }
    if (cfg.depth >= 3 && depth === 0 && rnd() < 0.5) branch(ex, ey, angle + (rnd() - 0.5) * 0.3, len * 0.55, width * 0.5, depth + 1, cfg, rnd, t, out);
  } else {
    out.tips.push([ex, ey, a]);
  }
}

// species bodies -------------------------------------------------------------
function bodyStem(P) {
  // sunflower: one thick stem, big alternating leaves, a head that follows the sun
  const { cx, y, height, scale, t, si, f, extra, rnd, sway, wilt, out } = P;
  const p0 = [cx, y - 6], p2 = [cx + sway * 40 + wilt * 30, y - 6 - height * (1 - wilt * 0.2)], p1 = [cx + sway * 16, y - 6 - height * 0.5];
  tapered(p0, p1, p2, (3 + f * 6) * scale, (2 + f * 3) * scale, '#3f8f45');
  const leaves = Math.floor(2 + f * 7);
  for (let i = 0; i < leaves; i++) {
    const u = (i + 1) / (leaves + 1.5);
    const [lx, ly] = qpoint(p0, p1, p2, u);
    const side = i % 2 ? 1 : -1;
    const L = (18 + 26 * f) * scale * (1 - u * 0.3);
    leaf(lx, ly, side > 0 ? -0.35 + Math.sin(t + i) * 0.05 : Math.PI + 0.35 - Math.sin(t + i) * 0.05, L, L * 0.55, 'hsl(' + (105 + rnd() * 20) + ',55%,' + (34 + rnd() * 8) + '%)', null);
  }
  if (si >= 5) {
    const sunX = W * 0.08 + dayFraction() * W * 0.84;
    const tilt = Math.max(-0.35, Math.min(0.35, (sunX - cx) / W));
    const hx = p2[0] + tilt * 20, hy = p2[1];
    const R = (12 + f * 16 + Math.min(10, extra * 1.5)) * scale;
    const petals = 18 + Math.floor(f * 8);
    for (let k = 0; k < petals; k++) {
      ctx.save(); ctx.translate(hx, hy); ctx.rotate((k / petals) * Math.PI * 2 + t * 0.03);
      ctx.fillStyle = si >= 13 ? 'hsl(' + ((t * 20 + k * 12) % 360) + ',90%,65%)' : (k % 2 ? '#ffcb2f' : '#f5b400');
      ctx.beginPath(); ctx.ellipse(R * 0.95, 0, R * 0.5, R * 0.16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = si >= 6 ? '#4a2c14' : '#7a5a1c'; ctx.beginPath(); ctx.arc(hx, hy, R * 0.62, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let k = 0; k < 40; k++) { const a = k * 2.4, rr = R * 0.58 * Math.sqrt(k / 40); ctx.beginPath(); ctx.arc(hx + Math.cos(a) * rr, hy + Math.sin(a) * rr, 1.1 * scale, 0, Math.PI * 2); ctx.fill(); }
    out.crown = [hx, hy - R];
  }
  out.tips.push([p2[0], p2[1] - 4, -Math.PI / 2]);
}

function bodyCactus(P) {
  const { cx, y, height, scale, t, si, f, extra, rnd, sway, out } = P;
  const h = height * 0.62, w = (16 + 10 * f) * scale;
  const green = P.glowing ? '#4fd88a' : '#3d8f4a';
  const pad = (x, yy, pw, ph, ang) => {
    ctx.save(); ctx.translate(x, yy); ctx.rotate(ang + sway * 0.3);
    ctx.fillStyle = green; ctx.beginPath(); ctx.ellipse(0, -ph / 2, pw / 2, ph / 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1;
    for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(k * pw * 0.22, -ph * 0.1); ctx.lineTo(k * pw * 0.22, -ph * 0.9); ctx.stroke(); }
    ctx.strokeStyle = '#f3ead0'; ctx.lineWidth = 1;
    for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; const px = Math.cos(a) * pw / 2, py = -ph / 2 + Math.sin(a) * ph / 2; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px * 1.25, -ph / 2 + (py + ph / 2) * 1.25); ctx.stroke(); }
    ctx.restore();
    return [x + Math.sin(ang) * -ph, yy - Math.cos(ang) * ph];
  };
  const top = pad(cx, y - 4, w, h, 0);
  if (si >= 3) { const arms = si >= 7 ? 4 : 2; for (let k = 0; k < arms; k++) { const side = k % 2 ? 1 : -1; const ay = y - 4 - h * (0.35 + (k >> 1) * 0.25); const tip = pad(cx + side * w * 0.5, ay, w * 0.6, h * (0.45 - (k >> 1) * 0.1), side * 0.9); out.tips.push([tip[0], tip[1], -Math.PI / 2]); } }
  if (si >= 8) for (let k = 0; k < 3; k++) { const ox = (k - 1) * w * 0.9; pad(cx + ox, y - 2, w * 0.45, h * 0.22, (k - 1) * 0.3); }
  out.tips.unshift([top[0], top[1], -Math.PI / 2]);
  out.bloom = (tx, ty, i) => {
    if (si >= 6 && i % 2) { ctx.fillStyle = '#d7385e'; ctx.beginPath(); ctx.ellipse(tx, ty - 3 * scale, 5 * scale, 7 * scale, 0, 0, Math.PI * 2); ctx.fill(); return; }
    if (si >= 5) flower(tx, ty - 2 * scale, (6 + f * 3) * scale, 7, P.enchanted ? 'hsl(' + ((t * 25 + i * 40) % 360) + ',80%,72%)' : '#ff6fa3', '#ffe08a', t * 0.2 + i);
  };
}

function bodySpikes(P) {
  const { cx, y, height, scale, t, si, f, extra, rnd, sway, out } = P;
  const stems = 3 + Math.floor(f * 9) + Math.min(8, Math.floor(extra));
  for (let i = 0; i < stems; i++) {
    const side = (i / (stems - 1 || 1) - 0.5) * 2;
    const len = height * (0.55 + rnd() * 0.45), lean = side * (0.35 + rnd() * 0.2) + sway * 0.6;
    const p0 = [cx + side * 6 * scale, y - 6], p2 = [cx + Math.sin(lean) * len, y - 6 - Math.cos(lean) * len], p1 = [(p0[0] + p2[0]) / 2 + side * 6, (p0[1] + p2[1]) / 2];
    ctx.strokeStyle = '#6f8f5a'; ctx.lineWidth = 1.6 * scale; ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.quadraticCurveTo(p1[0], p1[1], p2[0], p2[1]); ctx.stroke();
    for (let k = 0; k < 3; k++) { const [lx, ly] = qpoint(p0, p1, p2, 0.15 + k * 0.12); leaf(lx, ly, (k % 2 ? 0.9 : Math.PI - 0.9) + lean, 8 * scale, 2 * scale, '#8aa47a', null); }
    if (si >= 5) {
      const buds = 6 + Math.floor(f * 6);
      for (let k = 0; k < buds; k++) {
        const [bx, by] = qpoint(p0, p1, p2, 0.62 + (k / buds) * 0.38);
        ctx.fillStyle = P.enchanted ? 'hsl(' + ((t * 25 + k * 30 + i * 20) % 360) + ',75%,70%)' : (k % 2 ? '#9b6fd6' : '#7d55c4');
        ctx.beginPath(); ctx.ellipse(bx + (k % 2 ? 2 : -2) * scale, by, 2.6 * scale, 3.6 * scale, lean, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (i % 3 === 0) out.tips.push([p2[0], p2[1], -Math.PI / 2 + lean]);
  }
  out.bloom = () => {};
}

function bodyFronds(P) {
  const { cx, y, height, scale, t, si, f, extra, rnd, sway, out } = P;
  const fronds = 4 + Math.floor(f * 6) + Math.min(6, Math.floor(extra));
  ctx.save();
  for (let i = 0; i < fronds; i++) {
    const side = (i / (fronds - 1 || 1) - 0.5) * 2;
    const len = height * (0.5 + rnd() * 0.5);
    const reach = side * len * 0.75 + sway * 30, lift = -len * (0.6 + rnd() * 0.4);
    const p0 = [cx, y - 6], p2 = [cx + reach, y - 6 + lift * 0.35], p1 = [cx + reach * 0.35, y - 6 + lift];
    ctx.shadowColor = 'rgba(120,255,240,0.9)'; ctx.shadowBlur = 8;
    ctx.strokeStyle = 'rgba(120,230,220,0.9)'; ctx.lineWidth = 2 * scale; ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.quadraticCurveTo(p1[0], p1[1], p2[0], p2[1]); ctx.stroke();
    const leaflets = 8 + Math.floor(f * 8);
    for (let k = 1; k <= leaflets; k++) {
      const u = k / (leaflets + 1);
      const [lx, ly] = qpoint(p0, p1, p2, u);
      const [nx, ny] = qpoint(p0, p1, p2, Math.min(1, u + 0.02));
      const ang = Math.atan2(ny - ly, nx - lx);
      const L = (8 + 10 * f) * scale * (1 - u * 0.5);
      const hue = P.enchanted ? (t * 30 + k * 20 + i * 40) % 360 : 175 + Math.sin(t + k) * 10;
      ctx.fillStyle = 'hsla(' + hue + ',80%,' + (60 + (k % 2) * 10) + '%,0.6)';
      leaf(lx, ly, ang - 1.0, L, L * 0.35, ctx.fillStyle, null); leaf(lx, ly, ang + 1.0, L, L * 0.35, ctx.fillStyle, null);
    }
    out.tips.push([p2[0], p2[1], -Math.PI / 2]);
  }
  ctx.restore();
  out.bloom = (tx, ty, i) => { if (si >= 5) gem(tx, ty, (3 + f * 2) * scale, (t * 30 + i * 50) % 360, t); };
}

function bodyMoon(P) {
  const { cx, y, height, scale, t, si, f, extra, rnd, sway, out } = P;
  const p0 = [cx, y - 6], p2 = [cx + sway * 30, y - 6 - height * 0.9], p1 = [cx + sway * 10, y - 6 - height * 0.5];
  tapered(p0, p1, p2, (3 + f * 4) * scale, 2 * scale, '#2e3a5c');
  for (let i = 0; i < 2 + Math.floor(f * 3); i++) { const [lx, ly] = qpoint(p0, p1, p2, 0.2 + i * 0.18); leaf(lx, ly, i % 2 ? -0.5 : Math.PI + 0.5, (14 + 10 * f) * scale, (6 + 3 * f) * scale, '#4a5a8a', null); }
  const open = Math.min(1, (si + P.prog) / 9);
  const R = (10 + f * 18 + Math.min(12, extra * 1.5)) * scale;
  const petals = 6 + Math.min(18, si);
  ctx.save(); ctx.translate(p2[0], p2[1]);
  const g = ctx.createRadialGradient(0, 0, 2, 0, 0, R * 2.4);
  g.addColorStop(0, 'rgba(230,236,255,' + (0.35 + 0.15 * Math.sin(t * 1.5)).toFixed(2) + ')'); g.addColorStop(1, 'rgba(230,236,255,0)');
  ctx.fillStyle = g; ctx.fillRect(-R * 2.4, -R * 2.4, R * 4.8, R * 4.8);
  for (let ring = 2; ring >= 0; ring--) {
    const rr = R * (0.45 + ring * 0.28) * (0.3 + 0.7 * open), n = petals - ring * 3;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + ring * 0.4 + t * 0.04;
      ctx.fillStyle = ring === 0 ? 'rgba(255,255,255,0.95)' : ring === 1 ? 'rgba(220,226,255,0.85)' : 'rgba(180,190,240,0.7)';
      ctx.beginPath(); ctx.ellipse(Math.cos(a) * rr * 0.6, Math.sin(a) * rr * 0.6, rr * 0.55, rr * 0.22, a, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.fillStyle = '#fff6c8'; ctx.beginPath(); ctx.arc(0, 0, R * 0.22, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  for (let i = 0; i < 6 + si; i++) {
    const a = t * 0.4 + i * 1.1, rr = R * (1.4 + (i % 4) * 0.35);
    const sx = p2[0] + Math.cos(a) * rr, sy = p2[1] + Math.sin(a) * rr * 0.6;
    ctx.fillStyle = 'rgba(255,255,255,' + (0.4 + 0.6 * Math.abs(Math.sin(t * 2 + i))).toFixed(2) + ')';
    ctx.beginPath(); ctx.arc(sx, sy, 1.5, 0, Math.PI * 2); ctx.fill();
  }
  out.crown = [p2[0], p2[1] - R];
  out.bloom = () => {};
}

function bodyBonsai(P) {
  const { cx, y, height, scale, t, si, f, extra, rnd, sway, wilt, out, cfg } = P;
  cfg.depth = si <= 2 ? 1 : si <= 5 ? 2 : 3; cfg.spread = 0.9; cfg.shrink = 0.7; cfg.noLeaves = true; cfg.bark = '#4a3524';
  branch(cx, y - 6, -Math.PI / 2 + 0.25, height * 0.32, (5 + f * 10) * scale, 0, cfg, rnd, t, out);
  // cloud pads at the tips
  out.tips.forEach(([tx, ty], i) => {
    const pw = (18 + f * 22) * scale, ph = pw * 0.45;
    const hue = P.glowing ? 150 : 110;
    for (let k = 0; k < 5; k++) {
      const ox = ((k - 2) / 2) * pw * 0.45, oy = -Math.abs(k - 2) * ph * 0.2;
      ctx.fillStyle = 'hsl(' + (hue + (k * 7) % 20) + ',50%,' + (32 + (k % 2) * 8) + '%)';
      ctx.beginPath(); ctx.ellipse(tx + ox, ty + oy - ph * 0.3, pw * 0.3, ph * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (si >= 5) for (let k = 0; k < 4 + Math.min(6, extra); k++) {
      ctx.fillStyle = P.enchanted ? 'hsl(' + ((t * 25 + k * 40 + i * 30) % 360) + ',80%,75%)' : (k % 2 ? '#ffb7c8' : '#ff8fab');
      ctx.beginPath(); ctx.arc(tx + (rnd() - 0.5) * pw * 0.9, ty - ph * 0.5 + (rnd() - 0.5) * ph * 0.8, 2.6 * scale, 0, Math.PI * 2); ctx.fill();
    }
  });
  out.bloom = () => {};
}

function drawPlant(r, sid, t, plant, wilt) {
  const cx = r.cx, y = r.y, scale = r.scale;
  const si = plantStage(plant), prog = plantProgress(plant);
  const sp = speciesOf(plant);
  const sway = Math.sin(t * 1.3) * (0.02 + weather.wind * 0.12) + Math.sin(t * 3.1) * weather.wind * 0.04;
  const rnd = seededRandom(hashStr((sid || 'plant') + (plant.species || '')));
  shadow(cx, y - 2, r.w * 0.5, 5, 0.1);

  if (si === 0) {
    ctx.fillStyle = '#5a3d2a'; ctx.beginPath(); ctx.ellipse(cx, y - 6, 12, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3d2a1c'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - 4, y - 8); ctx.lineTo(cx + 1, y - 5); ctx.lineTo(cx + 5, y - 9); ctx.stroke();
    if (prog > 0.4) {
      ctx.strokeStyle = sp.shape === 'moon' ? '#8fa0d4' : sp.shape === 'fronds' ? '#8ff0e0' : '#8fd47f'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx, y - 8); ctx.quadraticCurveTo(cx + sway * 20, y - 14, cx + sway * 30, y - 8 - prog * 20); ctx.stroke();
    }
    return;
  }

  const f = Math.min(1, (si + prog) / 7);
  const extra = Math.max(0, si - FRUITING + (si >= FRUITING ? prog : 0));
  const m = Math.max(0, si - 13 + (si >= 13 ? prog : 0));
  const height = (16 + H * 0.46 * (0.12 + 0.88 * f)) * (1 + Math.min(0.3, extra * 0.04)) * scale * (sp.shape === 'cactus' ? 0.75 : 1);
  const depth = si <= 2 ? 0 : si === 3 ? 1 : si <= 6 ? 2 : si <= 11 ? 3 : 4;
  const trunkLen = height * [1, 0.62, 0.46, 0.4, 0.36][depth];
  const thickness = (2.5 + f * 8 + Math.min(9, extra * 1.1)) * scale * (si >= 11 ? 1.3 : 1);
  const young = si < 4;
  const glowing = si >= 9 || sp.shape === 'fronds', enchanted = si >= 10, ancient = si >= 12, mythic = si >= 13;
  const pal = FLOWER_PALETTES[Math.floor(rnd() * FLOWER_PALETTES.length)];
  const leafHue = ancient ? 78 : glowing ? 150 : 100 + rnd() * 30;

  const cfg = {
    depth, sway, wilt, spread: 0.42, shrink: 0.6,
    bark: young && !sp.thorns ? '#3f8f45' : ancient ? '#4a3a2c' : si >= 8 ? '#5c4030' : '#6b4a2e',
    thorns: sp.thorns || si >= 11,
    vines: si >= 7 && sp.shape === 'branch' && !sp.thorns,
    leafDensity: (0.9 + f * 1.0) * (si >= 8 ? 1.1 : 1),
    leafLen: (10 + 16 * f + Math.min(6, extra * 0.8)) * scale * (si >= 11 ? 1.2 : 1),
    leafAspect: si >= 8 ? 0.5 : 0.42,
    leafGlow: mythic ? 'rgba(255,225,140,0.9)' : glowing ? 'rgba(160,255,190,0.85)' : null,
    leafColor: (rr, i, d) => {
      const shift = enchanted ? Math.sin(t * 0.6 + i * 0.8 + d) * 30 : 0;
      const hue = leafHue + shift + (rr() - 0.5) * 16 + (sp.thorns ? -10 : 0);
      const light = (si >= 8 ? 30 : 36) + rr() * 10 + (glowing ? 8 : 0);
      return 'hsl(' + hue.toFixed(0) + ',' + (glowing ? 65 : 55) + '%,' + light.toFixed(0) + '%)';
    },
  };

  if (glowing) {
    const g = ctx.createRadialGradient(cx, y - height * 0.55, 10, cx, y - height * 0.55, height * 0.85);
    const c = mythic ? '255,225,140,' : enchanted ? '200,170,255,' : sp.shape === 'fronds' ? '140,240,230,' : '170,255,190,';
    g.addColorStop(0, 'rgba(' + c + (0.22 + 0.08 * Math.sin(t * 2)).toFixed(2) + ')'); g.addColorStop(1, 'rgba(' + c + '0)');
    ctx.fillStyle = g; ctx.fillRect(cx - height, y - height * 1.5, height * 2, height * 1.7);
  }
  if (mythic) {
    const rings = 1 + Math.min(4, Math.floor(m));
    for (let k = 0; k < rings; k++) {
      const rr = height * (0.34 + k * 0.1), hy = y - height * 0.72;
      ctx.save(); ctx.translate(cx, hy); ctx.rotate(t * (0.25 + k * 0.1) * (k % 2 ? -1 : 1));
      ctx.strokeStyle = 'hsla(' + ((t * 30 + k * 60) % 360) + ',90%,78%,' + (0.75 - k * 0.1).toFixed(2) + ')'; ctx.lineWidth = 3.2 - k * 0.4;
      ctx.setLineDash([12 + k * 4, 10]); ctx.beginPath(); ctx.ellipse(0, 0, rr, rr * 0.35, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
    }
  }
  if (ancient && sp.shape !== 'cactus' && sp.shape !== 'spikes') {
    ctx.strokeStyle = '#4a3a2c'; ctx.lineCap = 'round';
    for (let k = 0; k < 5; k++) {
      const side = k % 2 ? 1 : -1, ox = side * (10 + k * 9) * scale;
      ctx.lineWidth = (5 - k * 0.7) * scale;
      ctx.beginPath(); ctx.moveTo(cx + side * 4, y - 4); ctx.quadraticCurveTo(cx + ox * 0.6, y - 2, cx + ox * 1.4, y + 14 + k * 3); ctx.stroke();
    }
  }

  const out = { tips: [], vines: [], bloom: null, crown: null };
  const P = { cx, y, height, scale, t, si, prog, f, extra, m, rnd, sway, wilt, out, cfg, glowing, enchanted, mythic };
  switch (sp.shape) {
    case 'stem': bodyStem(P); break;
    case 'cactus': bodyCactus(P); break;
    case 'spikes': bodySpikes(P); break;
    case 'fronds': bodyFronds(P); break;
    case 'moon': bodyMoon(P); break;
    case 'bonsai': bodyBonsai(P); break;
    default:
      branch(cx, y - 6, -Math.PI / 2, trunkLen, thickness, 0, cfg, rnd, t, out);
      if (si === 1 || si === 2) {
        leaf(cx - 2, y - 14, Math.PI + 0.5 + sway, 14 * scale, 8 * scale, '#7ccf7a', null);
        leaf(cx + 2, y - 14, -0.5 + sway, 14 * scale, 8 * scale, '#7ccf7a', null);
      }
  }

  if (cfg.vines) {
    ctx.strokeStyle = '#4d8a3f'; ctx.lineWidth = 1.6 * scale;
    out.vines.slice(0, 4).forEach(([vx, vy], k) => {
      const drop = (40 + k * 18) * scale;
      ctx.beginPath(); ctx.moveTo(vx, vy); ctx.quadraticCurveTo(vx + Math.sin(t + k) * 10, vy + drop * 0.6, vx + Math.sin(t * 0.7 + k) * 16, vy + drop); ctx.stroke();
      for (let i = 1; i <= 3; i++) leaf(vx + Math.sin(t * 0.7 + k) * 16 * (i / 3), vy + drop * (i / 3), (i % 2 ? 0.8 : -2.4), 7 * scale, 3.5 * scale, '#5aa64e', null);
    });
  }
  if (ancient && sp.shape === 'branch') {
    ctx.strokeStyle = 'rgba(140,170,110,0.8)'; ctx.lineWidth = 1;
    out.tips.slice(0, 6).forEach(([tx, ty], k) => { for (let s = 0; s < 3; s++) { ctx.beginPath(); ctx.moveTo(tx + s * 3 - 3, ty); ctx.lineTo(tx + s * 3 - 3 + Math.sin(t + k + s) * 3, ty + (14 + s * 6) * scale); ctx.stroke(); } });
  }

  const tips = out.tips;
  const rot = t * 0.15;
  tips.forEach(([tx, ty], i) => {
    if (out.bloom) { out.bloom(tx, ty, i); return; }
    const pick = rnd();
    if (mythic && i % 2 === 0) { gem(tx, ty - 4, (4 + Math.min(4, m)) * scale, (t * 20 + i * 47) % 360, t); return; }
    if (sp.thorns) {
      if (si >= 6 && pick < 0.3) { ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.ellipse(tx, ty, 3 * scale, 4.5 * scale, 0, 0, Math.PI * 2); ctx.fill(); return; }
      if (si >= 5) { rose(tx, ty, (6 + f * 4 + Math.min(4, extra * 0.4)) * scale, enchanted ? 'hsl(' + ((t * 25 + i * 40) % 360) + ',80%,62%)' : (i % 3 ? '#d7263d' : '#ff5c8a'), t + i); return; }
      return;
    }
    if (si >= 6 && pick < 0.45) { berries(tx, ty, (3 + Math.min(4, extra * 0.5)) * scale, si >= 11 ? '#c8322e' : '#e0483f'); return; }
    if (si >= 5) {
      const rr = (5 + f * 3 + Math.min(4, extra * 0.4)) * scale;
      const c1 = enchanted ? 'hsl(' + ((t * 25 + i * 40) % 360) + ',80%,72%)' : pal[0];
      flower(tx, ty, rr, 5 + (i % 2), c1, pal[1], rot + i);
      return;
    }
    if (si === 4 && pick < 0.5) { ctx.fillStyle = '#9fd67a'; ctx.beginPath(); ctx.ellipse(tx, ty, 3 * scale, 5 * scale, 0, 0, Math.PI * 2); ctx.fill(); }
  });

  if (si >= 8) {
    for (let k = 0; k < 3; k++) {
      const mx = cx + (k - 1) * (r.w * 0.28) + (rnd() - 0.5) * 8, my = y - 3;
      ctx.fillStyle = '#e9dcc0'; ctx.fillRect(mx - 1.5, my - 7, 3, 7);
      ctx.fillStyle = k % 2 ? '#c94a3a' : '#d9b370'; ctx.beginPath(); ctx.ellipse(mx, my - 7, 5, 3.2, 0, Math.PI, 0); ctx.fill();
    }
    ctx.fillStyle = 'rgba(110,160,80,0.75)';
    for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(r.x + 12 + k * (r.w - 24) / 3, y - 8, 7, 3, 0, 0, Math.PI * 2); ctx.fill(); }
  }
  if (ancient && tips.length && sp.shape === 'branch') {
    const [nx, ny] = tips[Math.floor(tips.length / 2)];
    ctx.fillStyle = '#8a6a3a'; ctx.beginPath(); ctx.ellipse(nx, ny + 2, 9 * scale, 4 * scale, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#dfeaf5'; for (let k = 0; k < 2; k++) { ctx.beginPath(); ctx.ellipse(nx + (k - 0.5) * 5 * scale, ny, 2.4 * scale, 3 * scale, 0, 0, Math.PI * 2); ctx.fill(); }
  }
  if (glowing) {
    const n = 6 + Math.min(14, Math.floor(extra * 2));
    for (let i = 0; i < n; i++) {
      const a = t * (0.5 + (i % 3) * 0.2) + i;
      const fx = cx + Math.cos(a) * (26 + (i % 5) * 12) * scale, fy = y - height * (0.3 + ((i * 7) % 10) / 14) + Math.sin(a * 1.7) * 12;
      const al = 0.4 + 0.6 * Math.abs(Math.sin(t * 3 + i));
      ctx.fillStyle = (mythic ? 'rgba(255,240,180,' : sp.shape === 'fronds' ? 'rgba(160,255,245,' : 'rgba(220,255,160,') + al.toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(fx, fy, 1.8, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (enchanted) {
    for (let i = 0; i < 8; i++) {
      const life = ((t * 0.25 + i * 0.37) % 1);
      const px = cx + Math.sin(t * 0.8 + i * 2) * (30 + i * 6) * scale, py = y - height * (0.35 + life * 0.9);
      ctx.fillStyle = 'hsla(' + ((i * 45 + t * 20) % 360) + ',80%,78%,' + (0.8 * (1 - life)).toFixed(2) + ')';
      ctx.save(); ctx.translate(px, py); ctx.rotate(t * 2 + i); ctx.beginPath(); ctx.ellipse(0, 0, 4 * scale, 2.2 * scale, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
  }
  if (mythic) {
    const orbit = 6 + Math.min(18, Math.floor(m) * 3), hy = y - height * 0.72;
    for (let i = 0; i < orbit; i++) {
      const a = t * (0.6 + (i % 3) * 0.25) + (i / orbit) * Math.PI * 2;
      const ox = cx + Math.cos(a) * height * 0.4, oy = hy + Math.sin(a) * height * 0.14;
      ctx.fillStyle = 'hsla(' + ((i * 30 + t * 40) % 360) + ',90%,80%,0.9)';
      ctx.beginPath(); ctx.arc(ox, oy, 2 + (Math.sin(a) + 1) * 0.8, 0, Math.PI * 2); ctx.fill();
    }
    if (m >= 2) {
      const ribbons = Math.min(4, Math.floor(m) - 1);
      for (let k = 0; k < ribbons; k++) {
        ctx.strokeStyle = 'hsla(' + ((t * 25 + k * 90) % 360) + ',85%,70%,0.35)'; ctx.lineWidth = 6 - k;
        ctx.beginPath();
        for (let x = -height * 0.6; x <= height * 0.6; x += 8) {
          const yy = y - height * (0.5 + k * 0.12) + Math.sin(x * 0.03 + t * 1.5 + k) * 14;
          if (x === -height * 0.6) ctx.moveTo(cx + x, yy); else ctx.lineTo(cx + x, yy);
        }
        ctx.stroke();
      }
    }
    if (m >= 4) {
      for (let k = 0; k < 3; k++) {
        const ph = (t * 0.7 + k * 0.33) % 1, sx = cx + (k - 1) * height * 0.25, sy = y - height * 1.02;
        ctx.strokeStyle = 'rgba(255,255,255,' + (1 - ph).toFixed(2) + ')'; ctx.lineWidth = 1.5;
        const rr = 4 + ph * 16;
        ctx.beginPath(); for (let q = 0; q < 4; q++) { const a = q * Math.PI / 4; ctx.moveTo(sx - Math.cos(a) * rr, sy - Math.sin(a) * rr); ctx.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr); } ctx.stroke();
      }
    }
  }
}

// ---------- mailbox, pests, upgrades ----------
function drawMailbox(t) {
  const { x, y, w, h, postH } = mailbox;
  const dl = daylight();
  const flagUp = unread > 0;   // the desk lamp shows an open hold; the mailbox only cares about letters
  shadow(x + w / 2, y + postH + 2, w * 1.3, 4, 0.2);
  ctx.fillStyle = col([107, 74, 46], dl); ctx.fillRect(x + w / 2 - 3, y, 6, postH);
  ctx.fillStyle = col([130, 92, 58], dl); ctx.fillRect(x + w / 2 - 3, y, 2, postH);
  const body = ctx.createLinearGradient(x, 0, x + w, 0);
  body.addColorStop(0, col([76, 96, 138], dl)); body.addColorStop(1, col([42, 54, 84], dl));
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h + 10); ctx.arc(x + w / 2, y - h + 10, w / 2, Math.PI, 0); ctx.lineTo(x + w, y); ctx.closePath(); ctx.fill();
  ctx.fillStyle = col([32, 42, 66], dl); ctx.fillRect(x + 4, y - 12, w - 8, 8);
  ctx.fillStyle = 'rgba(255,255,255,' + (0.15 * dl).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(x + w / 2, y - h + 10, w / 2 - 3, Math.PI * 1.1, Math.PI * 1.6); ctx.lineTo(x + w / 2, y - h + 10); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#c94a3a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x + w + 2, y - 8);
  if (flagUp) { ctx.lineTo(x + w + 2, y - h - 16); ctx.stroke(); ctx.fillStyle = '#c94a3a'; ctx.fillRect(x + w + 2, y - h - 16, 12, 9); }
  else { ctx.lineTo(x + w + 14, y - 8); ctx.stroke(); }
  if (flagUp) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    ctx.fillStyle = 'rgba(255,220,120,' + (0.25 + 0.35 * pulse).toFixed(2) + ')';
    ctx.beginPath(); ctx.arc(x + w / 2, y - h / 2, w * 0.9, 0, Math.PI * 2); ctx.fill();
  }
  if (unread > 0) {
    ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#c94a3a'; ctx.beginPath(); ctx.arc(x + w / 2, y - h - 6, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(String(unread), x + w / 2, y - h - 6);
  }
}

function drawPests(t) {
  for (const p of pests) {
    const pos = pestPos(p); if (!pos) continue;
    const bob = Math.sin(t * 3 + p.flap) * 1.5;
    const x = pos.x, y = pos.y + bob;
    ctx.fillStyle = '#1c1c24';
    ctx.beginPath(); ctx.ellipse(x, y, 12, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 9, y - 7, 6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 12, y - 2); ctx.lineTo(x - 22, y - 8); ctx.lineTo(x - 11, y + 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2c2c38'; ctx.beginPath(); ctx.ellipse(x - 2, y - 3, 7, 4, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8b04a';
    ctx.beginPath(); ctx.moveTo(x + 14, y - 7); ctx.lineTo(x + 22, y - 5); ctx.lineTo(x + 14, y - 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + 11, y - 8, 1.6, 0, Math.PI * 2); ctx.fill();
  }
}

// A glass greenhouse at the back of the garden (the greenhouse upgrade). It is a
// background prop, so planters and props stand in front of it; lamps glow inside after dark.
function drawGreenhouse(t) {
  if (!has('greenhouse')) return;
  const dl = daylight();
  const w = Math.max(96, Math.min(150, W * 0.11)), h = w * 0.62;
  const x = W * 0.27 - w / 2, y = soilY - 4;
  const ridge = y - h, eave = y - h * 0.55;
  const warm = Math.max(0, 1 - dl * 1.15);
  shadow(x + w / 2, y + 3, w * 1.05, 5, 0.15);
  const outline = () => { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, eave); ctx.lineTo(x + w / 2, ridge); ctx.lineTo(x + w, eave); ctx.lineTo(x + w, y); ctx.closePath(); };
  // glass, tinted by the hills behind it
  outline(); ctx.fillStyle = 'rgba(205,240,255,' + (0.26 + 0.08 * dl).toFixed(2) + ')'; ctx.fill();
  if (warm > 0.02) { outline(); const g = ctx.createLinearGradient(0, ridge, 0, y); g.addColorStop(0, 'rgba(255,200,110,0)'); g.addColorStop(1, 'rgba(255,200,110,' + (0.5 * warm).toFixed(2) + ')'); ctx.fillStyle = g; ctx.fill(); }
  // benches and the plants on them
  ctx.fillStyle = col([120, 95, 65], Math.max(dl, 0.45), 0.9); ctx.fillRect(x + 6, y - 9, w * 0.36, 2); ctx.fillRect(x + w * 0.58, y - 9, w * 0.36, 2);
  for (let i = 0; i < 6; i++) {
    if (i === 3) continue;   // the door
    const px = x + w * (0.1 + i * 0.16), r = 4 + (i % 3) * 1.5 + Math.sin(t * 0.8 + i) * 0.5;
    ctx.fillStyle = col(i % 2 ? [70, 140, 80] : [96, 160, 90], Math.max(dl, 0.5), 0.85);
    ctx.fillRect(px - 1, y - 16 - r, 2, r + 8);
    ctx.beginPath(); ctx.arc(px, y - 16 - r, r, 0, Math.PI * 2); ctx.fill();
    if (i % 2) { ctx.fillStyle = col([240, 120, 150], Math.max(dl, 0.5)); ctx.beginPath(); ctx.arc(px + r * 0.4, y - 17 - r * 1.3, 1.6, 0, Math.PI * 2); ctx.fill(); }
  }
  // frame and panes
  const frame = 'rgba(240,252,255,' + (0.5 + 0.35 * dl).toFixed(2) + ')';
  ctx.strokeStyle = frame; ctx.lineJoin = 'round'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, eave); ctx.lineTo(x + w, eave);
  ctx.moveTo(x, (eave + y) / 2); ctx.lineTo(x + w, (eave + y) / 2);
  for (let i = 1; i < 6; i++) { const px = x + w * i / 6; ctx.moveTo(px, eave); ctx.lineTo(px, y); }
  for (let i = 1; i < 3; i++) { const f = i / 3; ctx.moveTo(x + w / 2 * f, eave + (ridge - eave) * f); ctx.lineTo(x + w / 2 * f, eave); ctx.moveTo(x + w - w / 2 * f, eave + (ridge - eave) * f); ctx.lineTo(x + w - w / 2 * f, eave); }
  ctx.stroke();
  ctx.lineWidth = 1.6; outline(); ctx.stroke();
  // door and finial
  ctx.lineWidth = 1.2; ctx.strokeRect(x + w / 2 - w * 0.08, y - (y - eave) * 0.85, w * 0.16, (y - eave) * 0.85);
  ctx.fillStyle = frame; ctx.beginPath(); ctx.arc(x + w / 2, ridge - 3, 1.8, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(x + w / 2 - 0.6, ridge - 3, 1.2, 3);
  // a sun glint on the roof by day
  if (dl > 0.4) { ctx.fillStyle = 'rgba(255,255,255,' + (0.22 * dl).toFixed(2) + ')'; ctx.beginPath(); ctx.moveTo(x + w * 0.12, eave - 2); ctx.lineTo(x + w * 0.3, eave - (eave - ridge) * 0.6); ctx.lineTo(x + w * 0.36, eave - (eave - ridge) * 0.6); ctx.lineTo(x + w * 0.2, eave - 2); ctx.closePath(); ctx.fill(); }
}

function drawUpgrades(t) {
  const dl = daylight();
  if (has('barrel')) {
    const x = mailbox.x + mailbox.w + 22, y = soilY;
    shadow(x + 13, y + 5, 34, 4, 0.2);
    const g = ctx.createLinearGradient(x, 0, x + 26, 0); g.addColorStop(0, col([110, 140, 170], dl)); g.addColorStop(1, col([62, 84, 112], dl));
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(x, y - 34, 26, 38, 4); ctx.fill();
    ctx.fillStyle = col([50, 68, 92], dl); ctx.fillRect(x, y - 26, 26, 3); ctx.fillRect(x, y - 10, 26, 3);
    ctx.fillStyle = col([130, 165, 195], dl); ctx.beginPath(); ctx.ellipse(x + 13, y - 34, 13, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col([70, 120, 180], dl, 0.8); ctx.beginPath(); ctx.ellipse(x + 13, y - 34, 10, 2.6, 0, 0, Math.PI * 2); ctx.fill();
  }
  const room = gate.x - 8;
  if (has('compost')) {
    const x = room - (has('scarecrow') ? 56 : 0) - 40, y = soilY;
    shadow(x + 12, y + 5, 32, 4, 0.2);
    ctx.fillStyle = col([76, 59, 42], dl); ctx.beginPath(); ctx.roundRect(x, y - 26, 24, 30, 3); ctx.fill();
    ctx.fillStyle = col([96, 76, 52], dl); ctx.fillRect(x, y - 26, 6, 30);
    ctx.fillStyle = col([107, 90, 58], dl); ctx.fillRect(x - 2, y - 28, 28, 5);
    ctx.fillStyle = 'rgba(160,200,120,0.6)'; for (let i = 0; i < 3; i++) { const yy = y - 30 - ((t * 12 + i * 9) % 26); ctx.beginPath(); ctx.arc(x + 6 + i * 6, yy, 2, 0, Math.PI * 2); ctx.fill(); }
  }
  if (has('scarecrow')) {
    const x = room - 28, y = soilY - 2;
    shadow(x, y + 6, 36, 4, 0.2);
    ctx.fillStyle = col([138, 106, 72], dl); ctx.fillRect(x - 2, y - 70, 4, 72); ctx.fillRect(x - 22, y - 52, 44, 3);
    ctx.fillStyle = col([201, 162, 77], dl); ctx.beginPath(); ctx.roundRect(x - 9, y - 58, 18, 26, 4); ctx.fill();
    ctx.fillStyle = col([170, 130, 60], dl); ctx.fillRect(x - 9, y - 58, 5, 26);
    ctx.fillStyle = col([232, 211, 162], dl); ctx.beginPath(); ctx.arc(x, y - 66, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3b2a12'; ctx.fillRect(x - 3, y - 68, 1.5, 1.5); ctx.fillRect(x + 2, y - 68, 1.5, 1.5);
    ctx.fillStyle = col([107, 74, 46], dl); ctx.fillRect(x - 12, y - 73, 24, 3); ctx.fillRect(x - 7, y - 80, 14, 8);
  }
  if (has('feeder')) {
    const x = Math.min(W - 30, gate.x + gate.w + 40), y = soilY - 44;
    ctx.fillStyle = col([138, 106, 72], dl); ctx.fillRect(x - 1, y - 20, 2, 14);
    ctx.fillStyle = '#c94a3a'; ctx.beginPath(); ctx.moveTo(x - 10, y - 6); ctx.lineTo(x + 10, y - 6); ctx.lineTo(x, y - 14); ctx.closePath(); ctx.fill();
    ctx.fillStyle = col([217, 179, 112], dl); ctx.fillRect(x - 7, y - 6, 14, 10);
    ctx.fillStyle = col([170, 130, 70], dl); ctx.fillRect(x - 7, y - 6, 3, 10);
  }
}

function clipText(text, maxW) {
  let t = String(text || '');
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 2 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

// Claude's latest words, spoken by the plant.
function drawBubbles(t) {
  const now = Date.now();
  for (const [sid, b] of Object.entries(bubbles)) {
    const r = rects[sid]; if (!r) continue;
    const age = (now - b.at) / 1000;
    if (age > 14) { delete bubbles[sid]; continue; }
    const a = Math.min(1, age * 3, (14 - age) / 2);
    const first = b.text.replace(/\s+/g, ' ').trim();
    ctx.font = '13px "Segoe UI", system-ui, sans-serif';
    const maxW = Math.min(300, Math.max(180, r.w * 1.6));
    const lines = wrapText(first, maxW - 24, 3);
    const bw = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 24), bh = lines.length * 18 + 16;
    const bx = Math.max(8, Math.min(W - bw - 8, r.cx - bw / 2)), by = Math.max(60, r.y - H * 0.5 * Math.max(0.6, r.scale) - bh - 30);
    ctx.fillStyle = (b.thought ? 'rgba(236,240,250,' : 'rgba(255,250,236,') + (0.95 * a).toFixed(2) + ')';
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 10); ctx.fill();
    if (b.thought) {
      // a thought bubble: little circles instead of a tail
      ctx.beginPath(); ctx.arc(r.cx - 4, by + bh + 8, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r.cx + 4, by + bh + 19, 3, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(r.cx - 8, by + bh); ctx.lineTo(r.cx + 8, by + bh); ctx.lineTo(r.cx, by + bh + 12); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = (b.thought ? 'rgba(60,64,80,' : 'rgba(36,32,26,') + a.toFixed(2) + ')'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = (b.thought ? 'italic ' : '') + '13px "Segoe UI", system-ui, sans-serif';
    lines.forEach((l, i) => ctx.fillText(l, bx + 12, by + 9 + i * 18));
  }
}
function wrapText(text, maxW, maxLines) {
  const words = text.split(' '); const lines = []; let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width <= maxW) { cur = test; continue; }
    if (cur) lines.push(cur);
    cur = w;
    if (lines.length === maxLines - 1) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  const used = lines.join(' ').length;
  if (used < text.length) lines[lines.length - 1] = clipText(lines[lines.length - 1] + '…', maxW);
  return lines;
}

function drawFloaters() {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const f of floaters) {
    const a = (1 - f.age / 1.2).toFixed(2);
    if (f.cls === 'crit') { ctx.font = 'bold 18px "Segoe UI", system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,203,92,' + a + ')'; }
    else if (f.cls === 'window') { ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,240,170,' + a + ')'; }
    else { ctx.font = 'bold 14px "Segoe UI", system-ui, sans-serif'; ctx.fillStyle = 'rgba(160,245,180,' + a + ')'; }
    ctx.fillText(f.text, f.x, f.y - 12);
  }
}

function drawPausedFrame(t) {
  if (!paused) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,143,77,' + (0.5 + 0.4 * Math.sin(t * 3)).toFixed(2) + ')';
  ctx.lineWidth = 6; ctx.setLineDash([18, 12]); ctx.lineDashOffset = -t * 30;
  ctx.strokeRect(3, 3, W - 6, H - 6);
  ctx.restore();
  ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,143,77,0.95)';
  ctx.fillText('GATE CLOSED · Claude’s next tool call will be refused', W / 2, 58);
}

// ?gallery=1 shows every stage side by side, for judging the plant art.
// ?gallery=1&species=cactus picks a species; ?gallery=1&species=all shows one row per species.
const GALLERY = /[?&]gallery/.test(location.search);
const GALLERY_SPECIES = (location.search.match(/[?&]species=([a-z]+)/) || [])[1] || 'leafy';
const GALLERY_STAGES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 17];
function drawGallery(t) {
  drawSky(t);
  const all = GALLERY_SPECIES === 'all';
  const stagesList = all ? [2, 4, 6, 9, 13] : GALLERY_STAGES;
  const speciesList = all ? Object.keys(SPECIES) : [GALLERY_SPECIES in SPECIES ? GALLERY_SPECIES : 'leafy'];
  const cols = all ? stagesList.length : 5;
  const items = [];
  for (const sp of speciesList) for (const k of stagesList) items.push([sp, k]);
  const rows = Math.ceil(items.length / cols);
  const cw = W / cols, rh = H / rows;
  items.forEach(([sp, k], i) => {
    const colI = i % cols, row = Math.floor(i / cols);
    const w = all ? 80 : Math.min(150, cw * 0.7);
    const r = { x: colI * cw + cw / 2 - w / 2, w, cx: colI * cw + cw / 2, y: row * rh + rh * 0.86, h: all ? 18 : 30, scale: Math.min(all ? 0.3 : 0.42, rh / 720) };
    const plant = { sap: STAGES[k] * 1.3, grown: k * STAGE_MINUTES * 60000 + 30000, water: 70, light: 70, nutrients: 60, born: Date.now(), species: sp };
    drawPlanter(r, null, plant, false);
    drawPlant(r, 'gallery-' + sp + k, t + k, plant, 0);
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '600 11px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((all ? SPECIES[sp].name + ' · ' : '') + k + ' · ' + stageName(k), r.cx, r.y + r.h + 10);
  });
}

function draw(t) {
  if (GALLERY) { drawGallery(t); return; }
  layout();
  R_('sky', drawSky)(t);
  drawAmbient('back', t);
  R_('ground', drawGround)(t);
  R_('greenhouse', drawGreenhouse)(t);
  R_('windows', drawWindows)(t);
  drawParticles('back');
  R_('gate', drawGate)(t);
  R_('mailbox', drawMailbox)(t);
  shadow(desk.x + desk.w / 2, desk.y + 4, desk.w + 16, 4, 0.18);
  R_('desk', drawDesk)(t);
  R_('hourglass', drawHourglass)(t);
  const foc = focused();
  const order = liveSessions().sort((a, b) => a.firstSeen - b.firstSeen);
  if (!order.length && placeholderRect) {
    R_('planter', drawPlanter)(placeholderRect, null, null, false);
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '12px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('waiting for a session', placeholderRect.cx, placeholderRect.y + placeholderRect.h / 2);
  }
  for (const s of order) {
    const r = rects[s.id]; if (!r) continue;
    const plant = plantFor(s.id);
    R_('planter', drawPlanter)(r, s, plant, foc && foc.id === s.id);
    R_('stake', drawStake)(r, s);
    R_('plant', drawPlant)(r, s.id, t + (s.firstSeen % 1000) / 300, plant, s.status === 'needs_you' ? 0.35 : 0);
    R_('lantern', drawLantern)(r, s, t);
    R_('gardeners', drawGardeners)(r, s, t);
  }
  R_('upgrades', drawUpgrades)(t);
  R_('pests', drawPests)(t);
  R_('critters', drawCritters)(t);
  drawAmbient('front', t);
  drawParticles('front');
  drawFloaters();
  drawPausedFrame(t);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  tick(dt); draw(now / 1000);
  requestAnimationFrame(frame);
}
if (GALLERY) { for (const id of ['hud', 'panel', 'board', 'attention']) $(id).style.display = 'none'; }
// ---------- theme: wizard tower ----------
// The same game with a tower instead of a plant: mana for sap, runes for seeds,
// ether, starlight, and ley power for the meters, imps for crows, wisps for bees.
(function registerWizard() {
  const stone = (k, dl, a) => col([k, k, k + 8], dl, a);
  function wizGround(t) {
    const dl = daylight();
    const [, skyBottom] = skyColors(t);
    // jagged far peaks tinted by the sky
    for (let layer = 0; layer < 2; layer++) {
      const base = soilY - 24 - layer * 30;
      ctx.fillStyle = col(mix([60, 45, 90], skyBottom, layer ? 0.5 : 0.3), dl * (layer ? 1 : 0.9));
      ctx.beginPath(); ctx.moveTo(0, soilY);
      for (let x = 0; x <= W; x += 14) {
        const y = base - Math.abs(Math.sin(x * 0.004 + layer * 1.7)) * 44 - Math.abs(Math.sin(x * 0.017 + layer)) * 14 - (Math.sin(x * 0.05) > 0.7 ? 10 : 0);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, soilY); ctx.closePath(); ctx.fill();
    }
    // flagstone floor
    const g = ctx.createLinearGradient(0, soilY - 8, 0, H);
    g.addColorStop(0, stone(118, dl)); g.addColorStop(0.4, stone(92, dl)); g.addColorStop(1, stone(58, dl));
    ctx.fillStyle = g; ctx.fillRect(0, soilY - 8, W, H - soilY + 8);
    ctx.strokeStyle = 'rgba(20,18,30,' + (0.35 * dl + 0.1).toFixed(2) + ')'; ctx.lineWidth = 1;
    for (let row = 0; row < 6; row++) {
      const y = soilY + 6 + row * ((H - soilY) / 6);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      const off = (row % 2) * 45;
      for (let x = off; x < W; x += 90) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + (H - soilY) / 6); ctx.stroke(); }
    }
    // runes set into the floor, pulsing
    for (const pb of pebbles) {
      const x = pb.x * W, y = soilY + 10 + pb.y * (H - soilY - 20);
      const al = 0.25 + 0.35 * Math.max(0, Math.sin(t * 0.8 + pb.x * 20));
      ctx.strokeStyle = 'rgba(150,120,255,' + al.toFixed(2) + ')'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, 2 + pb.r * 2, 0, Math.PI * 2); ctx.stroke();
    }
    // moss tufts in the cracks
    ctx.strokeStyle = col([70, 110, 80], dl); ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    for (const tf of tufts) {
      if (tf.h > 7) continue;
      const x = tf.x * W, y = soilY + 4 + tf.y * (H - soilY - 8);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + tf.lean, y - tf.h * 0.7); ctx.stroke();
    }
  }
  function wizPlanter(r, s, plant, isFocus) {
    const { x, w, y, h, cx } = r;
    const dl = daylight();
    shadow(cx, y + h + 3, w * 1.05, w * 0.06);
    const body = ctx.createLinearGradient(x, 0, x + w, 0);
    body.addColorStop(0, stone(isFocus ? 150 : 138, dl)); body.addColorStop(0.55, stone(112, dl)); body.addColorStop(1, stone(80, dl));
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.moveTo(x - 4, y + h); ctx.lineTo(x + 4, y); ctx.lineTo(x + w - 4, y); ctx.lineTo(x + w + 4, y + h); ctx.closePath(); ctx.fill();
    // rune band
    ctx.strokeStyle = 'rgba(150,120,255,' + (0.35 + 0.25 * Math.sin(Date.now() / 700)).toFixed(2) + ')'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x + 8, y + h * 0.62); ctx.lineTo(x + w - 8, y + h * 0.62); ctx.stroke();
    ctx.font = '600 9px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(190,170,255,0.7)';
    for (let i = 0; i < Math.floor(w / 26); i++) ctx.fillText(['ᚠ', 'ᛉ', 'ᚨ', 'ᛟ', 'ᚱ', 'ᛏ'][i % 6], x + 18 + i * 26, y + h * 0.62 - 7);
    const rings = Math.min(6, (s && s.compactions) || 0);
    if (rings) { ctx.strokeStyle = stone(50, dl, 0.7); ctx.lineWidth = 2; for (let i = 0; i < rings; i++) { const yy = y + 12 + i * 6; ctx.beginPath(); ctx.moveTo(x + 6, yy); ctx.lineTo(x + w - 6, yy); ctx.stroke(); } }
    // cap stone
    ctx.fillStyle = stone(160, dl); ctx.beginPath(); ctx.roundRect(x - 2, y - 9, w + 4, 12, 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,' + (0.12 * dl).toFixed(2) + ')'; ctx.fillRect(x, y - 8, w, 2);
    if (plant) { ctx.fillStyle = 'rgba(120,100,255,' + ((plant.water / waterCap()) * 0.3).toFixed(2) + ')'; ctx.fillRect(x + 2, y - 8, w - 4, 10); }
    if (s) {
      const label = sessionLabel(s);
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tw = Math.min(w - 16, ctx.measureText(label).width + 26);
      ctx.fillStyle = 'rgba(40,30,70,0.92)';
      ctx.beginPath(); ctx.roundRect(cx - tw / 2, y + h / 2 - 10, tw, 20, 5); ctx.fill();
      const lamp = { working: '#6fd38a', needs_you: '#ff8f4d', your_turn: '#ffcb5c', idle: '#8a93a6' }[s.status] || '#8a93a6';
      ctx.fillStyle = lamp; ctx.beginPath(); ctx.arc(cx - tw / 2 + 10, y + h / 2, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#efe8ff';
      ctx.save(); ctx.beginPath(); ctx.rect(cx - tw / 2 + 16, y, tw - 20, h); ctx.clip();
      ctx.fillText(label, cx + 6, y + h / 2); ctx.restore();
      const pct = Math.round(100 * contextFraction(s));
      const ctxText = s.night ? '☽ compacting' : 'context ' + pct + '%';
      ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
      const cw = ctx.measureText(ctxText).width + 14;
      const warn = !s.night && pct >= 100 * compactAt * 0.85;
      ctx.fillStyle = warn ? 'rgba(255,170,90,0.94)' : 'rgba(40,30,70,0.85)';
      ctx.beginPath(); ctx.roundRect(cx - cw / 2, y + h / 2 + 12, cw, 15, 4); ctx.fill();
      ctx.fillStyle = warn ? '#3a1d05' : '#d9d0ff'; ctx.fillText(ctxText, cx, y + h / 2 + 19.5);
    }
  }
  // The tower: one floor per stage, windows that light at "lit windows", a crystal
  // at the spire, floating stones, a storm ring, and the same late-stage glow.
  function wizTower(r, sid, t, plant, wilt) {
    if (!plant) return;
    const dl = daylight();
    const sp = speciesOf(plant), si = plantStage(plant), prog = plantProgress(plant);
    const shape = sp.shape;
    const floors = Math.min(si, 12), fhUnit = shape === 'stem' ? 26 : 22, roofUnit = shape === 'stem' ? 66 : shape === 'spikes' ? 42 : 54;
    let k = Math.max(0.6, r.scale) * (si >= 11 ? 1.25 : 1) * themeRoom(r);
    k *= Math.max(0.3, Math.min(1, Math.max(120, r.y - 84) / ((floors * fhUnit + roofUnit + 44) * k)));   // fill the room above the planter, never more
    const cx = r.cx, base = r.y - 6;
    const floorH = fhUnit * k;
    const bw = (shape === 'stem' ? 17 : shape === 'spikes' ? 26 : shape === 'cactus' ? 22 : 28) * k;
    const height = floors * floorH + prog * floorH * 0.6;
    const wall = shape === 'cactus' ? [30, 26, 40] : shape === 'fronds' ? [150, 200, 230] : shape === 'moon' ? [200, 205, 225] : shape === 'stem' ? [220, 190, 110] : shape === 'spikes' ? [140, 100, 200] : [126, 122, 136];
    const lit = si >= 5;
    ctx.save(); ctx.globalAlpha = 1 - wilt * 0.6;
    if (si === 0) {
      // the foundation: a ring of stones
      ctx.fillStyle = stone(120, dl);
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(cx - 15 * k + i * 6 * k, base - 2, 4 * k, 3 * k, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore(); return;
    }
    // floating isle: the tower rides a rock above the plinth
    let lift = 0;
    if (shape === 'bonsai' && si >= 3) { lift = 18 * k + Math.sin(t * 0.8) * 4; ctx.fillStyle = stone(90, dl); ctx.beginPath(); ctx.moveTo(cx - bw * 0.9, base - lift + 2); ctx.lineTo(cx + bw * 0.9, base - lift + 2); ctx.lineTo(cx + bw * 0.4, base - lift + 16 * k); ctx.lineTo(cx - bw * 0.3, base - lift + 14 * k); ctx.closePath(); ctx.fill(); }
    const b = base - lift;
    // the tower proper: a footing with buttresses and a door, stone courses one
    // floor at a time (tapering as they climb), ledges, balconies, arched windows
    const crystal = shape === 'fronds' || shape === 'moon';
    const wallCol = (kk, a) => col(wall.map((c) => Math.min(255, c * kk)), dl, a);
    const widthAt = (f) => bw * (1 - Math.min(f, 12) * 0.03);
    // footing and buttresses
    ctx.fillStyle = wallCol(0.75); ctx.fillRect(cx - bw * 1.25, b - 8 * k, bw * 2.5, 8 * k);
    for (const side of [-1, 1]) { ctx.fillStyle = wallCol(0.85); ctx.beginPath(); ctx.moveTo(cx + side * bw, b - 8 * k); ctx.lineTo(cx + side * bw * 1.35, b - 8 * k); ctx.lineTo(cx + side * bw, b - 8 * k - floorH * 1.4); ctx.closePath(); ctx.fill(); }
    for (let f = 0; f < floors; f++) {
      const ww = widthAt(f), y0 = b - 8 * k - (f + 1) * floorH, y1 = y0 + floorH;
      const g = ctx.createLinearGradient(cx - ww, 0, cx + ww, 0);
      g.addColorStop(0, wallCol(1.25)); g.addColorStop(0.45, wallCol(1)); g.addColorStop(1, wallCol(0.55));
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx - ww, y1 + 1); ctx.lineTo(cx - widthAt(f + 1), y0); ctx.lineTo(cx + widthAt(f + 1), y0); ctx.lineTo(cx + ww, y1 + 1); ctx.closePath(); ctx.fill();
      if (!crystal) {
        // stone courses
        ctx.strokeStyle = 'rgba(0,0,0,' + (0.16 * dl + 0.06).toFixed(2) + ')'; ctx.lineWidth = 1;
        for (let c = 0; c < 3; c++) { const yy = y0 + floorH * (c + 1) / 3; ctx.beginPath(); ctx.moveTo(cx - ww, yy); ctx.lineTo(cx + ww, yy); ctx.stroke(); const off = (c % 2) * 7 * k; for (let bx = cx - ww + off; bx < cx + ww; bx += 14 * k) { ctx.beginPath(); ctx.moveTo(bx, yy - floorH / 3); ctx.lineTo(bx, yy); ctx.stroke(); } }
        if (shape === 'cactus') { ctx.strokeStyle = 'rgba(255,80,60,' + (0.35 + 0.3 * Math.sin(t * 2 + f)).toFixed(2) + ')'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx - ww * 0.6, y1); ctx.lineTo(cx - ww * 0.2 + Math.sin(f) * 4, y0); ctx.stroke(); }
      } else { ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - ww * 0.5, y1); ctx.lineTo(cx - ww * 0.2, y0); ctx.stroke(); }
      // a ledge every third floor
      if (f % 3 === 2) { ctx.fillStyle = wallCol(1.3); ctx.fillRect(cx - ww - 4 * k, y0 - 1.5 * k, ww * 2 + 8 * k, 3 * k); ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(cx - ww - 4 * k, y0 + 1.5 * k, ww * 2 + 8 * k, 1.5 * k); }
      // the door on the ground floor
      if (f === 0) {
        ctx.fillStyle = 'rgba(30,20,20,0.9)'; ctx.beginPath(); ctx.moveTo(cx - 5 * k, y1 + 1); ctx.lineTo(cx - 5 * k, y1 - 9 * k); ctx.arc(cx, y1 - 9 * k, 5 * k, Math.PI, 0); ctx.lineTo(cx + 5 * k, y1 + 1); ctx.closePath(); ctx.fill();
        if (lit) { ctx.fillStyle = 'rgba(255,200,110,' + (0.35 + 0.15 * Math.sin(t * 3)).toFixed(2) + ')'; ctx.fillRect(cx - 4 * k, y1 - 6 * k, 8 * k, 6 * k); }
        ctx.strokeStyle = 'rgba(140,110,70,0.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - 5 * k, y1 - 9 * k); ctx.arc(cx, y1 - 9 * k, 5 * k, Math.PI, 0); ctx.stroke();
      } else {
        // an arched window, alternating sides, with a slit opposite; the sun spire has one in the middle
        const side = shape === 'stem' ? 0 : (f % 2 ? 1 : -1);
        const wx = cx + side * ww * 0.4, wy = y0 + floorH * 0.55;
        const glow = lit ? 0.6 + 0.4 * Math.sin(t * 2 + f * 1.3) : 0;
        ctx.fillStyle = lit ? 'rgba(255,200,110,' + (0.5 + 0.5 * glow).toFixed(2) + ')' : 'rgba(20,16,40,0.85)';
        ctx.beginPath(); ctx.moveTo(wx - 3 * k, wy + 5 * k); ctx.lineTo(wx - 3 * k, wy - 2 * k); ctx.arc(wx, wy - 2 * k, 3 * k, Math.PI, 0); ctx.lineTo(wx + 3 * k, wy + 5 * k); ctx.closePath(); ctx.fill();
        if (lit) { const gl = ctx.createRadialGradient(wx, wy, 1, wx, wy, 14 * k); gl.addColorStop(0, 'rgba(255,200,110,' + (0.35 * glow).toFixed(2) + ')'); gl.addColorStop(1, 'rgba(255,200,110,0)'); ctx.fillStyle = gl; ctx.fillRect(wx - 14 * k, wy - 14 * k, 28 * k, 28 * k); }
        if (side) { ctx.fillStyle = lit ? 'rgba(255,200,110,0.7)' : 'rgba(20,16,40,0.85)'; ctx.fillRect(cx - side * ww * 0.45 - 1 * k, wy - 3 * k, 2 * k, 7 * k); }
        // a balcony on the fourth and eighth floors
        if (f === 4 || f === 8) { const bsx = cx + (f === 4 ? 1 : -1) * ww; ctx.fillStyle = wallCol(1.2); ctx.fillRect(Math.min(bsx, bsx + (f === 4 ? 1 : -1) * 10 * k), y1 - 4 * k, 10 * k, 3 * k); ctx.strokeStyle = wallCol(1.35); ctx.lineWidth = 1.2; for (let p = 0; p <= 3; p++) { const px = bsx + (f === 4 ? 1 : -1) * p * 3.3 * k; ctx.beginPath(); ctx.moveTo(px, y1 - 4 * k); ctx.lineTo(px, y1 - 11 * k); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(bsx, y1 - 11 * k); ctx.lineTo(bsx + (f === 4 ? 1 : -1) * 10 * k, y1 - 11 * k); ctx.stroke(); }
      }
    }
    // the floor in progress rises out of the last one
    const topW = widthAt(floors);
    if (floors < 12 && prog > 0.05) { const y0 = b - 8 * k - floors * floorH - prog * floorH * 0.7; ctx.fillStyle = wallCol(1, 0.65); ctx.fillRect(cx - topW, y0, topW * 2, prog * floorH * 0.7 + 1); }
    const top = b - 8 * k - floors * floorH;
    // battlements on a wider top ledge, then the roof
    ctx.fillStyle = wallCol(1.3); ctx.fillRect(cx - topW - 5 * k, top - 3 * k, topW * 2 + 10 * k, 4 * k);
    if (crystal) { for (let i = -3; i <= 3; i++) { ctx.fillStyle = shape === 'moon' ? col([225, 228, 245], dl, 0.9) : col([180, 230, 255], dl, 0.85); ctx.beginPath(); ctx.moveTo(cx + i * topW * 0.33 - 3 * k, top - 3 * k); ctx.lineTo(cx + i * topW * 0.33, top - (9 + (i % 2) * 4) * k); ctx.lineTo(cx + i * topW * 0.33 + 3 * k, top - 3 * k); ctx.closePath(); ctx.fill(); } }
    else { ctx.fillStyle = wallCol(1.15); for (let i = -3; i <= 3; i++) { if (i % 2) continue; ctx.fillRect(cx + i * topW * 0.33 - 3 * k, top - 10 * k, 6 * k, 7 * k); } if (shape === 'cactus') { ctx.fillStyle = col([20, 16, 30], dl); for (let i = -3; i <= 3; i++) { if (!(i % 2)) continue; ctx.beginPath(); ctx.moveTo(cx + i * topW * 0.33 - 2 * k, top - 3 * k); ctx.lineTo(cx + i * topW * 0.33, top - 12 * k); ctx.lineTo(cx + i * topW * 0.33 + 2 * k, top - 3 * k); ctx.closePath(); ctx.fill(); } } }
    const roofBase = top - 10 * k, roofW = topW + 6 * k;
    const roofH = roofUnit * k;
    const roofY = roofBase - roofH;
    if (shape === 'spikes') {
      // amethyst cluster: three crystal spires
      for (let i = -1; i <= 1; i++) { const h = (i ? 26 : 38) * k; ctx.fillStyle = col([170, 130, 230], dl, 0.9); ctx.beginPath(); ctx.moveTo(cx + i * roofW * 0.6 - 7 * k, roofBase); ctx.lineTo(cx + i * roofW * 0.6, roofBase - h); ctx.lineTo(cx + i * roofW * 0.6 + 7 * k, roofBase); ctx.closePath(); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.moveTo(cx + i * roofW * 0.6 - 7 * k, roofBase); ctx.lineTo(cx + i * roofW * 0.6 - 2 * k, roofBase); ctx.lineTo(cx + i * roofW * 0.6, roofBase - h); ctx.closePath(); ctx.fill(); }
    } else {
      // a tall cone with an overhang, slate stripes, a lit edge, and a finial
      const rc = crystal ? (shape === 'moon' ? [215, 218, 240] : [170, 225, 255]) : shape === 'cactus' ? [20, 16, 30] : shape === 'stem' ? [205, 150, 55] : sp.thorns ? [110, 40, 50] : [70, 60, 105];
      ctx.fillStyle = col(rc, dl, crystal ? 0.85 : 1); ctx.beginPath(); ctx.moveTo(cx - roofW, roofBase); ctx.lineTo(cx + roofW, roofBase); ctx.lineTo(cx, roofY); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,' + (0.14 * dl + 0.04).toFixed(2) + ')'; ctx.beginPath(); ctx.moveTo(cx - roofW, roofBase); ctx.lineTo(cx - roofW * 0.35, roofBase); ctx.lineTo(cx - 1.5 * k, roofY + 4 * k); ctx.closePath(); ctx.fill();
      if (!crystal) { ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1; for (let i = 1; i < 6; i++) { const yy = roofBase - roofH * i / 6, w2 = roofW * (1 - i / 6); ctx.beginPath(); ctx.moveTo(cx - w2, yy); ctx.lineTo(cx + w2, yy); ctx.stroke(); } }
      ctx.fillStyle = col([60, 56, 64], dl); ctx.fillRect(cx - roofW - 2 * k, roofBase - 1.5 * k, roofW * 2 + 4 * k, 3 * k);
      if (shape === 'cactus') { ctx.strokeStyle = 'rgba(255,80,60,' + (0.5 + 0.4 * Math.sin(t * 3)).toFixed(2) + ')'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx - roofW * 0.4, roofBase - 6 * k); ctx.lineTo(cx, roofY + 10 * k); ctx.stroke(); }
    }
    // a pennant at the very top, waving in the wind
    const tipY = shape === 'spikes' ? roofBase - 38 * k : roofY;
    ctx.fillStyle = col([60, 56, 64], dl); ctx.fillRect(cx - 0.8 * k, tipY - 14 * k, 1.6 * k, 14 * k);
    const wave = Math.sin(t * 4 + r.x) * 2 * (1 + weather.wind * 2), flagCol = sp.thorns ? '#c94a3a' : shape === 'stem' ? '#ffd45c' : shape === 'cactus' ? '#a03030' : crystal ? '#bfe8ff' : '#7a5cd6';
    ctx.fillStyle = flagCol; ctx.beginPath(); ctx.moveTo(cx, tipY - 14 * k); ctx.lineTo(cx + 12 * k + wave, tipY - 11 * k + wave * 0.5); ctx.lineTo(cx, tipY - 7 * k); ctx.closePath(); ctx.fill();
    const spireTip = tipY - 14 * k;
    // crystal at the spire from the crystal-spire stage
    if (si >= 6) {
      const pulse = 0.6 + 0.4 * Math.sin(t * 2.5);
      const hue = si >= 10 ? (t * 40) % 360 : shape === 'cactus' ? 0 : shape === 'moon' ? 210 : 270;
      const gl = ctx.createRadialGradient(cx, spireTip - 8 * k, 1, cx, spireTip - 8 * k, 30 * k); gl.addColorStop(0, 'hsla(' + hue + ',90%,75%,' + (0.5 * pulse).toFixed(2) + ')'); gl.addColorStop(1, 'hsla(' + hue + ',90%,75%,0)'); ctx.fillStyle = gl; ctx.fillRect(cx - 30 * k, spireTip - 38 * k, 60 * k, 60 * k);
      ctx.fillStyle = 'hsl(' + hue + ',90%,' + (65 + 15 * pulse) + '%)'; ctx.beginPath(); ctx.moveTo(cx, spireTip - 18 * k); ctx.lineTo(cx + 5 * k, spireTip - 8 * k); ctx.lineTo(cx, spireTip + 2 * k); ctx.lineTo(cx - 5 * k, spireTip - 8 * k); ctx.closePath(); ctx.fill();
    } else if (shape === 'stem' && si >= 3) {
      // the sun spire's beacon follows the sun
      const sunX = W * 0.08 + dayFraction() * W * 0.84; const dir = Math.sign(sunX - cx) || 1;
      ctx.fillStyle = 'rgba(255,220,120,' + (0.6 + 0.3 * Math.sin(t * 4)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(cx + dir * 3 * k, spireTip + 2 * k, 4 * k, 0, Math.PI * 2); ctx.fill();
    }
    // floating stones orbit from the floating-stones stage
    if (si >= 7) {
      const n = Math.min(8, si - 4);
      for (let i = 0; i < n; i++) {
        const a = t * 0.7 + i * (Math.PI * 2 / n), ry = (top + b) / 2, rx = bw + 22 * k;
        const sx = cx + Math.cos(a) * rx, sy = ry + Math.sin(a) * 10 * k + Math.sin(t * 1.5 + i) * 4;
        const front = Math.sin(a) > 0;
        ctx.globalAlpha = (1 - wilt * 0.6) * (front ? 1 : 0.55);
        ctx.fillStyle = stone(front ? 120 : 90, dl); ctx.beginPath(); ctx.moveTo(sx - 5 * k, sy); ctx.lineTo(sx, sy - 4 * k); ctx.lineTo(sx + 5 * k, sy); ctx.lineTo(sx, sy + 4 * k); ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1 - wilt * 0.6;
    }
    // a storm ring with lightning from the storm-ring stage
    if (si >= 8) {
      const ry = top - 6 * k, rx = bw + 34 * k;
      ctx.strokeStyle = 'rgba(160,160,200,' + (0.25 + 0.15 * Math.sin(t)).toFixed(2) + ')'; ctx.lineWidth = 4 * k; ctx.beginPath(); ctx.ellipse(cx, ry, rx, 8 * k, 0, 0, Math.PI * 2); ctx.stroke();
      if (Math.sin(t * 7 + si) > 0.93) { ctx.strokeStyle = 'rgba(220,230,255,0.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); let lx = cx + (Math.random() - 0.5) * rx * 1.6, ly = ry; ctx.moveTo(lx, ly); for (let i = 0; i < 5; i++) { lx += (Math.random() - 0.5) * 14 * k; ly += 9 * k; ctx.lineTo(lx, ly); } ctx.stroke(); }
    }
    // late stages: aura, rune ring, and mythic beams
    if (si >= 9) { const gl = ctx.createRadialGradient(cx, (top + b) / 2, 4, cx, (top + b) / 2, bw + 60 * k); gl.addColorStop(0, 'rgba(150,120,255,' + (si >= 10 ? 0.22 : 0.14) + ')'); gl.addColorStop(1, 'rgba(150,120,255,0)'); ctx.fillStyle = gl; ctx.fillRect(cx - bw - 60 * k, top - 40 * k, (bw + 60 * k) * 2, b - top + 80 * k); }
    if (si >= 10) { ctx.font = (10 * k).toFixed(1) + 'px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; for (let i = 0; i < 8; i++) { const a = -t * 0.5 + i * Math.PI / 4; ctx.fillStyle = 'hsla(' + ((t * 30 + i * 45) % 360) + ',85%,75%,0.9)'; ctx.fillText(['ᚠ', 'ᛉ', 'ᚨ', 'ᛟ', 'ᚱ', 'ᛏ', 'ᛗ', 'ᚦ'][i], cx + Math.cos(a) * (bw + 46 * k), (top + b) / 2 + Math.sin(a) * 14 * k); } }
    if (si >= 13) { for (let i = 0; i < 3; i++) { const a = t * 0.3 + i * 2.1; ctx.strokeStyle = 'hsla(' + ((t * 40 + i * 120) % 360) + ',90%,80%,0.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, spireTip - 18 * k); ctx.lineTo(cx + Math.cos(a) * W * 0.4, spireTip - 18 * k - Math.abs(Math.sin(a)) * H * 0.5 - 40); ctx.stroke(); } }
    ctx.restore();
  }
  function wizObservatory(t) {
    if (!has('greenhouse')) return;
    const dl = daylight();
    const w = Math.max(96, Math.min(150, W * 0.11)), h = w * 0.7;
    const x = W * 0.27 - w / 2, y = soilY - 4;
    shadow(x + w / 2, y + 3, w * 1.05, 5, 0.15);
    ctx.fillStyle = stone(110, dl); ctx.fillRect(x + w * 0.15, y - h * 0.55, w * 0.7, h * 0.55);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + w * 0.15, y - h * 0.55 * i / 4); ctx.lineTo(x + w * 0.85, y - h * 0.55 * i / 4); ctx.stroke(); }
    ctx.fillStyle = col([80, 70, 120], dl); ctx.beginPath(); ctx.arc(x + w / 2, y - h * 0.55, w * 0.36, Math.PI, 0); ctx.fill();
    ctx.fillStyle = col([40, 30, 70], dl); ctx.beginPath(); ctx.moveTo(x + w / 2 - 5, y - h * 0.55); ctx.lineTo(x + w / 2 + 5, y - h * 0.55); ctx.lineTo(x + w / 2 + 3, y - h * 0.55 - w * 0.34); ctx.lineTo(x + w / 2 - 3, y - h * 0.55 - w * 0.34); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = col([200, 180, 120], dl); ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x + w / 2, y - h * 0.6); ctx.lineTo(x + w / 2 + 18, y - h * 0.6 - w * 0.36 - 6); ctx.stroke();
    ctx.fillStyle = 'rgba(255,220,140,' + (0.25 + 0.5 * (1 - dl)).toFixed(2) + ')'; ctx.fillRect(x + w * 0.3, y - h * 0.4, 8, 10); ctx.fillRect(x + w * 0.62, y - h * 0.4, 8, 10);
  }
  function wizImps(t) {
    for (const p of pests) {
      const pos = pestPos(p); if (!pos) continue;
      const x = pos.x, y = pos.y + Math.sin(t * 3 + p.flap) * 2;
      ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.ellipse(x, y - 4, 6, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - 5, y - 9); ctx.lineTo(x - 4, y - 15); ctx.lineTo(x - 1, y - 10); ctx.moveTo(x + 5, y - 9); ctx.lineTo(x + 4, y - 15); ctx.lineTo(x + 1, y - 10); ctx.fill();
      ctx.fillStyle = '#ffd45c'; ctx.beginPath(); ctx.arc(x - 2, y - 5, 1.2, 0, Math.PI * 2); ctx.arc(x + 2, y - 5, 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + 5, y); ctx.quadraticCurveTo(x + 12, y + 2 + Math.sin(t * 4) * 3, x + 14, y - 6); ctx.stroke();
    }
  }
  function wizWisps(t) {
    for (const c of critters) {
      const fade = Math.min(1, c.age * 3, (c.life - c.age) * 2);
      const gl = ctx.createRadialGradient(c.x, c.y, 1, c.x, c.y, 14); gl.addColorStop(0, 'rgba(180,230,255,' + (0.9 * fade).toFixed(2) + ')'); gl.addColorStop(1, 'rgba(180,230,255,0)');
      ctx.fillStyle = gl; ctx.fillRect(c.x - 14, c.y - 14, 28, 28);
      ctx.fillStyle = 'rgba(255,255,255,' + fade.toFixed(2) + ')'; ctx.beginPath(); ctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2); ctx.fill();
      for (let k = 1; k <= 4; k++) { ctx.fillStyle = 'rgba(180,230,255,' + (fade * (0.5 - k * 0.1)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(c.x - Math.sin(c.age * 1.3 + c.phase - k * 0.2) * 6 * k, c.y - Math.cos(c.age * 1.7 + c.phase - k * 0.2) * 4 * k, 2.5 - k * 0.4, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  function wizUpgrades(t) {
    const dl = daylight();
    if (has('barrel')) {
      // ether cistern: a glass alembic on a stand, ether swirling inside
      const x = mailbox.x + mailbox.w + 22, y = soilY;
      shadow(x + 13, y + 5, 34, 4, 0.2);
      ctx.fillStyle = stone(70, dl); ctx.fillRect(x + 4, y - 6, 18, 6);
      ctx.fillStyle = 'rgba(200,230,255,0.35)'; ctx.beginPath(); ctx.arc(x + 13, y - 20, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(120,100,255,' + (0.5 + 0.2 * Math.sin(t * 2)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(x + 13, y - 20, 12, Math.PI * 0.15, Math.PI * 0.85); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(230,240,255,0.7)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x + 13, y - 20, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(200,230,255,0.35)'; ctx.fillRect(x + 10, y - 40, 6, 10); ctx.fillStyle = stone(80, dl); ctx.fillRect(x + 8, y - 42, 10, 3);
    }
    const room = gate.x - 8;
    if (has('compost')) {
      // ley stone: a standing stone with a glowing rune
      const x = room - (has('scarecrow') ? 56 : 0) - 40, y = soilY;
      shadow(x + 12, y + 5, 32, 4, 0.2);
      ctx.fillStyle = stone(96, dl); ctx.beginPath(); ctx.moveTo(x + 2, y); ctx.lineTo(x + 5, y - 34); ctx.lineTo(x + 16, y - 38); ctx.lineTo(x + 24, y - 30); ctx.lineTo(x + 23, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(120,255,180,' + (0.5 + 0.4 * Math.sin(t * 1.5)).toFixed(2) + ')'; ctx.font = '600 13px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('ᛟ', x + 13, y - 18);
    }
    if (has('scarecrow')) {
      // warding sigil: a glowing circle on a post that imps do not like
      const x = room - 28, y = soilY - 2;
      shadow(x, y + 6, 30, 4, 0.2);
      ctx.fillStyle = stone(70, dl); ctx.fillRect(x - 2, y - 50, 4, 52);
      const pulse = 0.6 + 0.4 * Math.sin(t * 2.5);
      ctx.strokeStyle = 'rgba(255,120,200,' + pulse.toFixed(2) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y - 62, 11, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1.2; ctx.beginPath(); for (let i = 0; i < 5; i++) { const a1 = -Math.PI / 2 + i * Math.PI * 4 / 5; ctx.lineTo(x + Math.cos(a1) * 11, y - 62 + Math.sin(a1) * 11); } ctx.closePath(); ctx.stroke();
    }
    if (has('feeder')) {
      // astrolabe: brass rings on a stand
      const x = Math.min(W - 30, gate.x + gate.w + 40), y = soilY - 44;
      ctx.fillStyle = stone(70, dl); ctx.fillRect(x - 1, y - 6, 2, 50);
      ctx.strokeStyle = col([220, 180, 90], dl); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y - 14, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, y - 14, 9, 3.5, t * 0.6, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, y - 14, 3.5, 9, -t * 0.4, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffd45c'; ctx.beginPath(); ctx.arc(x, y - 14, 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }
  // the wizard's take on the ambient life; anything it returns false for is drawn the garden way
  function wizAmbient(a, layer, t, fade) {
    const dl = daylight();
    if (layer === 'back') {
      if (a.kind === 'cloud') {
        // a violet wisp
        ctx.fillStyle = 'rgba(200,180,240,' + (0.22 * dl * fade + 0.06).toFixed(2) + ')';
        const w = a.w, h = w * 0.12;
        ctx.beginPath(); ctx.ellipse(a.x, a.y, w * 0.5, h, Math.sin(a.age * 0.2) * 0.1, 0, Math.PI * 2); ctx.ellipse(a.x + w * 0.2, a.y + h * 1.4, w * 0.3, h * 0.7, 0, 0, Math.PI * 2); ctx.fill();
        return true;
      }
      if (a.kind === 'rainbow') {
        // an aurora instead of a rainbow
        for (let k = 0; k < 4; k++) {
          ctx.strokeStyle = 'hsla(' + (150 + k * 40 + t * 10) % 360 + ',80%,70%,' + (0.18 * fade).toFixed(2) + ')'; ctx.lineWidth = 14;
          ctx.beginPath(); for (let x = -20; x <= W + 20; x += 20) ctx.lineTo(x, 60 + k * 22 + Math.sin(x * 0.01 + t * 0.8 + k) * 26 + Math.sin(x * 0.03 - t * 0.5) * 8); ctx.stroke();
        }
        return true;
      }
      if (a.kind === 'flock') {
        // bats
        ctx.fillStyle = 'rgba(30,20,40,' + (0.75 * fade).toFixed(2) + ')';
        for (let k = 0; k < a.n; k++) {
          const bx = a.x + Math.abs(k - (a.n - 1) / 2) * 14, by = a.y + (k - (a.n - 1) / 2) * 7, flap = Math.sin(t * 14 + k) * 4;
          ctx.beginPath(); ctx.moveTo(bx - 7, by - flap); ctx.quadraticCurveTo(bx - 3, by + 2, bx, by); ctx.quadraticCurveTo(bx + 3, by + 2, bx + 7, by - flap); ctx.lineTo(bx + 4, by + 1); ctx.lineTo(bx, by + 4); ctx.lineTo(bx - 4, by + 1); ctx.closePath(); ctx.fill();
        }
        return true;
      }
      if (a.kind === 'balloon') {
        // an airship
        ctx.save(); ctx.translate(a.x, a.y); ctx.globalAlpha = fade * (0.5 + 0.5 * dl);
        ctx.fillStyle = col([170, 140, 200], dl); ctx.beginPath(); ctx.ellipse(0, 0, 26, 10, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.ellipse(-6, -3, 14, 3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(60,40,20,0.8)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-10, 8); ctx.lineTo(-8, 16); ctx.moveTo(10, 8); ctx.lineTo(8, 16); ctx.stroke();
        ctx.fillStyle = col([122, 84, 51], dl); ctx.beginPath(); ctx.moveTo(-14, 16); ctx.lineTo(14, 16); ctx.lineTo(9, 23); ctx.lineTo(-9, 23); ctx.closePath(); ctx.fill();
        ctx.restore(); return true;
      }
      if (a.kind === 'plane') {
        // a small dragon with a puff of smoke behind it
        const dir = a.vx > 0 ? 1 : -1, flap = Math.sin(t * 6) * 5;
        ctx.save(); ctx.translate(a.x, a.y); ctx.scale(dir, 1); ctx.globalAlpha = fade;
        ctx.fillStyle = col([120, 60, 60], dl); ctx.beginPath(); ctx.ellipse(0, 0, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(-18, -1 + Math.sin(t * 3) * 2); ctx.lineTo(-9, 2); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(6, -1); ctx.lineTo(13, -2); ctx.lineTo(11, 1); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-3, -1); ctx.lineTo(2, -9 - flap); ctx.lineTo(7, -1); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(200,200,210,' + (0.35 * fade).toFixed(2) + ')'; for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.arc(-20 - k * 9, Math.sin(t * 2 + k) * 2, 2 + k, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore(); return true;
      }
      return false;
    }
    if (a.kind === 'kite') {
      // a rune kite with a sparkling tail
      ctx.save(); ctx.globalAlpha = fade;
      ctx.strokeStyle = 'rgba(200,180,255,0.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.ax, a.ay); ctx.quadraticCurveTo((a.ax + a.x) / 2 - 20, (a.ay + a.y) / 2 + 30, a.x, a.y); ctx.stroke();
      ctx.translate(a.x, a.y); ctx.rotate(0.35 + Math.sin(a.age * 1.7 + a.phase) * 0.15);
      ctx.fillStyle = 'hsl(' + (260 + (a.hue % 40)) + ',70%,45%)'; ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(11, 0); ctx.lineTo(0, 18); ctx.lineTo(-11, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,230,140,' + (0.6 + 0.4 * Math.sin(t * 4)).toFixed(2) + ')'; ctx.font = '600 11px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('ᛉ', 0, 1);
      for (let k = 1; k <= 5; k++) { ctx.fillStyle = 'hsla(' + ((t * 60 + k * 50) % 360) + ',90%,75%,' + (1 - k * 0.15).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(Math.sin(a.age * 6 + k) * 6, 18 + k * 7, 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore(); return true;
    }
    if (a.kind === 'butterfly') {
      // a glowing sprite
      ctx.save(); ctx.translate(a.x, a.y); ctx.globalAlpha = fade;
      const flap = Math.abs(Math.sin(t * 14 + a.phase));
      const gl = ctx.createRadialGradient(0, 0, 1, 0, 0, 12); gl.addColorStop(0, 'hsla(' + a.hue + ',90%,80%,0.6)'); gl.addColorStop(1, 'hsla(' + a.hue + ',90%,80%,0)'); ctx.fillStyle = gl; ctx.fillRect(-12, -12, 24, 24);
      ctx.fillStyle = 'hsla(' + a.hue + ',90%,85%,0.8)'; ctx.beginPath(); ctx.ellipse(-4 * flap - 1, -2, 5 * (0.4 + flap * 0.6), 4, -0.5, 0, Math.PI * 2); ctx.ellipse(4 * flap + 1, -2, 5 * (0.4 + flap * 0.6), 4, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.restore(); return true;
    }
    if (a.kind === 'ladybug') {
      // a scarab
      const p = ambientPos(a);
      ctx.save(); ctx.translate(p.x, p.y); ctx.globalAlpha = fade; ctx.scale(a.dir, 1);
      ctx.fillStyle = '#1f9e8a'; ctx.beginPath(); ctx.ellipse(0, 0, 5, 3.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(140,255,230,0.6)'; ctx.beginPath(); ctx.ellipse(-1, -1, 2.5, 1.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#123'; ctx.beginPath(); ctx.arc(4.5, 0, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.restore(); return true;
    }
    if (a.kind === 'rabbit') {
      // a toad that hops
      ctx.save(); ctx.translate(a.x, a.y - Math.abs(Math.sin(a.age * 4)) * 7); ctx.globalAlpha = fade; ctx.scale(a.vx > 0 ? 1 : -1, 1);
      ctx.fillStyle = col([96, 130, 70], dl); ctx.beginPath(); ctx.ellipse(0, -2, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(7, -6, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd45c'; ctx.beginPath(); ctx.arc(8, -9, 1.6, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(8.4, -9, 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col([80, 110, 60], dl); ctx.beginPath(); ctx.ellipse(-8, 2, 5, 2.5, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.restore(); return true;
    }
    if (a.kind === 'seed') {
      // rising embers instead of dandelion seeds
      ctx.fillStyle = 'rgba(255,' + Math.floor(120 + 100 * Math.abs(Math.sin(a.age * 3 + a.phase))) + ',60,' + (0.85 * fade).toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(a.x, a.y - a.age * 6, 1.6, 0, Math.PI * 2); ctx.fill(); return true;
    }
    if (a.kind === 'snail') {
      // a slime on the plinth
      const p = ambientPos(a);
      ctx.save(); ctx.translate(p.x, p.y); ctx.globalAlpha = fade * 0.9;
      const sq = 1 + Math.sin(a.age * 4) * 0.12;
      ctx.fillStyle = 'rgba(120,230,120,0.85)'; ctx.beginPath(); ctx.ellipse(0, -3 * sq, 7 / sq, 5 * sq, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.ellipse(-2, -5 * sq, 2, 1.2, -0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#123'; ctx.beginPath(); ctx.arc(-2 * a.dir, -3, 0.9, 0, Math.PI * 2); ctx.arc(2 * a.dir, -3, 0.9, 0, Math.PI * 2); ctx.fill();
      ctx.restore(); return true;
    }
    return false;
  }
  function wizSky(t) {
    const [top, bottom] = skyColors(t);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgb(top)); g.addColorStop(1, rgb(bottom));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const f = dayFraction(), night = connected && isNight();
    // stars show faintly even by day on the tower grounds
    const starA = night ? 1 : 0.25 + Math.max(0, (f - 0.85) / 0.15) * 0.75;
    if (connected) {
      for (const s of stars) {
        const a = (0.4 + 0.6 * Math.abs(Math.sin(t * 0.8 + s.tw))) * starA;
        ctx.fillStyle = 'rgba(230,220,255,' + (a * (1 - weather.cloud)).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (connected && night) {
      // two moons: a large silver one and a small red one
      const mx = W * 0.76, my = H * 0.17;
      const gl = ctx.createRadialGradient(mx, my, 20, mx, my, 90); gl.addColorStop(0, 'rgba(200,190,255,0.25)'); gl.addColorStop(1, 'rgba(200,190,255,0)'); ctx.fillStyle = gl; ctx.fillRect(mx - 90, my - 90, 180, 180);
      ctx.fillStyle = 'rgba(225,222,245,0.95)'; ctx.beginPath(); ctx.arc(mx, my, 26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(180,175,210,0.5)'; for (const [dx, dy, r] of [[-8, -6, 5], [7, 4, 4], [-2, 12, 3]]) { ctx.beginPath(); ctx.arc(mx + dx, my + dy, r, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = 'rgba(230,110,90,0.9)'; ctx.beginPath(); ctx.arc(mx - 70, my + 40, 8, 0, Math.PI * 2); ctx.fill();
    } else if (connected) {
      // a pale violet sun with a slow corona
      const sx = W * 0.08 + f * W * 0.84, sy = H * 0.62 - Math.sin(f * Math.PI) * H * 0.5;
      const warmth = Math.max(0, 1 - Math.sin(f * Math.PI) * 1.4);
      const r = 22 + weather.sun * 16 + warmth * 8;
      const core = mix([235, 225, 255], [255, 150, 120], warmth);
      const glow = ctx.createRadialGradient(sx, sy, r * 0.4, sx, sy, r * 4.5);
      glow.addColorStop(0, rgb(core, 0.35 + weather.sun * 0.3)); glow.addColorStop(1, rgb(core, 0));
      ctx.fillStyle = glow; ctx.fillRect(sx - r * 5, sy - r * 5, r * 10, r * 10);
      ctx.strokeStyle = rgb(mix(core, [200, 160, 255], 0.5), 0.35); ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(sx, sy, r * (1.6 + k * 0.35), r * (0.5 + k * 0.12), t * 0.15 + k * 1.1, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = rgb(core, 0.95); ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
    }
    // rain comes in as dark violet wisps
    if (weather.rain > 0.15) {
      ctx.fillStyle = 'rgba(70,50,110,' + (weather.rain * 0.7).toFixed(2) + ')';
      for (let i = 0; i < 6; i++) {
        const cx = ((i + 0.5) / 6) * W + Math.sin(t * 0.3 + i) * 30, cy = 26 + (i % 2) * 18;
        ctx.beginPath(); ctx.ellipse(cx, cy, W * 0.13, 16 + Math.sin(t + i) * 4, Math.sin(t * 0.2 + i) * 0.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    // clouds drift as thin streaks
    if (weather.cloud > 0.05) {
      ctx.fillStyle = 'rgba(210,200,240,' + (0.3 * weather.cloud).toFixed(2) + ')';
      for (let i = 0; i < 4; i++) { const cx = ((i * 0.31 + t * 0.01) % 1.2 - 0.1) * W, cy = 40 + i * 28; ctx.beginPath(); ctx.ellipse(cx, cy, W * 0.12, 4, 0, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  function wizMailbox(t) {
    // an owl post: a stone pedestal with a crystal orb; letters arrive as floating scrolls
    const { x, y, w, h, postH } = mailbox;
    const dl = daylight();
    const flagUp = unread > 0;
    shadow(x + w / 2, y + postH + 2, w * 1.3, 4, 0.2);
    ctx.fillStyle = stone(90, dl); ctx.fillRect(x + w / 2 - 6, y, 12, postH); ctx.fillRect(x + w / 2 - 10, y + postH - 5, 20, 5);
    ctx.fillStyle = stone(120, dl); ctx.beginPath(); ctx.roundRect(x, y - 8, w, 10, 3); ctx.fill();
    const ox = x + w / 2, oy = y - h + 12, orb = w * 0.42;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    if (flagUp) { const gl = ctx.createRadialGradient(ox, oy, 4, ox, oy, orb * 3); gl.addColorStop(0, 'rgba(255,200,120,' + (0.3 + 0.3 * pulse).toFixed(2) + ')'); gl.addColorStop(1, 'rgba(255,200,120,0)'); ctx.fillStyle = gl; ctx.fillRect(ox - orb * 3, oy - orb * 3, orb * 6, orb * 6); }
    const og = ctx.createRadialGradient(ox - orb * 0.3, oy - orb * 0.3, 2, ox, oy, orb);
    og.addColorStop(0, flagUp ? 'rgba(255,240,200,0.95)' : 'rgba(220,210,255,0.9)'); og.addColorStop(1, flagUp ? 'rgba(255,160,80,0.9)' : 'rgba(90,70,160,0.9)');
    ctx.fillStyle = og; ctx.beginPath(); ctx.arc(ox, oy, orb, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = stone(60, dl); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ox, oy + orb * 0.35, orb * 0.9, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
    if (flagUp) {
      const sy = oy - orb - 12 + Math.sin(t * 2) * 3;
      ctx.fillStyle = '#f3e6c4'; ctx.beginPath(); ctx.roundRect(ox - 9, sy - 6, 18, 12, 2); ctx.fill();
      ctx.fillStyle = '#c94a3a'; ctx.fillRect(ox - 9, sy - 6, 18, 2.5); ctx.fillRect(ox - 9, sy + 3.5, 18, 2.5);
    }
    if (unread > 0) {
      ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#c94a3a'; ctx.beginPath(); ctx.arc(ox, oy - orb - 30, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(String(unread), ox, oy - orb - 30);
    }
  }
  function wizDesk(t) {
    // a lectern with an open spellbook and a floating quill; a candle for the lamp
    const st = deskState();
    const on = st.mode === 'ready', queue = st.mode === 'queue' || st.mode === 'later';
    const { x, y, w } = desk;
    const dl = daylight();
    ctx.fillStyle = stone(80, dl); ctx.fillRect(x + w / 2 - 5, y - 26, 10, 26); ctx.fillRect(x + w / 2 - 14, y - 4, 28, 4);
    ctx.fillStyle = stone(105, dl); ctx.beginPath(); ctx.moveTo(x + 4, y - 26); ctx.lineTo(x + w - 4, y - 32); ctx.lineTo(x + w - 4, y - 26); ctx.lineTo(x + 4, y - 20); ctx.closePath(); ctx.fill();
    // the book
    ctx.fillStyle = on ? '#fffdf2' : queue ? '#e6dfcf' : '#a9a29a';
    ctx.beginPath(); ctx.moveTo(x + 9, y - 30); ctx.lineTo(x + w / 2, y - 34); ctx.lineTo(x + w - 9, y - 38); ctx.lineTo(x + w - 9, y - 30); ctx.lineTo(x + w / 2, y - 26); ctx.lineTo(x + 9, y - 22); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = on ? '#6b5a3a' : '#8a8478'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + w / 2, y - 34); ctx.lineTo(x + w / 2, y - 26); ctx.stroke();
    ctx.fillStyle = on ? '#6b5a3a' : '#8a8478'; ctx.fillRect(x + 13, y - 28, 10, 1.2); ctx.fillRect(x + 13, y - 25, 7, 1.2);
    if (on || queue) {
      // the quill hovers over the page
      ctx.save(); ctx.translate(x + w - 18, y - 48 + Math.sin(t * 2) * 3); ctx.rotate(-0.6 + Math.sin(t * 1.3) * 0.1);
      ctx.fillStyle = '#efe8ff'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(6, -10, 3, -22); ctx.quadraticCurveTo(-3, -12, 0, 0); ctx.fill();
      ctx.strokeStyle = '#8a7cc0'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(2, -20); ctx.stroke();
      ctx.restore();
    }
    // a candle where the lamp was
    ctx.fillStyle = '#efe6d2'; ctx.fillRect(x + w - 16, y - 46, 5, 16);
    ctx.fillStyle = on ? '#ffcb5c' : queue ? '#c9a24d' : '#6f6a63';
    if (on || queue) {
      const fl = 3 + Math.sin(t * 9) * 0.8;
      ctx.beginPath(); ctx.ellipse(x + w - 13.5, y - 50, fl * 0.6, fl, 0, 0, Math.PI * 2); ctx.fill();
      const g = ctx.createRadialGradient(x + w - 13.5, y - 50, 2, x + w - 13.5, y - 50, 40);
      g.addColorStop(0, 'rgba(255,220,120,' + (on ? 0.5 + 0.1 * Math.sin(t * 2) : 0.2).toFixed(2) + ')'); g.addColorStop(1, 'rgba(255,220,120,0)');
      ctx.fillStyle = g; ctx.fillRect(x + w - 54, y - 90, 80, 80);
    }
    if (queuedNotes[st.s && st.s.id]) { ctx.fillStyle = '#c94a3a'; ctx.beginPath(); ctx.arc(x + 32, y - 44, 5, 0, Math.PI * 2); ctx.fill(); }
  }
  function wizGate(t) {
    // stone pillars, an iron gate, and a rune-lit wall running to the edge
    const { x, y, w } = gate;
    const dl = daylight();
    shadow(x + w / 2, y + 4, w + 40, 5, 0.16);
    const pillar = (px) => {
      ctx.fillStyle = stone(110, dl); ctx.fillRect(px - 6, y - 70, 12, 76);
      ctx.fillStyle = stone(140, dl); ctx.fillRect(px - 6, y - 70, 3, 76); ctx.fillRect(px - 8, y - 74, 16, 5);
      ctx.fillStyle = 'rgba(150,120,255,' + (0.5 + 0.4 * Math.sin(t * 2 + px)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(px, y - 80, 4, 0, Math.PI * 2); ctx.fill();
    };
    pillar(x); pillar(x + w);
    // the wall
    ctx.fillStyle = stone(96, dl); ctx.fillRect(x + w + 6, y - 46, W - x - w - 6, 50);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
    for (let row = 0; row < 4; row++) { const yy = y - 46 + row * 12.5; ctx.beginPath(); ctx.moveTo(x + w + 6, yy); ctx.lineTo(W, yy); ctx.stroke(); for (let bx = x + w + 6 + (row % 2) * 14; bx < W; bx += 28) { ctx.beginPath(); ctx.moveTo(bx, yy); ctx.lineTo(bx, yy + 12.5); ctx.stroke(); } }
    ctx.fillStyle = stone(130, dl); ctx.fillRect(x + w + 6, y - 50, W - x - w - 6, 4);
    for (let rx = x + w + 30; rx < W - 10; rx += 60) { ctx.fillStyle = 'rgba(150,120,255,' + (0.35 + 0.3 * Math.sin(t * 1.5 + rx)).toFixed(2) + ')'; ctx.font = '600 10px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('ᛉ', rx, y - 22); }
    // the gate itself
    const pm = (focused() && focused().permissionMode) || '';
    const openMode = !pm || pm === 'auto' || pm === 'bypassPermissions';
    const iron = col([50, 48, 60], dl), ironLight = col([90, 88, 105], dl);
    ctx.save(); ctx.translate(x + 3, y);
    const bars = (k) => { for (let gx = 6; gx < w - 6; gx += 11) { ctx.fillStyle = iron; ctx.fillRect(gx, -58, 3, 60); ctx.fillStyle = ironLight; ctx.fillRect(gx, -58, 1, 60); ctx.fillStyle = iron; ctx.beginPath(); ctx.moveTo(gx - 2, -58); ctx.lineTo(gx + 1.5, -66); ctx.lineTo(gx + 5, -58); ctx.closePath(); ctx.fill(); } ctx.fillStyle = iron; ctx.fillRect(0, -44, w - 6, 3); ctx.fillRect(0, -14, w - 6, 3); };
    if (paused) {
      bars(1);
      ctx.strokeStyle = '#ff5a4a'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc((w - 6) / 2, -30, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); for (let i = 0; i < 5; i++) { const a1 = -Math.PI / 2 + i * Math.PI * 4 / 5; ctx.lineTo((w - 6) / 2 + Math.cos(a1) * 9, -30 + Math.sin(a1) * 9); } ctx.closePath(); ctx.stroke();
    } else if (!openMode) {
      bars(1);
      ctx.fillStyle = ironLight; ctx.fillRect(w - 16, -31, 10, 4);
      if (pm === 'plan') {
        ctx.fillStyle = stone(150, dl); ctx.beginPath(); ctx.roundRect((w - 6) / 2 - 24, -36, 48, 14, 3); ctx.fill();
        ctx.fillStyle = '#2b2040'; ctx.font = '600 9px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('planning', (w - 6) / 2, -29);
      }
    } else {
      ctx.transform(0.35, -0.18, 0, 1, 0, 0); ctx.globalAlpha = 0.9;
      bars(1);
    }
    ctx.restore();
    drawGateVisitor(t);
  }
  function wizVial(r, s, t) {
    // a mana vial in an iron stand where the garden keeps its lantern: the liquid
    // is the context left, a crystal hovers above it and dims as the mana drains
    if (!s) return;
    const dl = daylight();
    const left = s.night ? 0 : Math.max(0, Math.min(1, 1 - contextFraction(s) / compactAt));
    const k = Math.max(0.8, Math.min(1.3, r.scale || 1));
    const bx = r.x - 20 * k, by = r.y + r.h;
    const gw = 22 * k, gh = 44 * k;
    const gx = bx - gw / 2, gy = by - 5 * k - gh;
    shadow(bx + 4, by + 2, gw + 14, 3, 0.2);
    const iron = col([50, 48, 60], dl), ironLight = col([90, 88, 105], dl);
    ctx.fillStyle = iron; ctx.beginPath(); ctx.roundRect(gx - 5, by - 6 * k, gw + 10, 6 * k, 2); ctx.fill();
    ctx.fillStyle = 'rgba(210,225,255,' + (0.18 + 0.12 * dl).toFixed(2) + ')'; ctx.beginPath(); ctx.roundRect(gx, gy, gw, gh, [gw / 2, gw / 2, 4, 4]); ctx.fill();
    const fillH = (gh - 4) * 0.62, liq = fillH * left;
    const lg = ctx.createLinearGradient(0, gy + gh - 2 - liq, 0, gy + gh - 2);
    lg.addColorStop(0, 'rgba(150,120,255,0.95)'); lg.addColorStop(1, 'rgba(70,40,180,0.95)');
    ctx.fillStyle = lg; ctx.beginPath(); ctx.roundRect(gx + 2, gy + gh - 2 - liq, gw - 4, liq, [0, 0, 3, 3]); ctx.fill();
    if (left > 0) { ctx.fillStyle = 'rgba(220,210,255,0.55)'; ctx.fillRect(gx + 2, gy + gh - 2 - liq, gw - 4, 1.5 * k); for (let i = 0; i < 3; i++) { const ph = (t * 0.5 + i * 0.37) % 1; ctx.fillStyle = 'rgba(230,220,255,' + (0.5 * (1 - ph)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(gx + 5 + i * 5 * k, gy + gh - 3 - ph * liq, 1.2 * k, 0, Math.PI * 2); ctx.fill(); } }
    const lineY = gy + gh - 2 - fillH;
    ctx.strokeStyle = 'rgba(200,210,255,0.8)'; ctx.lineWidth = 1.2 * k; ctx.beginPath(); ctx.moveTo(gx + 2, lineY); ctx.lineTo(gx + gw - 2, lineY); ctx.stroke();
    ctx.lineWidth = 1; for (const q of [0.75, 0.5, 0.25]) { const ty = gy + gh - 2 - fillH * q; ctx.beginPath(); ctx.moveTo(gx + 2, ty); ctx.lineTo(gx + 2 + 4 * k, ty); ctx.stroke(); }
    ctx.fillStyle = 'rgba(200,210,255,0.85)'; ctx.font = (7 * k).toFixed(1) + 'px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText('max', gx + gw - 3, lineY - 1);
    // stand
    ctx.strokeStyle = ironLight; ctx.lineWidth = 1.4 * k; ctx.beginPath(); ctx.roundRect(gx, gy, gw, gh, [gw / 2, gw / 2, 4, 4]); ctx.stroke();
    ctx.strokeStyle = iron; ctx.lineWidth = 2 * k; ctx.beginPath(); ctx.moveTo(gx - 3, by - 6 * k); ctx.lineTo(gx - 3, gy + gh * 0.5); ctx.moveTo(gx + gw + 3, by - 6 * k); ctx.lineTo(gx + gw + 3, gy + gh * 0.5); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(bx, gy + gh * 0.5, gw / 2 + 3, 3 * k, 0, 0, Math.PI * 2); ctx.stroke();
    // the crystal
    const cy = gy - 10 * k + Math.sin(t * 1.5 + r.x) * 2 * k, cr = (4 + 4 * left) * k;
    if (left > 0) {
      const low = left < 0.25, flick = low ? 0.5 + 0.5 * Math.abs(Math.sin(t * 17)) : 1;
      const hue = 265 - 40 * (1 - left);
      const gl = ctx.createRadialGradient(bx, cy, 1, bx, cy, (30 + 30 * left) * k); gl.addColorStop(0, 'hsla(' + hue + ',90%,75%,' + (0.5 * flick * (0.4 + 0.6 * left)).toFixed(2) + ')'); gl.addColorStop(1, 'hsla(' + hue + ',90%,75%,0)'); ctx.fillStyle = gl; ctx.fillRect(bx - 80, cy - 80, 160, 160);
      ctx.fillStyle = 'hsla(' + hue + ',85%,' + (55 + 25 * flick * left) + '%,0.95)'; ctx.beginPath(); ctx.moveTo(bx, cy - cr * 1.6); ctx.lineTo(bx + cr, cy); ctx.lineTo(bx, cy + cr * 1.6); ctx.lineTo(bx - cr, cy); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.moveTo(bx - cr * 0.3, cy - cr * 0.9); ctx.lineTo(bx, cy - cr * 1.3); ctx.lineTo(bx - cr * 0.6, cy - cr * 0.2); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = col([80, 75, 95], dl); ctx.beginPath(); ctx.moveTo(bx, cy - 6 * k); ctx.lineTo(bx + 4 * k, cy); ctx.lineTo(bx, cy + 6 * k); ctx.lineTo(bx - 4 * k, cy); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(20,16,30,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx - 2 * k, cy - 3 * k); ctx.lineTo(bx + 1 * k, cy + 2 * k); ctx.stroke();
    }
    lanterns[s.id] = { x: bx, y: gy + gh / 2, w: gw, h: gh + 12 * k, left, pct: Math.round(100 * contextFraction(s)), night: Boolean(s.night) };
  }
  THEMES.wizard = {
    id: 'wizard', name: 'Wizard tower', hat: 'wizard',
    perkNames: { headstart: 'Apprentice wand', deeproots: 'Rune memory', longlight: 'Long enchantment', patientsoil: 'Patient ether', secondwind: 'Mana surge', greenkey: 'Observatory key' },
    achNames: { clicks1k: 'Deft wand', harvests10: 'Ten ascents', clicks100k: 'Archmage' }, icon: '🔮', price: 10000000, firefly: 'rgba(180,230,255,',
    blurb: 'A tower that gains a floor per stage on a rune-carved plinth. Mana, runes, ether, starlight, and ley power; wands and grimoires in the shop; imps, wisps, an observatory, and apprentices in pointy hats.',
    words: {
      title: '🔮 Tower of Claude', place: 'tower grounds', sap: 'mana', seed: 'rune', seeds: 'runes', plant: 'tower', plants: 'towers',
      harvest: 'Ascend', harvested: 'ascended', nothingToHarvest: 'nothing to ascend', sprouted: 'was founded',
      water: 'ether', light: 'starlight', nutrients: 'ley power', sunbeam: 'arcane beam', puddle: 'mana pool', greenhouse: 'observatory',
      crowLanded: 'an imp appeared', crowTitle: 'An imp', birdTitle: 'A passing spirit', birdFloat: '👻 +',
      beeTitle: 'A wisp', beeTip: 'Click it to bind it to the tower for a bonus before it drifts off.', beeVisit: 'a wisp is circling', beeFloat: '✨ bound +',
      shopTitle: 'Arcane shop', shopTab: 'Grounds', prestige: 'New age', season: 'age',
      mailboxTitle: 'Owl post', mailboxEmpty: 'Scrolls arrive here only when Claude needs an answer from you.', deskTitle: 'Lectern', gateTitle: 'The iron gate', lanternTitle: 'Mana vial of', tend: 'click to channel mana',
      starTitle: 'A falling star', butterflyTitle: 'A sprite', catTitle: 'A cat', snailTitle: 'A slime', ladybugTitle: 'A scarab',
      lanternOut: 'Dark while the context is compacted. The crystal wakes when compaction finishes.', lanternLeft: 'of the mana left before compaction is due.', lanternLow: 'The crystal is flickering. Let auto-compact run or type /compact in the app.',
      stages: ['foundation', 'cellar', 'ground floor', 'first floor', 'second floor', 'lit windows', 'crystal spire', 'floating stones', 'storm ring', 'glowing', 'enchanted', 'colossal', 'ancient', 'mythic'],
    },
    items: {
      trowel: { name: 'Wand', icon: '🪄' }, can: { name: 'Grimoire', icon: '📖' }, shears: { name: 'Staff', icon: '🔱' }, trellis: { name: 'Crystal ball', icon: '🔮' }, hive: { name: 'Familiar', icon: '🐈‍⬛' }, sprinkler: { name: 'Rune circle', icon: '🔯' }, orchard: { name: 'Dragon', icon: '🐉' },
      longbeam: { name: 'Long beam', desc: 'The arcane beam after Claude writes a file lasts 12, then 16 seconds instead of 8.' },
      brightbeam: { name: 'Bright beam', icon: '✨', desc: 'Clicks inside an arcane beam pay four times instead of three.' },
      puddle: { name: 'Deep mana pool', icon: '🌀', desc: 'Clicks while ether rains on a tower pay double instead of 1.5 times.' },
      birdseed: { name: 'Spirit lure', icon: '🕯️', desc: 'Catching a passing spirit pays three times as much.' },
      hold: { desc: 'Hold the button down on a tower and it keeps clicking for you: 3 a second, then 4, 5, and 7, a touch faster than a fast thumb.' },
      barrel: { name: 'Ether cistern', icon: '⚗️', desc: 'Ether holds 150 and drains a third slower.' },
      compost: { name: 'Ley stone', icon: '🪨', desc: 'Shell commands give twice the ley power.' },
      feeder: { name: 'Astrolabe', icon: '🧭', desc: 'Every tool call feeds ether, starlight, and ley power twice as much.' },
      scarecrow: { name: 'Warding sigil', icon: '🛡️', desc: 'Imps from failed tools leave in 20 seconds instead of 60.' },
      greenhouse: { name: 'Observatory', icon: '🔭', desc: 'An observatory on the grounds. Starlight drains a third slower and imps can no longer slow the trickle.' },
    },
    species: {
      leafy: { name: 'Stone keep', blurb: 'The everyday tower. Grey stone, a slate roof, and windows that light up.' },
      sunflower: { name: 'Sun spire', blurb: 'A slender golden spire whose beacon follows the sun.' },
      cactus: { name: 'Obsidian obelisk', blurb: 'Black glass with red-lit seams. Ether drains slowly.' },
      lavender: { name: 'Amethyst cluster', blurb: 'A clump of purple crystal towers that thickens as it grows.' },
      rose: { name: 'Thorn citadel', blurb: 'Battlements and a red banner from the first floor up.' },
      bonsai: { name: 'Floating isle', blurb: 'A tower on a rock that drifts above its plinth.' },
      crystalfern: { name: 'Crystal spire', blurb: 'Translucent glowing crystal. Yields 30% more.' },
      moonbloom: { name: 'Moon spire', blurb: 'A single silver spire that opens to the night.' },
    },
    palette: {
      DAY: [[0.00, [60, 30, 90], [230, 150, 140]], [0.12, [70, 60, 150], [180, 160, 220]], [0.60, [80, 90, 180], [190, 185, 235]], [0.80, [90, 60, 150], [240, 170, 150]], [0.92, [50, 25, 90], [200, 90, 110]], [1.00, [22, 12, 50], [100, 50, 100]]],
      NIGHT: [[8, 6, 26], [40, 24, 72]],
    },
    draw: { sky: wizSky, ground: wizGround, planter: wizPlanter, plant: wizTower, greenhouse: wizObservatory, pests: wizImps, critters: wizWisps, upgrades: wizUpgrades, ambient: wizAmbient, mailbox: wizMailbox, desk: wizDesk, gate: wizGate, lantern: wizVial },
  };
})();

// ---------- theme: orbit ----------
// A planet that grows from dust to a ringed giant on a launch platform above
// a cratered moon. Stardust for sap, cores for seeds, ice, starlight, and
// minerals for the meters, drones for crows, probes for bees.
(function registerSpace() {
  const metal = (k, dl, a) => col([k, k + 4, k + 10], dl, a);
  function spSky(t) {
    const [top, bottom] = skyColors(t);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgb(top)); g.addColorStop(1, rgb(bottom));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (!connected) return;
    // nebula patches
    for (let i = 0; i < 3; i++) {
      const nx = W * (0.2 + i * 0.3) + Math.sin(t * 0.05 + i) * 30, ny = H * (0.15 + (i % 2) * 0.2);
      const ng = ctx.createRadialGradient(nx, ny, 10, nx, ny, W * 0.18);
      ng.addColorStop(0, 'hsla(' + (250 + i * 50) + ',70%,60%,0.16)'); ng.addColorStop(1, 'hsla(' + (250 + i * 50) + ',70%,60%,0)');
      ctx.fillStyle = ng; ctx.fillRect(nx - W * 0.18, ny - W * 0.18, W * 0.36, W * 0.36);
    }
    for (const s of stars) {
      const a = 0.5 + 0.5 * Math.abs(Math.sin(t * 0.8 + s.tw));
      ctx.fillStyle = 'rgba(255,255,255,' + (a * (1 - weather.cloud * 0.5)).toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2); ctx.fill();
    }
    // the local star crosses the sky by day; a distant gas giant hangs there at night
    const f = dayFraction();
    if (!isNight()) {
      const sx = W * 0.08 + f * W * 0.84, sy = H * 0.62 - Math.sin(f * Math.PI) * H * 0.5, r = 14 + weather.sun * 10;
      const gl = ctx.createRadialGradient(sx, sy, r * 0.5, sx, sy, r * 6); gl.addColorStop(0, 'rgba(255,250,235,0.6)'); gl.addColorStop(1, 'rgba(255,250,235,0)'); ctx.fillStyle = gl; ctx.fillRect(sx - r * 6, sy - r * 6, r * 12, r * 12);
      ctx.fillStyle = '#fffdf5'; ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; for (let k = 0; k < 4; k++) { const a1 = k * Math.PI / 4 + t * 0.1; ctx.beginPath(); ctx.moveTo(sx + Math.cos(a1) * r * 1.3, sy + Math.sin(a1) * r * 1.3); ctx.lineTo(sx + Math.cos(a1) * r * 2.4, sy + Math.sin(a1) * r * 2.4); ctx.stroke(); }
    } else {
      const px = W * 0.78, py = H * 0.2, pr = 34;
      ctx.fillStyle = '#c99a6b'; ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(120,70,40,0.5)'; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.ellipse(px, py + k * 11, Math.sqrt(Math.max(1, pr * pr - (k * 11) * (k * 11))), 3.5, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.strokeStyle = 'rgba(230,220,200,0.7)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(px, py, pr * 1.9, pr * 0.35, -0.3, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(px + 12, py - 6, pr, 0, Math.PI * 2); ctx.fill();
    }
    // reads drift in as a dust cloud rather than rain clouds
    if (weather.rain > 0.15) { ctx.fillStyle = 'rgba(120,130,170,' + (weather.rain * 0.4).toFixed(2) + ')'; for (let i = 0; i < 6; i++) { const cx = ((i + 0.5) / 6) * W + Math.sin(t * 0.3 + i) * 30; ctx.beginPath(); ctx.ellipse(cx, 30 + (i % 2) * 16, W * 0.12, 12, 0, 0, Math.PI * 2); ctx.fill(); } }
  }
  function spGround(t) {
    const dl = daylight();
    // a cratered moon surface with a curved horizon
    ctx.fillStyle = col([120, 118, 130], dl * 0.85);
    ctx.beginPath(); ctx.moveTo(0, soilY + 10); ctx.quadraticCurveTo(W / 2, soilY - 40, W, soilY + 10); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
    const g = ctx.createLinearGradient(0, soilY - 8, 0, H);
    g.addColorStop(0, col([150, 148, 160], dl)); g.addColorStop(0.5, col([110, 108, 122], dl)); g.addColorStop(1, col([70, 68, 82], dl));
    ctx.fillStyle = g; ctx.fillRect(0, soilY - 8, W, H - soilY + 8);
    ctx.fillStyle = col([160, 158, 172], dl, 0.6); ctx.fillRect(0, soilY - 8, W, 3);
    for (const pb of pebbles) {
      const x = pb.x * W, y = soilY + 10 + pb.y * (H - soilY - 20), r = 4 + pb.r * 6;
      ctx.fillStyle = col([80, 78, 92], dl); ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col([140, 138, 150], dl); ctx.beginPath(); ctx.ellipse(x, y - r * 0.25, r * 1.5, r * 0.55, 0, Math.PI, Math.PI * 2); ctx.fill();
    }
    // landing lights blink along the surface
    for (const tf of tufts) { if (tf.h > 6) continue; const x = tf.x * W, y = soilY + 4 + tf.y * (H - soilY - 8); ctx.fillStyle = 'rgba(120,220,255,' + (0.3 + 0.6 * Math.max(0, Math.sin(t * 2 + tf.x * 30))).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill(); }
  }
  function spPlanter(r, s, plant, isFocus) {
    const { x, w, y, h, cx } = r;
    const dl = daylight();
    shadow(cx, y + h + 3, w * 1.05, w * 0.06);
    // a launch platform on struts
    ctx.fillStyle = metal(70, dl); ctx.fillRect(x + 8, y + 10, 5, h - 10); ctx.fillRect(x + w - 13, y + 10, 5, h - 10); ctx.fillRect(cx - 2.5, y + 10, 5, h - 10);
    const body = ctx.createLinearGradient(x, 0, x + w, 0);
    body.addColorStop(0, metal(isFocus ? 175 : 160, dl)); body.addColorStop(0.55, metal(130, dl)); body.addColorStop(1, metal(95, dl));
    ctx.fillStyle = body; ctx.beginPath(); ctx.roundRect(x - 4, y - 6, w + 8, 16, 4); ctx.fill();
    ctx.fillStyle = metal(60, dl); ctx.fillRect(x - 4, y + 4, w + 8, 2);
    for (let i = 0; i < Math.floor(w / 18); i++) { ctx.fillStyle = 'hsla(' + ((i * 60 + t0() * 40) % 360) + ',90%,65%,' + (0.5 + 0.5 * Math.sin(t0() * 3 + i)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(x + 9 + i * 18, y - 2, 2, 0, Math.PI * 2); ctx.fill(); }
    const rings = Math.min(6, (s && s.compactions) || 0);
    if (rings) { ctx.fillStyle = 'rgba(120,220,255,0.7)'; for (let i = 0; i < rings; i++) ctx.fillRect(x + 4 + i * 8, y + 14, 5, 3); }
    if (plant) { ctx.fillStyle = 'rgba(120,200,255,' + ((plant.water / waterCap()) * 0.35).toFixed(2) + ')'; ctx.beginPath(); ctx.ellipse(cx, y - 4, w / 2 - 6, 5, 0, 0, Math.PI * 2); ctx.fill(); }
    if (s) tag(r, s, 'rgba(20,30,50,0.92)', '#dff3ff', 'rgba(20,30,50,0.85)', '#bfe6ff');
  }
  let _t = 0; const t0 = () => _t;
  function tag(r, s, bg, fg, bg2, fg2) {
    const { w, y, h, cx } = r;
    const label = sessionLabel(s);
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = Math.min(w - 16, ctx.measureText(label).width + 26);
    ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(cx - tw / 2, y + h / 2 - 10, tw, 20, 5); ctx.fill();
    const lamp = { working: '#6fd38a', needs_you: '#ff8f4d', your_turn: '#ffcb5c', idle: '#8a93a6' }[s.status] || '#8a93a6';
    ctx.fillStyle = lamp; ctx.beginPath(); ctx.arc(cx - tw / 2 + 10, y + h / 2, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = fg; ctx.save(); ctx.beginPath(); ctx.rect(cx - tw / 2 + 16, y, tw - 20, h); ctx.clip(); ctx.fillText(label, cx + 6, y + h / 2); ctx.restore();
    const pct = Math.round(100 * contextFraction(s));
    const ctxText = s.night ? '☽ compacting' : 'context ' + pct + '%';
    ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
    const cw = ctx.measureText(ctxText).width + 14;
    const warn = !s.night && pct >= 100 * compactAt * 0.85;
    ctx.fillStyle = warn ? 'rgba(255,170,90,0.94)' : bg2; ctx.beginPath(); ctx.roundRect(cx - cw / 2, y + h / 2 + 12, cw, 15, 4); ctx.fill();
    ctx.fillStyle = warn ? '#3a1d05' : fg2; ctx.fillText(ctxText, cx, y + h / 2 + 19.5);
  }
  themeShared.tag = tag;   // shared with the dinosaur theme below
  function spPlanet(r, sid, t, plant, wilt) {
    if (!plant) return;
    _t = t;
    const dl = daylight();
    const sp = speciesOf(plant), si = plantStage(plant), prog = plantProgress(plant);
    const k = Math.max(0.6, r.scale) * (si >= 11 ? 1.25 : 1) * themeRoom(r);
    const cx = r.cx;
    const shape = sp.shape;
    const rad = (8 + Math.min(si, 12) * 4 + prog * 3) * k;
    const cy = r.y - 24 * k - rad;
    const base = shape === 'cactus' ? [210, 160, 90] : shape === 'fronds' ? [190, 230, 250] : shape === 'moon' ? [200, 200, 215] : shape === 'stem' ? [240, 200, 90] : shape === 'spikes' ? [150, 110, 200] : shape === 'bonsai' ? [170, 150, 140] : sp.thorns ? [140, 70, 50] : [120, 110, 130];
    ctx.save(); ctx.globalAlpha = 1 - wilt * 0.6;
    if (si === 0) {
      for (let i = 0; i < 24; i++) { const a = t * 0.4 + i * 0.26, rr = (10 + (i % 5) * 4) * k; ctx.fillStyle = 'rgba(200,200,220,' + (0.3 + 0.4 * Math.sin(t * 2 + i)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr, r.y - 30 * k + Math.sin(a) * rr * 0.4, 1.2 * k, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore(); return;
    }
    if (si <= 2) {
      // pebbles gathering into a ball
      for (let i = 0; i < 10 + si * 6; i++) { const a = t * (0.3 + (i % 3) * 0.1) + i, rr = rad * (0.3 + (i % 4) * 0.25); ctx.fillStyle = col(base, dl); ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.7, (1.5 + (i % 3)) * k, 0, Math.PI * 2); ctx.fill(); }
    }
    if (si >= 2) {
      // the sphere, lit from the star's side
      const f = dayFraction(); const lx = Math.cos(f * Math.PI) * -0.6;
      const g = ctx.createRadialGradient(cx + lx * rad * 0.5, cy - rad * 0.35, rad * 0.1, cx, cy, rad);
      g.addColorStop(0, col(base.map((c) => Math.min(255, c + 50)), dl)); g.addColorStop(0.7, col(base, dl)); g.addColorStop(1, col(base.map((c) => c * 0.45), dl));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.clip();
      // craters or seams by species, oceans from six, life from seven, lights from eight
      const rs = seededRandom(hashStr(sid));
      for (let i = 0; i < 6; i++) { const px = cx + (rs() - 0.5) * rad * 1.6, py = cy + (rs() - 0.5) * rad * 1.6, pr = (2 + rs() * 4) * k; ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill(); }
      if (shape === 'cactus') { ctx.strokeStyle = 'rgba(255,90,60,' + (0.4 + 0.3 * Math.sin(t * 2)).toFixed(2) + ')'; ctx.lineWidth = 1.5; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(cx - rad + rs() * rad * 2, cy - rad); ctx.lineTo(cx - rad + rs() * rad * 2, cy + rad); ctx.stroke(); } }
      if (si >= 6) for (let i = 0; i < 4; i++) { ctx.fillStyle = 'rgba(60,120,220,0.85)'; ctx.beginPath(); ctx.ellipse(cx + (rs() - 0.5) * rad * 1.5, cy + (rs() - 0.5) * rad * 1.5, (4 + rs() * 8) * k, (3 + rs() * 5) * k, rs() * 3, 0, Math.PI * 2); ctx.fill(); }
      if (si >= 7) for (let i = 0; i < 5; i++) { ctx.fillStyle = 'rgba(70,160,80,0.9)'; ctx.beginPath(); ctx.ellipse(cx + (rs() - 0.5) * rad * 1.5, cy + (rs() - 0.5) * rad * 1.5, (3 + rs() * 6) * k, (2 + rs() * 4) * k, rs() * 3, 0, Math.PI * 2); ctx.fill(); }
      if (si >= 8) for (let i = 0; i < 18; i++) { const px = cx + (rs() - 0.5) * rad * 1.7, py = cy + (rs() - 0.5) * rad * 1.7; if ((px - cx) * lx > 0) continue; ctx.fillStyle = 'rgba(255,230,150,' + (0.5 + 0.5 * Math.sin(t * 3 + i)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(px, py, 1 * k, 0, Math.PI * 2); ctx.fill(); }
      if (si >= 11) { for (let b = -3; b <= 3; b++) { ctx.fillStyle = 'rgba(255,255,255,' + (b % 2 ? 0.12 : 0.05) + ')'; ctx.fillRect(cx - rad, cy + b * rad * 0.28 - rad * 0.1, rad * 2, rad * 0.16); } }
      ctx.restore();
      // atmosphere from five
      if (si >= 5) { const ag = ctx.createRadialGradient(cx, cy, rad, cx, cy, rad * 1.25); ag.addColorStop(0, 'rgba(140,200,255,0.35)'); ag.addColorStop(1, 'rgba(140,200,255,0)'); ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(cx, cy, rad * 1.25, 0, Math.PI * 2); ctx.fill(); }
      if (shape === 'stem' && si >= 3) { const f2 = dayFraction(); const sunX = W * 0.08 + f2 * W * 0.84; const dir = Math.sign(sunX - cx) || 1; ctx.fillStyle = 'rgba(255,220,120,' + (0.6 + 0.3 * Math.sin(t * 4)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(cx + dir * rad * 0.7, cy - rad * 0.3, 3 * k, 0, Math.PI * 2); ctx.fill(); }
    }
    // moons orbit from three, more with age; rings from ten
    if (si >= 3) {
      const n = Math.min(5, 1 + Math.floor((si - 3) / 2) + (si >= 12 ? 2 : 0));
      for (let i = 0; i < n; i++) { const a = t * (0.5 + i * 0.13) + i * 2, ox = rad * (1.5 + i * 0.35), oy = rad * (0.35 + i * 0.08); const mx = cx + Math.cos(a) * ox, my = cy + Math.sin(a) * oy; const front = Math.sin(a) > 0; if (!front && si >= 2) continue; ctx.fillStyle = col([200, 200, 210], dl); ctx.beginPath(); ctx.arc(mx, my, (2 + i) * k, 0, Math.PI * 2); ctx.fill(); }
    }
    if (si >= 10 || shape === 'bonsai') { ctx.strokeStyle = 'rgba(230,220,200,0.7)'; ctx.lineWidth = 5 * k; ctx.beginPath(); ctx.ellipse(cx, cy, rad * 1.9, rad * 0.35, -0.25, Math.PI * 0.05, Math.PI * 0.95); ctx.stroke(); ctx.lineWidth = 2 * k; ctx.beginPath(); ctx.ellipse(cx, cy, rad * 2.2, rad * 0.42, -0.25, Math.PI * 0.05, Math.PI * 0.95); ctx.stroke(); }
    if (si >= 9) { const gl = ctx.createRadialGradient(cx, cy, rad, cx, cy, rad * 2.2); gl.addColorStop(0, 'rgba(160,200,255,' + (si >= 10 ? 0.22 : 0.14) + ')'); gl.addColorStop(1, 'rgba(160,200,255,0)'); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(cx, cy, rad * 2.2, 0, Math.PI * 2); ctx.fill(); }
    if (si >= 13) { for (let i = 0; i < 3; i++) { const a = t * 0.3 + i * 2.1; ctx.strokeStyle = 'hsla(' + ((t * 40 + i * 120) % 360) + ',90%,80%,0.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, cy - rad); ctx.lineTo(cx + Math.cos(a) * W * 0.4, cy - rad - Math.abs(Math.sin(a)) * H * 0.5 - 40); ctx.stroke(); } }
    // a tractor beam holds the planet above the pad
    ctx.fillStyle = 'rgba(120,220,255,' + (0.08 + 0.05 * Math.sin(t * 3)).toFixed(2) + ')'; ctx.beginPath(); ctx.moveTo(cx - 10 * k, r.y - 6); ctx.lineTo(cx + 10 * k, r.y - 6); ctx.lineTo(cx + rad * 0.5, cy + rad * 0.5); ctx.lineTo(cx - rad * 0.5, cy + rad * 0.5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function spStation(t) {
    if (!has('greenhouse')) return;
    const dl = daylight();
    const w = Math.max(96, Math.min(150, W * 0.11));
    const x = W * 0.27, y = soilY - 60;
    ctx.fillStyle = metal(90, dl); ctx.fillRect(x - 3, y, 6, 56);
    ctx.strokeStyle = metal(190, dl); ctx.lineWidth = 6; ctx.beginPath(); ctx.ellipse(x, y, w * 0.4, w * 0.14, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = metal(150, dl); ctx.beginPath(); ctx.roundRect(x - 12, y - 14, 24, 28, 6); ctx.fill();
    for (let i = 0; i < 8; i++) { const a = t * 0.5 + i * Math.PI / 4; ctx.fillStyle = 'rgba(255,230,150,' + (0.4 + 0.6 * Math.max(0, Math.sin(t * 2 + i))).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(x + Math.cos(a) * w * 0.4, y + Math.sin(a) * w * 0.14, 1.8, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = col([40, 60, 120], dl); ctx.fillRect(x - 40, y - 4, 22, 8); ctx.fillRect(x + 18, y - 4, 22, 8);
  }
  function spDrones(t) {
    for (const p of pests) {
      const pos = pestPos(p); if (!pos) continue;
      const x = pos.x, y = pos.y + Math.sin(t * 3 + p.flap) * 2;
      ctx.fillStyle = '#7a2a2a'; ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x, y - 6); ctx.lineTo(x + 8, y); ctx.lineTo(x, y + 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,60,60,' + (0.5 + 0.5 * Math.sin(t * 8)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#5a2020'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x - 13, y - 5); ctx.moveTo(x + 8, y); ctx.lineTo(x + 13, y - 5); ctx.stroke();
    }
  }
  function spProbes(t) {
    for (const c of critters) {
      const fade = Math.min(1, c.age * 3, (c.life - c.age) * 2);
      ctx.save(); ctx.globalAlpha = fade; ctx.translate(c.x, c.y); ctx.rotate(Math.sin(c.age) * 0.3);
      ctx.fillStyle = '#d9dde8'; ctx.fillRect(-4, -4, 8, 8);
      ctx.fillStyle = '#3a6fd8'; ctx.fillRect(-14, -2, 8, 4); ctx.fillRect(6, -2, 8, 4);
      ctx.fillStyle = 'rgba(120,255,160,' + (0.5 + 0.5 * Math.sin(t * 6)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(0, -7, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  function spUpgrades(t) {
    const dl = daylight();
    if (has('barrel')) { const x = mailbox.x + mailbox.w + 22, y = soilY; shadow(x + 13, y + 5, 34, 4, 0.2); ctx.fillStyle = metal(150, dl); ctx.beginPath(); ctx.roundRect(x, y - 36, 26, 40, 6); ctx.fill(); ctx.fillStyle = 'rgba(160,230,255,0.5)'; ctx.fillRect(x + 4, y - 30, 18, 24); ctx.fillStyle = 'rgba(120,220,255,0.7)'; ctx.fillRect(x + 4, y - 18, 18, 12); ctx.fillStyle = '#fff'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('ICE', x + 13, y - 20); }
    const room = gate.x - 8;
    if (has('compost')) { const x = room - (has('scarecrow') ? 56 : 0) - 40, y = soilY; shadow(x + 12, y + 5, 32, 4, 0.2); ctx.fillStyle = metal(110, dl); ctx.fillRect(x, y - 24, 26, 28); ctx.fillStyle = metal(80, dl); ctx.fillRect(x + 16, y - 40, 6, 18); ctx.fillStyle = 'rgba(255,150,60,' + (0.5 + 0.4 * Math.sin(t * 3)).toFixed(2) + ')'; ctx.fillRect(x + 4, y - 18, 10, 8); ctx.fillStyle = 'rgba(200,200,220,0.35)'; for (let i = 0; i < 3; i++) { const ph = (t * 0.5 + i * 0.33) % 1; ctx.beginPath(); ctx.arc(x + 19 + Math.sin(ph * 5) * 3, y - 42 - ph * 22, 2 + ph * 3, 0, Math.PI * 2); ctx.fill(); } }
    if (has('scarecrow')) { const x = room - 28, y = soilY - 2; shadow(x, y + 6, 30, 4, 0.2); ctx.fillStyle = metal(90, dl); ctx.fillRect(x - 3, y - 40, 6, 42); ctx.fillStyle = metal(140, dl); ctx.beginPath(); ctx.roundRect(x - 10, y - 54, 20, 14, 4); ctx.fill(); ctx.save(); ctx.translate(x, y - 47); ctx.rotate(Math.sin(t) * 0.5); ctx.fillStyle = metal(60, dl); ctx.fillRect(0, -2, 18, 4); ctx.restore(); ctx.fillStyle = 'rgba(255,80,80,' + (0.5 + 0.5 * Math.sin(t * 5)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(x, y - 58, 2, 0, Math.PI * 2); ctx.fill(); }
    if (has('feeder')) { const x = Math.min(W - 30, gate.x + gate.w + 40), y = soilY - 44; ctx.fillStyle = metal(90, dl); ctx.fillRect(x - 1, y - 6, 2, 50); ctx.save(); ctx.translate(x, y - 10); ctx.rotate(-0.4); ctx.fillStyle = col([40, 60, 140], dl); ctx.fillRect(-14, -8, 28, 16); ctx.strokeStyle = 'rgba(160,200,255,0.6)'; ctx.lineWidth = 1; for (let i = -7; i <= 7; i += 7) { ctx.beginPath(); ctx.moveTo(i, -8); ctx.lineTo(i, 8); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(14, 0); ctx.stroke(); ctx.restore(); }
  }
  function spAmbient(a, layer, t, fade) {
    const dl = daylight();
    if (layer === 'back') {
      if (a.kind === 'cloud') return true;   // no clouds in orbit
      if (a.kind === 'rainbow') { for (let k = 0; k < 3; k++) { ctx.strokeStyle = 'hsla(' + (200 + k * 60) + ',80%,70%,' + (0.14 * fade).toFixed(2) + ')'; ctx.lineWidth = 18; ctx.beginPath(); for (let x = -20; x <= W + 20; x += 20) ctx.lineTo(x, 70 + k * 26 + Math.sin(x * 0.008 + t * 0.5 + k) * 30); ctx.stroke(); } return true; }
      if (a.kind === 'flock') { ctx.fillStyle = 'rgba(220,225,240,' + (0.8 * fade).toFixed(2) + ')'; for (let k = 0; k < a.n; k++) { const bx = a.x + Math.abs(k - (a.n - 1) / 2) * 14, by = a.y + (k - (a.n - 1) / 2) * 7; ctx.beginPath(); ctx.moveTo(bx - 6, by + 2); ctx.lineTo(bx + 6, by); ctx.lineTo(bx - 6, by - 2); ctx.closePath(); ctx.fill(); ctx.fillStyle = 'rgba(120,200,255,' + (0.6 * fade).toFixed(2) + ')'; ctx.fillRect(bx - 9, by - 0.7, 3, 1.4); ctx.fillStyle = 'rgba(220,225,240,' + (0.8 * fade).toFixed(2) + ')'; } return true; }
      if (a.kind === 'balloon') { ctx.save(); ctx.translate(a.x, a.y); ctx.globalAlpha = fade; ctx.fillStyle = col([170, 180, 200], dl); ctx.beginPath(); ctx.ellipse(0, 4, 26, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(160,230,255,0.6)'; ctx.beginPath(); ctx.arc(0, -2, 10, Math.PI, 0); ctx.fill(); for (let i = -2; i <= 2; i++) { ctx.fillStyle = 'hsla(' + ((t * 200 + i * 72) % 360) + ',90%,65%,0.9)'; ctx.beginPath(); ctx.arc(i * 9, 7, 1.8, 0, Math.PI * 2); ctx.fill(); } ctx.restore(); return true; }
      if (a.kind === 'plane') { const dir = a.vx > 0 ? 1 : -1; ctx.save(); ctx.translate(a.x, a.y); ctx.scale(dir, 1); ctx.globalAlpha = fade; const fg = ctx.createLinearGradient(-60, 0, -10, 0); fg.addColorStop(0, 'rgba(255,160,60,0)'); fg.addColorStop(1, 'rgba(255,200,90,0.9)'); ctx.fillStyle = fg; ctx.beginPath(); ctx.moveTo(-60, 0); ctx.lineTo(-10, -3); ctx.lineTo(-10, 3); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#e8ecf5'; ctx.beginPath(); ctx.moveTo(-10, -3); ctx.lineTo(8, -3); ctx.lineTo(14, 0); ctx.lineTo(8, 3); ctx.lineTo(-10, 3); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#d33'; ctx.beginPath(); ctx.moveTo(-10, -3); ctx.lineTo(-14, -7); ctx.lineTo(-6, -3); ctx.moveTo(-10, 3); ctx.lineTo(-14, 7); ctx.lineTo(-6, 3); ctx.fill(); ctx.restore(); return true; }
      return false;
    }
    if (a.kind === 'kite') {
      // a probe on a tether, drifting where the kite would fly
      ctx.save(); ctx.globalAlpha = fade;
      ctx.strokeStyle = 'rgba(200,220,255,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.ax, a.ay); ctx.quadraticCurveTo((a.ax + a.x) / 2 - 10, (a.ay + a.y) / 2 + 20, a.x, a.y); ctx.stroke();
      ctx.translate(a.x, a.y); ctx.rotate(Math.sin(a.age * 0.9 + a.phase) * 0.3);
      ctx.fillStyle = '#d9dde8'; ctx.fillRect(-6, -6, 12, 12); ctx.fillStyle = '#3a6fd8'; ctx.fillRect(-20, -3, 12, 6); ctx.fillRect(8, -3, 12, 6);
      ctx.fillStyle = 'rgba(255,120,120,' + (0.4 + 0.6 * Math.max(0, Math.sin(t * 5))).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(0, -9, 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore(); return true;
    }
    if (a.kind === 'butterfly') { ctx.save(); ctx.translate(a.x, a.y); ctx.globalAlpha = fade; ctx.rotate(Math.sin(a.age) * 0.4); ctx.fillStyle = '#d9dde8'; ctx.fillRect(-3, -3, 6, 6); ctx.fillStyle = 'hsl(' + a.hue + ',70%,55%)'; ctx.fillRect(-11, -1.5, 7, 3); ctx.fillRect(4, -1.5, 7, 3); ctx.restore(); return true; }
    if (a.kind === 'ladybug' || a.kind === 'snail') { const p = ambientPos(a); ctx.save(); ctx.translate(p.x, p.y); ctx.globalAlpha = fade; ctx.scale(a.dir, 1); ctx.fillStyle = a.kind === 'snail' ? '#c9b458' : '#e8ecf5'; ctx.beginPath(); ctx.roundRect(-5, -4, 10, 5, 2); ctx.fill(); ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(-3, 1.5, 1.6, 0, Math.PI * 2); ctx.arc(3, 1.5, 1.6, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(120,255,160,' + (0.5 + 0.5 * Math.sin(t * 5)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(4, -5, 1, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return true; }
    if (a.kind === 'rabbit') { ctx.save(); ctx.translate(a.x, a.y); ctx.globalAlpha = fade; ctx.scale(a.vx > 0 ? 1 : -1, 1); ctx.fillStyle = '#e8ecf5'; ctx.beginPath(); ctx.roundRect(-10, -8, 20, 8, 3); ctx.fill(); ctx.fillStyle = '#333'; for (const wx of [-6, 0, 6]) { ctx.beginPath(); ctx.arc(wx, 1, 2.5, 0, Math.PI * 2); ctx.fill(); } ctx.fillStyle = '#3a6fd8'; ctx.fillRect(-8, -12, 8, 3); ctx.strokeStyle = '#aaa'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(6, -8); ctx.lineTo(6, -16); ctx.stroke(); ctx.restore(); return true; }
    if (a.kind === 'seed') { ctx.fillStyle = 'rgba(120,220,255,' + (0.85 * fade).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(a.x, a.y - a.age * 6, 1.5, 0, Math.PI * 2); ctx.fill(); return true; }
    return false;
  }
  function spMailbox(t) {
    const { x, y, w, h, postH } = mailbox;
    const dl = daylight();
    const flagUp = unread > 0;
    shadow(x + w / 2, y + postH + 2, w * 1.3, 4, 0.2);
    ctx.fillStyle = metal(90, dl); ctx.fillRect(x + w / 2 - 4, y - 6, 8, postH + 6);
    ctx.save(); ctx.translate(x + w / 2, y - h + 14); ctx.rotate(-0.5 + Math.sin(t * 0.4) * 0.1);
    ctx.fillStyle = metal(200, dl); ctx.beginPath(); ctx.ellipse(0, 0, w * 0.6, w * 0.22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = metal(120, dl); ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(0, 0, w * 0.4, w * 0.14, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = metal(120, dl); ctx.fillRect(-1.5, -22, 3, 22); ctx.fillStyle = flagUp ? '#ffcb5c' : metal(160, dl); ctx.beginPath(); ctx.arc(0, -24, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (flagUp) { const pulse = 0.5 + 0.5 * Math.sin(t * 3); ctx.strokeStyle = 'rgba(255,220,120,' + (0.3 + 0.4 * pulse).toFixed(2) + ')'; ctx.lineWidth = 1.5; for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.arc(x + w / 2, y - h, 8 + k * 8 + pulse * 4, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); } }
    if (unread > 0) { ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#c94a3a'; ctx.beginPath(); ctx.arc(x + w / 2, y - h - 6, 9, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(String(unread), x + w / 2, y - h - 6); }
  }
  function spDesk(t) {
    const st = deskState();
    const on = st.mode === 'ready', queue = st.mode === 'queue' || st.mode === 'later';
    const { x, y, w } = desk;
    const dl = daylight();
    ctx.fillStyle = metal(110, dl); ctx.beginPath(); ctx.roundRect(x, y - 30, w, 30, [4, 4, 0, 0]); ctx.fill();
    ctx.fillStyle = metal(70, dl); ctx.fillRect(x + 4, y - 26, w - 8, 14);
    ctx.fillStyle = on ? 'rgba(120,255,180,0.9)' : queue ? 'rgba(255,200,90,0.8)' : 'rgba(120,140,170,0.6)';
    for (let i = 0; i < 3; i++) ctx.fillRect(x + 8, y - 23 + i * 4, (w - 16) * (0.5 + 0.5 * Math.abs(Math.sin(t * 1.5 + i))) * (on || queue ? 1 : 0.4), 2);
    for (let i = 0; i < 4; i++) { ctx.fillStyle = 'hsla(' + (i * 90) + ',80%,60%,' + (on || queue ? 0.5 + 0.5 * Math.sin(t * 4 + i) : 0.25).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(x + 10 + i * 8, y - 6, 2, 0, Math.PI * 2); ctx.fill(); }
    if (on || queue) { const g = ctx.createRadialGradient(x + w / 2, y - 20, 2, x + w / 2, y - 20, 40); g.addColorStop(0, (on ? 'rgba(120,255,180,' : 'rgba(255,200,90,') + (on ? 0.35 : 0.15) + ')'); g.addColorStop(1, 'rgba(120,255,180,0)'); ctx.fillStyle = g; ctx.fillRect(x + w / 2 - 40, y - 60, 80, 80); }
    if (queuedNotes[st.s && st.s.id]) { ctx.fillStyle = '#c94a3a'; ctx.beginPath(); ctx.arc(x + w - 8, y - 34, 5, 0, Math.PI * 2); ctx.fill(); }
  }
  function spGate(t) {
    const { x, y, w } = gate;
    const dl = daylight();
    shadow(x + w / 2, y + 4, w + 40, 5, 0.16);
    // a hull wall with an airlock
    ctx.fillStyle = metal(120, dl); ctx.fillRect(x + w + 4, y - 56, W - x - w - 4, 60);
    ctx.fillStyle = metal(90, dl); for (let px = x + w + 4; px < W; px += 40) ctx.fillRect(px, y - 56, 2, 60);
    ctx.fillStyle = metal(150, dl); ctx.fillRect(x + w + 4, y - 60, W - x - w - 4, 4);
    for (let px = x + w + 24; px < W - 10; px += 40) { ctx.fillStyle = 'rgba(120,220,255,' + (0.4 + 0.4 * Math.sin(t * 2 + px)).toFixed(2) + ')'; ctx.fillRect(px - 6, y - 30, 12, 3); }
    ctx.fillStyle = metal(140, dl); ctx.fillRect(x - 8, y - 70, 12, 76); ctx.fillRect(x + w - 4, y - 70, 12, 76); ctx.fillRect(x - 8, y - 74, w + 20, 6);
    const pm = (focused() && focused().permissionMode) || '';
    const openMode = !pm || pm === 'auto' || pm === 'bypassPermissions';
    const open = !paused && openMode;
    // the door slides up when open
    const doorH = open ? 12 : 64;
    ctx.fillStyle = metal(open ? 100 : 130, dl); ctx.fillRect(x + 4, y - 68, w - 8, doorH);
    ctx.strokeStyle = metal(60, dl); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + w / 2, y - 68); ctx.lineTo(x + w / 2, y - 68 + doorH); ctx.stroke();
    const lamp = paused ? '#ff5a4a' : open ? '#6fd38a' : pm === 'plan' ? '#ffcb5c' : '#ff8f4d';
    ctx.fillStyle = lamp; ctx.beginPath(); ctx.arc(x + w / 2, y - 78, 3.5, 0, Math.PI * 2); ctx.fill();
    if (pm === 'plan' && !paused) { ctx.fillStyle = 'rgba(20,30,50,0.9)'; ctx.beginPath(); ctx.roundRect(x + w / 2 - 24, y - 40, 48, 14, 3); ctx.fill(); ctx.fillStyle = '#ffcb5c'; ctx.font = '600 9px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('planning', x + w / 2, y - 33); }
    if (paused) { ctx.strokeStyle = '#ff5a4a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + w / 2 - 8, y - 44); ctx.lineTo(x + w / 2 + 8, y - 28); ctx.moveTo(x + w / 2 + 8, y - 44); ctx.lineTo(x + w / 2 - 8, y - 28); ctx.stroke(); }
    drawGateVisitor(t);
  }
  function spReactor(r, s, t) {
    if (!s) return;
    const dl = daylight();
    const left = s.night ? 0 : Math.max(0, Math.min(1, 1 - contextFraction(s) / compactAt));
    const k = Math.max(0.8, Math.min(1.3, r.scale || 1));
    const bx = r.x - 20 * k, by = r.y + r.h;
    const gw = 24 * k, gh = 44 * k, gx = bx - gw / 2, gy = by - 5 * k - gh;
    shadow(bx + 4, by + 2, gw + 14, 3, 0.2);
    ctx.fillStyle = metal(110, dl); ctx.beginPath(); ctx.roundRect(gx - 4, gy - 6 * k, gw + 8, gh + 12 * k, 4); ctx.fill();
    ctx.fillStyle = 'rgba(20,30,50,0.9)'; ctx.beginPath(); ctx.roundRect(gx, gy, gw, gh, 3); ctx.fill();
    const fillH = (gh - 4) * 0.62, lvl = fillH * left;
    const hue = 150 - 110 * (1 - left);
    if (left > 0) { ctx.fillStyle = 'hsla(' + hue + ',90%,60%,0.9)'; ctx.fillRect(gx + 2, gy + gh - 2 - lvl, gw - 4, lvl); ctx.fillStyle = 'rgba(255,255,255,0.4)'; for (let i = 0; i < 3; i++) { const ph = (t * 0.7 + i * 0.37) % 1; ctx.fillRect(gx + 4 + i * 6 * k, gy + gh - 3 - ph * lvl, 2 * k, 1.2 * k); } }
    const lineY = gy + gh - 2 - fillH;
    ctx.strokeStyle = 'rgba(200,230,255,0.8)'; ctx.lineWidth = 1.2 * k; ctx.beginPath(); ctx.moveTo(gx + 2, lineY); ctx.lineTo(gx + gw - 2, lineY); ctx.stroke();
    ctx.lineWidth = 1; for (const q of [0.75, 0.5, 0.25]) { const ty = gy + gh - 2 - fillH * q; ctx.beginPath(); ctx.moveTo(gx + 2, ty); ctx.lineTo(gx + 2 + 4 * k, ty); ctx.stroke(); }
    ctx.fillStyle = 'rgba(200,230,255,0.85)'; ctx.font = (7 * k).toFixed(1) + 'px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText('max', gx + gw - 3, lineY - 1);
    ctx.strokeStyle = metal(160, dl); ctx.lineWidth = 1.2 * k; ctx.beginPath(); ctx.roundRect(gx, gy, gw, gh, 3); ctx.stroke();
    if (left > 0) { const low = left < 0.25, flick = low ? 0.5 + 0.5 * Math.abs(Math.sin(t * 17)) : 1; const gl = ctx.createRadialGradient(bx, gy + gh / 2, 4, bx, gy + gh / 2, (40 + 40 * left) * k); gl.addColorStop(0, 'hsla(' + hue + ',90%,65%,' + (0.35 * flick * (0.4 + 0.6 * left)).toFixed(2) + ')'); gl.addColorStop(1, 'hsla(' + hue + ',90%,65%,0)'); ctx.fillStyle = gl; ctx.fillRect(bx - 90, gy - 60, 180, 200); }
    else { ctx.fillStyle = 'rgba(255,80,80,' + (0.4 + 0.5 * Math.abs(Math.sin(t * 4))).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(bx, gy - 3 * k, 2.5 * k, 0, Math.PI * 2); ctx.fill(); }
    lanterns[s.id] = { x: bx, y: gy + gh / 2, w: gw, h: gh + 12 * k, left, pct: Math.round(100 * contextFraction(s)), night: Boolean(s.night) };
  }
  THEMES.space = {
    id: 'space', name: 'Orbit', hat: 'space',
    perkNames: { headstart: 'Launch kit', deeproots: 'Core memory', longlight: 'Long flare', patientsoil: 'Patient ice', secondwind: 'Second burn', greenkey: 'Station key' },
    achNames: { clicks1k: 'Steady scoop', harvests10: 'Ten collapses', clicks100k: 'Astronaut' }, icon: '🪐', price: 10000000, firefly: 'rgba(120,220,255,',
    blurb: 'A planet that grows from dust to a ringed giant on a launch pad above a cratered moon. Stardust, cores, ice, starlight, and minerals; drills and tractor beams in the shop; drones, probes, a space station, and helpers in helmets.',
    words: {
      title: '🪐 Orbit of Claude', place: 'station', sap: 'stardust', seed: 'core', seeds: 'cores', plant: 'planet', plants: 'planets',
      harvest: 'Collapse', harvested: 'collapsed', nothingToHarvest: 'nothing to collapse', sprouted: 'formed',
      water: 'ice', light: 'starlight', nutrients: 'minerals', sunbeam: 'solar flare', puddle: 'comet dust', greenhouse: 'space station',
      crowLanded: 'a rogue drone arrived', crowTitle: 'A rogue drone', birdTitle: 'A passing comet', birdFloat: '☄ +',
      beeTitle: 'A probe', beeTip: 'Click it to dock the probe for a bonus before it drifts off.', beeVisit: 'a probe is orbiting', beeFloat: '🛰 docked +',
      shopTitle: 'Orbital supply', shopTab: 'Station', prestige: 'Big bang', season: 'cycle',
      stages: ['dust', 'pebbles', 'planetesimal', 'protoplanet', 'rocky world', 'atmosphere', 'oceans', 'life', 'city lights', 'glowing', 'ringed', 'gas giant', 'ancient', 'mythic'],
      mailboxTitle: 'Comms dish', mailboxEmpty: 'Transmissions arrive here only when Claude needs an answer from you.', deskTitle: 'Console', gateTitle: 'The airlock', lanternTitle: 'Reactor of', tend: 'click to gather stardust',
      starTitle: 'A meteor', butterflyTitle: 'A satellite', catTitle: 'A cat', snailTitle: 'A slow rover', ladybugTitle: 'A bug-bot',
      lanternOut: 'Powered down while the context is compacted. It restarts when compaction finishes.', lanternLeft: 'of the fuel left before compaction is due.', lanternLow: 'The core is flickering. Let auto-compact run or type /compact in the app.',
    },
    items: {
      trowel: { name: 'Scoop', icon: '🥄' }, can: { name: 'Drill', icon: '⛏️' }, shears: { name: 'Mining laser', icon: '🔦' }, trellis: { name: 'Tractor beam', icon: '🧲' }, hive: { name: 'Mining fleet', icon: '🚀' }, sprinkler: { name: 'Asteroid crusher', icon: '☄️' }, orchard: { name: 'Dyson swarm', icon: '🌞' },
      longbeam: { name: 'Long flare', desc: 'The solar flare after Claude writes a file lasts 12, then 16 seconds instead of 8.' },
      brightbeam: { name: 'Bright flare', icon: '🌟', desc: 'Clicks inside a solar flare pay four times instead of three.' },
      puddle: { name: 'Thick comet dust', icon: '☄️', desc: 'Clicks while comet dust falls on a planet pay double instead of 1.5 times.' },
      birdseed: { name: 'Comet net', icon: '🕸️', desc: 'Catching a passing comet pays three times as much.' },
      hold: { desc: 'Hold the button down on a planet and it keeps clicking for you: 3 a second, then 4, 5, and 7, a touch faster than a fast thumb.' },
      barrel: { name: 'Ice tank', icon: '🧊', desc: 'Ice holds 150 and drains a third slower.' },
      compost: { name: 'Ore refinery', icon: '⚙️', desc: 'Shell commands give twice the minerals.' },
      feeder: { name: 'Solar array', icon: '🔆', desc: 'Every tool call feeds ice, starlight, and minerals twice as much.' },
      scarecrow: { name: 'Defense turret', icon: '🛰️', desc: 'Rogue drones from failed tools leave in 20 seconds instead of 60.' },
      greenhouse: { name: 'Space station', icon: '🛸', desc: 'A station in orbit over the pad. Starlight drains a third slower and drones can no longer slow the trickle.' },
    },
    species: {
      leafy: { name: 'Rocky world', blurb: 'The everyday planet. Grey rock, craters, then seas and lights.' },
      sunflower: { name: 'Solar world', blurb: 'A golden world with a beacon that follows its star.' },
      cactus: { name: 'Desert world', blurb: 'Sand and red-lit canyons. Ice drains slowly.' },
      lavender: { name: 'Violet world', blurb: 'A purple world that thickens with moons as it grows.' },
      rose: { name: 'Volcanic world', blurb: 'Rust and fire from the start, oceans from the sixth stage up.' },
      bonsai: { name: 'Ringed moon', blurb: 'A small world that wears its rings early.' },
      crystalfern: { name: 'Ice world', blurb: 'Translucent glowing ice. Yields 30% more.' },
      moonbloom: { name: 'Silver moon', blurb: 'A single silver world that opens to the night.' },
    },
    palette: {
      DAY: [[0.00, [8, 8, 24], [40, 30, 70]], [0.12, [8, 10, 30], [30, 40, 90]], [0.60, [6, 10, 34], [26, 44, 96]], [0.80, [10, 8, 30], [50, 30, 80]], [1.00, [4, 4, 16], [24, 16, 50]]],
      NIGHT: [[3, 3, 12], [16, 12, 40]],
    },
    draw: { sky: spSky, ground: spGround, planter: spPlanter, plant: spPlanet, greenhouse: spStation, pests: spDrones, critters: spProbes, upgrades: spUpgrades, ambient: spAmbient, mailbox: spMailbox, desk: spDesk, gate: spGate, lantern: spReactor },
  };
})();

// ---------- theme: jurassic ----------
// A dinosaur that hatches from an egg and grows up in a nest under a volcano.
// Food for sap, eggs for seeds, water, sunshine, and ferns for the meters,
// pterosaurs for crows, beetles for bees.
(function registerDino() {
  const tag = themeShared.tag;
  function dnSky(t) {
    const [top, bottom] = skyColors(t);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgb(top)); g.addColorStop(1, rgb(bottom));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (!connected) return;
    const f = dayFraction(), night = isNight();
    const starA = night ? 1 : Math.max(0, (f - 0.85) / 0.15);
    if (starA > 0) for (const s of stars) { const a = (0.4 + 0.6 * Math.abs(Math.sin(t * 0.8 + s.tw))) * starA; ctx.fillStyle = 'rgba(255,255,255,' + (a * (1 - weather.cloud)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2); ctx.fill(); }
    if (night) { const mx = W * 0.78, my = H * 0.18; ctx.fillStyle = 'rgba(245,235,210,0.95)'; ctx.beginPath(); ctx.arc(mx, my, 24, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(200,180,150,0.5)'; for (const [dx, dy, r] of [[-7, -5, 5], [6, 4, 4]]) { ctx.beginPath(); ctx.arc(mx + dx, my + dy, r, 0, Math.PI * 2); ctx.fill(); } }
    else {
      // a big, hot sun
      const sx = W * 0.08 + f * W * 0.84, sy = H * 0.62 - Math.sin(f * Math.PI) * H * 0.5;
      const warmth = Math.max(0, 1 - Math.sin(f * Math.PI) * 1.4), r = 34 + weather.sun * 18 + warmth * 10;
      const core = mix([255, 235, 170], [255, 120, 60], warmth);
      const glow = ctx.createRadialGradient(sx, sy, r * 0.4, sx, sy, r * 4); glow.addColorStop(0, rgb(core, 0.45 + weather.sun * 0.3)); glow.addColorStop(1, rgb(core, 0)); ctx.fillStyle = glow; ctx.fillRect(sx - r * 4, sy - r * 4, r * 8, r * 8);
      ctx.fillStyle = rgb(core, 0.95); ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
    }
    // heavy tropical clouds when it rains, and haze the rest of the time
    if (weather.rain > 0.15) { ctx.fillStyle = 'rgba(70,80,90,' + (weather.rain * 0.7).toFixed(2) + ')'; for (let i = 0; i < 5; i++) { const cx = ((i + 0.5) / 5) * W + Math.sin(t * 0.3 + i) * 20; ctx.beginPath(); ctx.ellipse(cx, 34 + (i % 2) * 22, W * 0.16, 30, 0, 0, Math.PI * 2); ctx.fill(); } }
    ctx.fillStyle = 'rgba(255,240,200,' + (0.06 + 0.1 * weather.cloud).toFixed(2) + ')'; ctx.fillRect(0, H * 0.35, W, H * 0.4);
  }
  function dnGround(t) {
    const dl = daylight();
    const [, skyBottom] = skyColors(t);
    // a volcano on the far ridge, smoking
    const vx = W * 0.72, vb = soilY - 20;
    ctx.fillStyle = col(mix([80, 60, 60], skyBottom, 0.45), dl); ctx.beginPath(); ctx.moveTo(vx - W * 0.22, vb); ctx.lineTo(vx - 18, vb - H * 0.32); ctx.lineTo(vx + 18, vb - H * 0.32); ctx.lineTo(vx + W * 0.22, vb); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,120,40,' + (0.5 + 0.4 * Math.sin(t * 2)).toFixed(2) + ')'; ctx.fillRect(vx - 14, vb - H * 0.32, 28, 4);
    ctx.fillStyle = 'rgba(90,80,90,0.45)'; for (let i = 0; i < 5; i++) { const ph = (t * 0.15 + i * 0.2) % 1; ctx.beginPath(); ctx.arc(vx + Math.sin(ph * 4 + i) * 14 + ph * 40, vb - H * 0.32 - 6 - ph * 90, 6 + ph * 16, 0, Math.PI * 2); ctx.fill(); }
    // near jungle ridge
    ctx.fillStyle = col(mix([40, 90, 50], skyBottom, 0.3), dl * 0.9); ctx.beginPath(); ctx.moveTo(0, soilY);
    for (let x = 0; x <= W; x += 12) ctx.lineTo(x, soilY - 16 - Math.abs(Math.sin(x * 0.02)) * 18 - Math.abs(Math.sin(x * 0.07 + 1)) * 8);
    ctx.lineTo(W, soilY); ctx.closePath(); ctx.fill();
    const g = ctx.createLinearGradient(0, soilY - 8, 0, H);
    g.addColorStop(0, col([112, 150, 70], dl)); g.addColorStop(0.35, col([96, 120, 58], dl)); g.addColorStop(1, col([70, 60, 40], dl));
    ctx.fillStyle = g; ctx.fillRect(0, soilY - 8, W, H - soilY + 8);
    ctx.fillStyle = col([110, 80, 50], dl, 0.45); ctx.beginPath(); ctx.moveTo(0, soilY + 40); ctx.quadraticCurveTo(W * 0.5, soilY + 58, W, soilY + 44); ctx.lineTo(W, soilY + 72); ctx.quadraticCurveTo(W * 0.5, soilY + 86, 0, soilY + 66); ctx.closePath(); ctx.fill();
    // big ferns
    ctx.strokeStyle = col([60, 130, 60], dl); ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    for (const tf of tufts) {
      const x = tf.x * W, y = soilY + 4 + tf.y * (H - soilY - 8), h = tf.h * 2.2, sway = Math.sin(t * 1.6 + x * 0.05) * 1.2 * (1 + weather.wind * 4);
      for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + k * 6 + sway, y - h * 0.7, x + k * 12 + sway, y - h * (0.5 + 0.3 * Math.abs(k))); ctx.stroke(); }
    }
    ctx.fillStyle = col([150, 140, 120], dl); for (const pb of pebbles) { ctx.beginPath(); ctx.ellipse(pb.x * W, soilY + 10 + pb.y * (H - soilY - 20), pb.r * 2, pb.r * 1.2, 0, 0, Math.PI * 2); ctx.fill(); }
  }
  function dnPlanter(r, s, plant, isFocus) {
    const { x, w, y, h, cx } = r;
    const dl = daylight();
    shadow(cx, y + h + 3, w * 1.05, w * 0.06);
    // a nest of sticks and moss
    ctx.fillStyle = col(isFocus ? [140, 100, 60] : [120, 88, 54], dl); ctx.beginPath(); ctx.ellipse(cx, y + h * 0.55, w / 2 + 4, h * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = col([90, 62, 36], dl); ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let i = 0; i < Math.floor(w / 9); i++) { const a = (i / Math.floor(w / 9)) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (w / 2 - 6), y + h * 0.55 + Math.sin(a) * h * 0.35); ctx.lineTo(cx + Math.cos(a + 0.5) * (w / 2 + 6), y + h * 0.55 + Math.sin(a + 0.5) * h * 0.5); ctx.stroke(); }
    ctx.fillStyle = col([80, 60, 40], dl); ctx.beginPath(); ctx.ellipse(cx, y + 6, w / 2 - 6, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col([96, 140, 70], dl); for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(cx - w / 2 + 12 + ((i * 41) % Math.max(20, w - 24)), y + 4 + (i % 2) * 4, 5, 2.5, i, 0, Math.PI * 2); ctx.fill(); }
    if (plant) { ctx.fillStyle = 'rgba(30,60,110,' + ((plant.water / waterCap()) * 0.35).toFixed(2) + ')'; ctx.beginPath(); ctx.ellipse(cx, y + 6, w / 2 - 6, 8, 0, 0, Math.PI * 2); ctx.fill(); }
    const rings = Math.min(6, (s && s.compactions) || 0);
    if (rings) { ctx.fillStyle = col([230, 225, 210], dl); for (let i = 0; i < rings; i++) { ctx.beginPath(); ctx.ellipse(x + 10 + i * 9, y + h - 4, 3.5, 2, 0, 0, Math.PI * 2); ctx.fill(); } }
    if (s) tag(r, s, 'rgba(255,245,225,0.94)', '#2b2620', 'rgba(255,245,225,0.85)', '#4a4036');
  }
  // The dinosaur: an egg that cracks and hatches, then a creature that grows a
  // size per stage. Species set the body plan.
  function dnDino(r, sid, t, plant, wilt) {
    if (!plant) return;
    const dl = daylight();
    const sp = speciesOf(plant), si = plantStage(plant), prog = plantProgress(plant);
    const k = Math.max(0.6, r.scale) * (si >= 11 ? 1.3 : si >= 8 ? 1.15 : 1) * themeRoom(r);
    const cx = r.cx, base = r.y - 2;
    const shape = sp.shape;
    const skin = shape === 'cactus' ? [110, 100, 70] : shape === 'fronds' ? [230, 170, 60] : shape === 'moon' ? [90, 80, 100] : shape === 'stem' ? [90, 130, 90] : shape === 'spikes' ? [160, 110, 150] : shape === 'bonsai' ? [120, 120, 80] : sp.thorns ? [70, 120, 60] : [90, 150, 80];
    ctx.save(); ctx.globalAlpha = 1 - wilt * 0.6;
    if (si <= 1) {
      // the egg, cracking at stage one
      const ew = 16 * k, eh = 22 * k, ey = base - eh;
      ctx.fillStyle = col([240, 232, 210], dl); ctx.beginPath(); ctx.ellipse(cx, ey, ew, eh, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col([200, 180, 140], dl, 0.6); for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(cx + Math.sin(i * 2.1) * ew * 0.6, ey + Math.cos(i * 1.7) * eh * 0.6, 2 * k, 0, Math.PI * 2); ctx.fill(); }
      if (si === 1) { ctx.strokeStyle = '#3b2a12'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx - ew * 0.5, ey); ctx.lineTo(cx - ew * 0.2, ey - eh * 0.2 - prog * 4); ctx.lineTo(cx + ew * 0.1, ey + eh * 0.1); ctx.lineTo(cx + ew * 0.5, ey - eh * 0.15); ctx.stroke(); const wob = Math.sin(t * 8) * (prog > 0.5 ? 2 : 0.6); ctx.translate(wob, 0); }
      ctx.restore(); return;
    }
    const size = (10 + Math.min(si, 12) * 3.2 + prog * 2) * k;
    const long = shape === 'stem';
    const bw = size * (shape === 'cactus' || shape === 'bonsai' ? 1.5 : 1.3), bh = size * (shape === 'cactus' ? 0.75 : 0.65);
    const legH = size * (long ? 0.9 : 0.6), by = base - legH - bh * 0.5;
    const breathe = 1 + Math.sin(t * 2) * 0.02, sway = Math.sin(t * 1.3) * 0.08;
    const tone = col(skin, dl), dark = col(skin.map((c) => c * 0.7), dl), belly = col(skin.map((c) => Math.min(255, c + 60)), dl);
    // tail
    ctx.strokeStyle = tone; ctx.lineCap = 'round'; ctx.lineWidth = bh * 0.5;
    ctx.beginPath(); ctx.moveTo(cx - bw * 0.6, by); ctx.quadraticCurveTo(cx - bw * 1.2, by + bh * 0.1 + sway * 20, cx - bw * (shape === 'cactus' ? 1.5 : 1.8), by - bh * 0.4 + sway * 40); ctx.stroke();
    if (shape === 'cactus') { ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(cx - bw * 1.5, by - bh * 0.4 + sway * 40, bh * 0.4, 0, Math.PI * 2); ctx.fill(); }
    // legs
    ctx.fillStyle = dark;
    const step = Math.sin(t * 3) * 1.5;
    for (const lx of long ? [-0.45, -0.2, 0.2, 0.45] : [-0.35, 0.3]) { ctx.beginPath(); ctx.roundRect(cx + bw * lx - size * 0.12, by + bh * 0.2, size * 0.24, legH + bh * 0.3 + (lx < 0 ? step : -step), size * 0.1); ctx.fill(); }
    // body
    ctx.fillStyle = tone; ctx.beginPath(); ctx.ellipse(cx, by, bw * breathe, bh * breathe, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = belly; ctx.beginPath(); ctx.ellipse(cx + bw * 0.05, by + bh * 0.35, bw * 0.7, bh * 0.35, 0, 0, Math.PI * 2); ctx.fill();
    // plates, armour, or feathers
    if (sp.thorns) { ctx.fillStyle = col([200, 90, 60], dl); for (let i = -2; i <= 2; i++) { const px = cx + i * bw * 0.32; ctx.beginPath(); ctx.moveTo(px - size * 0.18, by - bh * 0.85); ctx.lineTo(px, by - bh * 0.85 - size * 0.55); ctx.lineTo(px + size * 0.18, by - bh * 0.85); ctx.closePath(); ctx.fill(); } }
    if (shape === 'cactus') { ctx.fillStyle = dark; for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.arc(cx + i * bw * 0.25, by - bh * 0.7, size * 0.13, 0, Math.PI * 2); ctx.fill(); } }
    if (shape === 'branch' && !sp.thorns) { ctx.fillStyle = col([200, 140, 60], dl); for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.ellipse(cx + i * bw * 0.28, by - bh * 0.8, size * 0.1, size * 0.25, i * 0.2, 0, Math.PI * 2); ctx.fill(); } }
    // neck and head
    const nx = cx + bw * 0.75, ny = by - bh * 0.3;
    const hx = long ? nx + size * 0.5 : nx + size * 0.55, hy = long ? ny - size * 2.2 : ny - size * 0.5;
    ctx.strokeStyle = tone; ctx.lineWidth = long ? size * 0.45 : size * 0.6; ctx.beginPath(); ctx.moveTo(nx, ny); ctx.quadraticCurveTo(long ? nx + size * 0.2 : nx + size * 0.3, long ? ny - size * 1.2 : ny - size * 0.2, hx, hy); ctx.stroke();
    const hr = size * (shape === 'moon' ? 0.55 : long ? 0.32 : 0.42);
    ctx.fillStyle = tone; ctx.beginPath(); ctx.ellipse(hx + hr * 0.4, hy, hr * 1.4, hr, 0, 0, Math.PI * 2); ctx.fill();
    if (shape === 'bonsai') { ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(hx - hr * 0.2, hy - hr * 0.2, hr * 1.2, Math.PI * 0.9, Math.PI * 2.1); ctx.fill(); ctx.fillStyle = belly; for (const [ox, oy] of [[0.6, -1.3], [1.3, -0.6], [1.9, 0.2]]) { ctx.beginPath(); ctx.moveTo(hx + hr * ox, hy + hr * oy); ctx.lineTo(hx + hr * (ox + 0.5), hy + hr * (oy - 0.9)); ctx.lineTo(hx + hr * (ox + 0.3), hy + hr * oy); ctx.closePath(); ctx.fill(); } }
    if (shape === 'spikes') { ctx.fillStyle = col([200, 120, 170], dl); ctx.beginPath(); ctx.moveTo(hx, hy - hr * 0.6); ctx.quadraticCurveTo(hx - hr * 1.6, hy - hr * 2, hx - hr * 2.4, hy - hr * 1.2); ctx.lineTo(hx - hr * 0.2, hy - hr * 0.2); ctx.closePath(); ctx.fill(); }
    if (shape === 'moon') { ctx.fillStyle = belly; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(hx + hr * (0.5 + i * 0.35), hy + hr * 0.6); ctx.lineTo(hx + hr * (0.62 + i * 0.35), hy + hr * 1.05); ctx.lineTo(hx + hr * (0.74 + i * 0.35), hy + hr * 0.6); ctx.closePath(); ctx.fill(); } }
    const blink = Math.sin(t * 1.1 + r.x) > 0.96;
    ctx.fillStyle = blink ? tone : '#fff'; ctx.beginPath(); ctx.ellipse(hx + hr * 0.5, hy - hr * 0.25, hr * 0.28, hr * (blink ? 0.05 : 0.28), 0, 0, Math.PI * 2); ctx.fill();
    if (!blink) { ctx.fillStyle = '#1c1c24'; ctx.beginPath(); ctx.arc(hx + hr * 0.6, hy - hr * 0.25, hr * 0.13, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(hx + hr * 1.5, hy + hr * 0.15, hr * 0.1, 0, Math.PI * 2); ctx.fill();
    // a nest with eggs beside it from the nesting stage; a crown of feathers for the alpha
    if (si >= 6) { const ex = cx - bw * 1.6, ey = base - 6 * k; ctx.fillStyle = col([120, 88, 54], dl); ctx.beginPath(); ctx.ellipse(ex, ey + 2, 14 * k, 6 * k, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = col([240, 232, 210], dl); for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.ellipse(ex + i * 7 * k, ey - 3 * k, 4 * k, 5.5 * k, 0, 0, Math.PI * 2); ctx.fill(); } }
    if (si >= 7) { for (let i = -1; i <= 1; i++) { ctx.fillStyle = ['#e04a3a', '#f2c94c', '#3aa0e0'][i + 1]; ctx.beginPath(); ctx.ellipse(hx - hr * 0.3 + i * hr * 0.3, hy - hr * 1.3 + Math.sin(t * 2 + i) * 1.5, hr * 0.12, hr * 0.5, i * 0.4, 0, Math.PI * 2); ctx.fill(); } }
    if (si >= 9) { const gl = ctx.createRadialGradient(cx, by, bh, cx, by, bw * 2.2); gl.addColorStop(0, 'rgba(255,220,120,' + (si >= 10 ? 0.22 : 0.14) + ')'); gl.addColorStop(1, 'rgba(255,220,120,0)'); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(cx, by, bw * 2.2, 0, Math.PI * 2); ctx.fill(); }
    if (si >= 10) { for (let i = 0; i < 6; i++) { ctx.fillStyle = 'hsla(' + ((t * 30 + i * 60) % 360) + ',85%,65%,0.8)'; ctx.beginPath(); ctx.arc(cx + Math.sin(i * 2.3) * bw * 0.6, by + Math.cos(i * 1.9) * bh * 0.5, size * 0.09, 0, Math.PI * 2); ctx.fill(); } }
    if (si >= 12) { ctx.strokeStyle = 'rgba(60,40,30,0.5)'; ctx.lineWidth = 1.2; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(cx - bw * 0.4 + i * bw * 0.3, by - bh * 0.3); ctx.lineTo(cx - bw * 0.3 + i * bw * 0.3, by + bh * 0.1); ctx.stroke(); } }
    if (si >= 13) { for (let i = 0; i < 3; i++) { const a = t * 0.3 + i * 2.1; ctx.strokeStyle = 'hsla(' + ((t * 40 + i * 120) % 360) + ',90%,80%,0.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(hx, hy - hr); ctx.lineTo(hx + Math.cos(a) * W * 0.4, hy - hr - Math.abs(Math.sin(a)) * H * 0.5 - 40); ctx.stroke(); } }
    ctx.restore();
  }
  function dnCave(t) {
    if (!has('greenhouse')) return;
    const dl = daylight();
    const w = Math.max(96, Math.min(150, W * 0.11)), h = w * 0.6;
    const x = W * 0.27, y = soilY - 4;
    shadow(x, y + 3, w * 1.05, 5, 0.15);
    ctx.fillStyle = col([110, 100, 90], dl); ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.quadraticCurveTo(x - w * 0.4, y - h * 1.1, x, y - h); ctx.quadraticCurveTo(x + w * 0.45, y - h * 1.05, x + w / 2, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = col([80, 72, 66], dl); for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(x - w * 0.3 + i * w * 0.2, y - h * 0.5 - (i % 2) * 12, 6, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#1a1410'; ctx.beginPath(); ctx.moveTo(x - w * 0.18, y); ctx.quadraticCurveTo(x, y - h * 0.7, x + w * 0.18, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,150,60,' + (0.4 + 0.3 * Math.sin(t * 5)).toFixed(2) + ')'; ctx.beginPath(); ctx.moveTo(x - w * 0.1, y); ctx.quadraticCurveTo(x, y - h * 0.35, x + w * 0.1, y); ctx.closePath(); ctx.fill();
  }
  function dnPteros(t) {
    for (const p of pests) {
      const pos = pestPos(p); if (!pos) continue;
      const x = pos.x, y = pos.y - 6 + Math.sin(t * 3 + p.flap) * 3, flap = Math.sin(t * 6 + p.flap) * 6;
      ctx.fillStyle = '#6b4a3a'; ctx.beginPath(); ctx.moveTo(x - 16, y - flap); ctx.quadraticCurveTo(x - 6, y + 2, x, y); ctx.quadraticCurveTo(x + 6, y + 2, x + 16, y - flap); ctx.lineTo(x + 6, y + 3); ctx.lineTo(x - 6, y + 3); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + 3, y - 1); ctx.lineTo(x + 14, y - 4); ctx.lineTo(x + 8, y + 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#c94a3a'; ctx.beginPath(); ctx.moveTo(x + 2, y - 5); ctx.lineTo(x - 2, y - 11); ctx.lineTo(x + 5, y - 3); ctx.closePath(); ctx.fill();
    }
  }
  function dnBeetles(t) {
    for (const c of critters) {
      const fade = Math.min(1, c.age * 3, (c.life - c.age) * 2);
      ctx.save(); ctx.globalAlpha = fade; ctx.translate(c.x, c.y);
      ctx.fillStyle = '#2b5f3a'; ctx.beginPath(); ctx.ellipse(0, 0, 6, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(180,255,200,0.5)'; ctx.beginPath(); ctx.ellipse(-1.5, -1, 2.5, 1.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#1c2c20'; ctx.lineWidth = 1; for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(sx * 3, -2 + i * 2); ctx.lineTo(sx * 8, -4 + i * 3 + Math.sin(t * 20 + i) * 1.5); ctx.stroke(); }
      ctx.restore();
    }
  }
  function dnUpgrades(t) {
    const dl = daylight();
    if (has('barrel')) { const x = mailbox.x + mailbox.w + 22, y = soilY; ctx.fillStyle = col([110, 80, 50], dl, 0.6); ctx.beginPath(); ctx.ellipse(x + 16, y + 6, 26, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(70,130,200,0.8)'; ctx.beginPath(); ctx.ellipse(x + 16, y + 6, 20, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(x + 16 + Math.sin(t) * 3, y + 6, 8 + Math.sin(t * 2) * 2, 2.5, 0, 0, Math.PI * 2); ctx.stroke(); }
    const room = gate.x - 8;
    if (has('compost')) { const x = room - (has('scarecrow') ? 56 : 0) - 28, y = soilY; ctx.strokeStyle = col([60, 140, 70], dl); ctx.lineWidth = 2; ctx.lineCap = 'round'; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + i * 8 + Math.sin(t + i) * 2, y - 24, x + i * 16, y - 30 + Math.abs(i) * 6); ctx.stroke(); } }
    if (has('scarecrow')) { const x = room - 28, y = soilY - 2; shadow(x, y + 6, 30, 4, 0.2); ctx.fillStyle = col([122, 84, 51], dl); ctx.fillRect(x - 2, y - 60, 4, 62); ctx.fillStyle = col([235, 228, 210], dl); ctx.beginPath(); ctx.ellipse(x, y - 68, 10, 12, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#1c1c24'; ctx.beginPath(); ctx.arc(x - 4, y - 70, 2.5, 0, Math.PI * 2); ctx.arc(x + 4, y - 70, 2.5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = col([235, 228, 210], dl); for (let i = -2; i <= 2; i++) ctx.fillRect(x - 14 + i * 7, y - 48, 4, 10); ctx.fillRect(x - 16, y - 50, 32, 3); }
    if (has('feeder')) { const x = Math.min(W - 30, gate.x + gate.w + 40), y = soilY; ctx.fillStyle = col([50, 110, 60], dl); ctx.beginPath(); ctx.ellipse(x, y - 14, 16, 14, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#5a3f9a'; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(x - 10 + (i * 7) % 20, y - 22 + (i * 5) % 14, 2.2, 0, Math.PI * 2); ctx.fill(); } }
  }
  function dnAmbient(a, layer, t, fade) {
    const dl = daylight();
    if (layer === 'back') {
      if (a.kind === 'cloud') {
        const w = a.w, h = w * 0.36;
        ctx.fillStyle = 'rgba(235,235,230,' + (0.4 * dl * fade).toFixed(2) + ')';
        ctx.beginPath(); ctx.ellipse(a.x, a.y, w * 0.5, h * 0.5, 0, 0, Math.PI * 2); ctx.ellipse(a.x - w * 0.28, a.y + h * 0.15, w * 0.3, h * 0.45, 0, 0, Math.PI * 2); ctx.ellipse(a.x + w * 0.25, a.y - h * 0.05, w * 0.34, h * 0.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(120,120,130,' + (0.25 * dl * fade).toFixed(2) + ')'; ctx.beginPath(); ctx.ellipse(a.x, a.y + h * 0.35, w * 0.55, h * 0.22, 0, 0, Math.PI * 2); ctx.fill();
        return true;
      }
      if (a.kind === 'flock') { ctx.fillStyle = 'rgba(60,40,40,' + (0.7 * fade).toFixed(2) + ')'; for (let k = 0; k < a.n; k++) { const bx = a.x + Math.abs(k - (a.n - 1) / 2) * 18, by = a.y + (k - (a.n - 1) / 2) * 8, flap = Math.sin(t * 5 + k) * 5; ctx.beginPath(); ctx.moveTo(bx - 10, by - flap); ctx.quadraticCurveTo(bx - 3, by + 2, bx, by); ctx.quadraticCurveTo(bx + 3, by + 2, bx + 10, by - flap); ctx.lineTo(bx + 5, by + 2); ctx.lineTo(bx + 9, by + 1); ctx.lineTo(bx, by + 3); ctx.lineTo(bx - 5, by + 2); ctx.closePath(); ctx.fill(); } return true; }
      if (a.kind === 'plane') { const dir = a.vx > 0 ? 1 : -1; const g = ctx.createLinearGradient(a.x - dir * 120, 0, a.x, 0); g.addColorStop(0, 'rgba(255,200,120,0)'); g.addColorStop(1, 'rgba(255,220,160,' + (0.8 * fade).toFixed(2) + ')'); ctx.strokeStyle = g; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(a.x - dir * 120, a.y + 12); ctx.lineTo(a.x, a.y); ctx.stroke(); ctx.fillStyle = 'rgba(255,240,200,' + fade.toFixed(2) + ')'; ctx.beginPath(); ctx.arc(a.x, a.y, 4, 0, Math.PI * 2); ctx.fill(); return true; }
      if (a.kind === 'balloon') { ctx.save(); ctx.translate(a.x, a.y); ctx.globalAlpha = fade * (0.6 + 0.4 * dl); const flap = Math.sin(t * 9) * 8; ctx.fillStyle = 'rgba(140,200,255,0.5)'; ctx.beginPath(); ctx.ellipse(-14, -2 - flap * 0.3, 14, 4, -0.3, 0, Math.PI * 2); ctx.ellipse(14, -2 - flap * 0.3, 14, 4, 0.3, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = col([60, 110, 80], dl); ctx.beginPath(); ctx.ellipse(0, 0, 3, 16, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#7fe0ff'; ctx.beginPath(); ctx.arc(0, -14, 3, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return true; }
      return false;
    }
    if (a.kind === 'kite') {
      // a big leaf on a vine, flown by someone at the camp
      ctx.save(); ctx.globalAlpha = fade;
      ctx.strokeStyle = col([90, 130, 60], dl, 0.7); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(a.ax, a.ay); ctx.quadraticCurveTo((a.ax + a.x) / 2 - 20, (a.ay + a.y) / 2 + 30, a.x, a.y); ctx.stroke();
      ctx.translate(a.x, a.y); ctx.rotate(0.5 + Math.sin(a.age * 1.7 + a.phase) * 0.15);
      ctx.fillStyle = col([70, 150, 70], dl); ctx.beginPath(); ctx.moveTo(0, -18); ctx.quadraticCurveTo(14, -4, 0, 18); ctx.quadraticCurveTo(-14, -4, 0, -18); ctx.fill();
      ctx.strokeStyle = col([40, 100, 50], dl); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(0, 16); ctx.stroke();
      ctx.restore(); return true;
    }
    if (a.kind === 'butterfly') { ctx.save(); ctx.translate(a.x, a.y); ctx.globalAlpha = fade; const flap = Math.sin(t * 16 + a.phase) * 5; ctx.fillStyle = 'hsla(' + a.hue + ',60%,70%,0.6)'; ctx.beginPath(); ctx.ellipse(-8, -1 - flap * 0.3, 8, 2.5, -0.2, 0, Math.PI * 2); ctx.ellipse(8, -1 - flap * 0.3, 8, 2.5, 0.2, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = col([50, 90, 70], dl); ctx.beginPath(); ctx.ellipse(0, 0, 2, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return true; }
    if (a.kind === 'rabbit') { ctx.save(); ctx.translate(a.x, a.y - Math.abs(Math.sin(a.age * 7)) * 5); ctx.globalAlpha = fade; ctx.scale(a.vx > 0 ? 1 : -1, 1); ctx.fillStyle = col([120, 160, 90], dl); ctx.beginPath(); ctx.ellipse(0, -5, 9, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(-9, -5); ctx.lineTo(-20, -9); ctx.lineTo(-9, -3); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.arc(10, -9, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = col([90, 120, 70], dl); ctx.fillRect(-3, -2, 2, 6 + Math.sin(a.age * 14) * 2); ctx.fillRect(3, -2, 2, 6 - Math.sin(a.age * 14) * 2); ctx.fillStyle = '#1c1c24'; ctx.beginPath(); ctx.arc(11, -10, 0.8, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return true; }
    if (a.kind === 'seed') { ctx.fillStyle = 'rgba(200,230,140,' + (0.7 * fade).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(a.x, a.y, 2, 0, Math.PI * 2); ctx.fill(); return true; }
    return false;
  }
  function dnMailbox(t) {
    const { x, y, w, h, postH } = mailbox;
    const dl = daylight();
    const flagUp = unread > 0;
    shadow(x + w / 2, y + postH + 2, w * 1.3, 4, 0.2);
    ctx.fillStyle = col([130, 120, 105], dl); ctx.beginPath(); ctx.moveTo(x - 4, y + postH); ctx.lineTo(x + 2, y - h + 4); ctx.lineTo(x + w - 2, y - h); ctx.lineTo(x + w + 6, y + postH); ctx.closePath(); ctx.fill();
    ctx.fillStyle = col([100, 92, 80], dl); ctx.fillRect(x + 6, y - h + 10, w - 12, 3); ctx.fillRect(x + 8, y - h + 18, w - 16, 3);
    ctx.fillStyle = flagUp ? '#c94a3a' : col([150, 60, 40], dl, 0.6); ctx.beginPath(); ctx.arc(x + w / 2, y + 10, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = flagUp ? '#ffcb5c' : col([190, 170, 140], dl); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + w / 2 - 6, y + 24); ctx.lineTo(x + w / 2 + 6, y + 24); ctx.moveTo(x + w / 2, y + 18); ctx.lineTo(x + w / 2, y + 30); ctx.stroke();
    if (flagUp) { const pulse = 0.5 + 0.5 * Math.sin(t * 3); ctx.fillStyle = 'rgba(255,200,120,' + (0.25 + 0.35 * pulse).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(x + w / 2, y - h / 2, w * 0.9, 0, Math.PI * 2); ctx.fill(); }
    if (unread > 0) { ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#c94a3a'; ctx.beginPath(); ctx.arc(x + w / 2, y - h - 6, 9, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(String(unread), x + w / 2, y - h - 6); }
  }
  function dnDesk(t) {
    const st = deskState();
    const on = st.mode === 'ready', queue = st.mode === 'queue' || st.mode === 'later';
    const { x, y, w } = desk;
    const dl = daylight();
    ctx.fillStyle = col([140, 130, 115], dl); ctx.beginPath(); ctx.ellipse(x + w / 2, y - 6, w / 2 + 4, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(x - 4, y - 24, w + 8, 18);
    ctx.fillStyle = col([160, 150, 132], dl); ctx.beginPath(); ctx.ellipse(x + w / 2, y - 24, w / 2 + 4, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = on ? '#c94a3a' : queue ? '#a0483a' : '#8a8478'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + 12, y - 27); ctx.lineTo(x + 20, y - 22); ctx.moveTo(x + 22, y - 27); ctx.lineTo(x + 30, y - 22); ctx.moveTo(x + 14, y - 22); ctx.lineTo(x + 28, y - 27); ctx.stroke();
    if (on || queue) { ctx.save(); ctx.translate(x + w - 18, y - 36 + Math.sin(t * 2) * 2); ctx.rotate(-0.8); ctx.fillStyle = col([200, 190, 170], dl); ctx.fillRect(-2, -14, 4, 14); ctx.fillStyle = col([100, 80, 60], dl); ctx.fillRect(-2, 0, 4, 4); ctx.restore(); }
    // a torch for the lamp
    ctx.fillStyle = col([122, 84, 51], dl); ctx.fillRect(x + w - 16, y - 46, 4, 22);
    if (on || queue) { const fl = 4 + Math.sin(t * 9) * 1; ctx.fillStyle = on ? '#ffcb5c' : '#c9a24d'; ctx.beginPath(); ctx.ellipse(x + w - 14, y - 50, fl * 0.7, fl * 1.4, 0, 0, Math.PI * 2); ctx.fill(); const g = ctx.createRadialGradient(x + w - 14, y - 50, 2, x + w - 14, y - 50, 40); g.addColorStop(0, 'rgba(255,200,100,' + (on ? 0.5 : 0.2) + ')'); g.addColorStop(1, 'rgba(255,200,100,0)'); ctx.fillStyle = g; ctx.fillRect(x + w - 54, y - 90, 80, 80); }
    if (queuedNotes[st.s && st.s.id]) { ctx.fillStyle = '#c94a3a'; ctx.beginPath(); ctx.arc(x + 32, y - 40, 5, 0, Math.PI * 2); ctx.fill(); }
  }
  function dnGate(t) {
    const { x, y, w } = gate;
    const dl = daylight();
    const wood = (k) => col([120, 84, 50], dl * k);
    shadow(x + w / 2, y + 4, w + 40, 5, 0.16);
    // log posts and a bone-and-log fence
    for (const px of [x, x + w]) { ctx.fillStyle = wood(1); ctx.beginPath(); ctx.roundRect(px - 5, y - 66, 10, 72, 4); ctx.fill(); ctx.fillStyle = wood(1.25); ctx.fillRect(px - 5, y - 66, 3, 72); }
    for (let fx = x + w + 14; fx < W - 6; fx += 22) { ctx.fillStyle = wood(1); ctx.beginPath(); ctx.roundRect(fx - 3, y - 48, 6, 54, 3); ctx.fill(); }
    ctx.fillStyle = col([235, 228, 210], dl); ctx.fillRect(x + w + 4, y - 40, W - x - w - 4, 4); ctx.fillRect(x + w + 4, y - 18, W - x - w - 4, 4);
    for (let fx = x + w + 14; fx < W - 6; fx += 44) { ctx.fillStyle = col([235, 228, 210], dl); ctx.beginPath(); ctx.ellipse(fx, y - 54, 5, 4, 0, 0, Math.PI * 2); ctx.fill(); }
    const pm = (focused() && focused().permissionMode) || '';
    const openMode = !pm || pm === 'auto' || pm === 'bypassPermissions';
    ctx.save(); ctx.translate(x + 3, y);
    const logs = () => { for (let gx = 6; gx < w - 6; gx += 12) { ctx.fillStyle = wood(1); ctx.beginPath(); ctx.roundRect(gx, -52, 7, 56, 3); ctx.fill(); ctx.fillStyle = wood(1.25); ctx.fillRect(gx, -52, 2, 56); } ctx.fillStyle = col([235, 228, 210], dl); ctx.fillRect(0, -40, w - 6, 4); ctx.fillRect(0, -16, w - 6, 4); };
    if (paused) { logs(); ctx.fillStyle = '#c94a3a'; ctx.beginPath(); ctx.arc((w - 6) / 2, -28, 8, 0, Math.PI * 2); ctx.fill(); }
    else if (!openMode) { logs(); ctx.fillStyle = col([235, 228, 210], dl); ctx.fillRect(w - 18, -30, 12, 4); if (pm === 'plan') { ctx.fillStyle = col([200, 190, 170], dl); ctx.beginPath(); ctx.roundRect((w - 6) / 2 - 24, -34, 48, 14, 3); ctx.fill(); ctx.fillStyle = '#3b2a12'; ctx.font = '600 9px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('planning', (w - 6) / 2, -27); } }
    else { ctx.transform(0.35, -0.18, 0, 1, 0, 0); ctx.globalAlpha = 0.9; logs(); }
    ctx.restore();
    drawGateVisitor(t);
  }
  function dnFire(r, s, t) {
    // a campfire: the wood pile is the context left, the flame shrinks with it
    if (!s) return;
    const dl = daylight();
    const left = s.night ? 0 : Math.max(0, Math.min(1, 1 - contextFraction(s) / compactAt));
    const k = Math.max(0.8, Math.min(1.3, r.scale || 1));
    const bx = r.x - 22 * k, by = r.y + r.h;
    const pw = 30 * k, ph = 44 * k, px = bx - pw / 2, py = by - 4 * k - ph;
    shadow(bx, by + 2, pw + 16, 3, 0.2);
    // a ring of stones
    ctx.fillStyle = col([150, 140, 125], dl); for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; ctx.beginPath(); ctx.ellipse(bx + Math.cos(a) * pw * 0.6, by - 3 * k + Math.sin(a) * 5 * k, 4 * k, 2.6 * k, 0, 0, Math.PI * 2); ctx.fill(); }
    // the max line on a tall stone behind the pile
    ctx.fillStyle = col([120, 112, 100], dl); ctx.beginPath(); ctx.roundRect(px - 6 * k, py, 5 * k, ph, 2); ctx.fill();
    const fillH = (ph - 4) * 0.62, lineY = py + ph - 2 - fillH;
    ctx.strokeStyle = 'rgba(60,50,40,0.8)'; ctx.lineWidth = 1.2 * k; ctx.beginPath(); ctx.moveTo(px - 8 * k, lineY); ctx.lineTo(px + 2 * k, lineY); ctx.stroke();
    ctx.lineWidth = 1; for (const q of [0.75, 0.5, 0.25]) { const ty = py + ph - 2 - fillH * q; ctx.beginPath(); ctx.moveTo(px - 6 * k, ty); ctx.lineTo(px - 2 * k, ty); ctx.stroke(); }
    ctx.fillStyle = 'rgba(60,50,40,0.8)'; ctx.font = (7 * k).toFixed(1) + 'px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('max', px + 3 * k, lineY - 1);
    // the wood pile
    const logsN = Math.ceil(left * 6), logH = fillH / 6;
    for (let i = 0; i < logsN; i++) { const ly = by - 6 * k - (i + 1) * logH; ctx.fillStyle = col(i % 2 ? [122, 84, 51] : [100, 68, 40], dl); ctx.beginPath(); ctx.roundRect(px + (i % 2) * 3 * k, ly, pw - 6 * k, logH + 1, 2); ctx.fill(); }
    const top = by - 6 * k - logsN * logH;
    if (left > 0) {
      const low = left < 0.25, jitter = (low ? 0.7 : 0.2) * Math.sin(t * 23 + r.x);
      const fh = (8 + 22 * left + jitter * 4) * k;
      const gl = ctx.createRadialGradient(bx, top - fh * 0.4, 2, bx, top - fh * 0.4, (40 + 40 * left) * k); gl.addColorStop(0, 'rgba(255,170,70,' + (0.1 + 0.35 * (1 - dl)).toFixed(2) + ')'); gl.addColorStop(1, 'rgba(255,170,70,0)'); ctx.fillStyle = gl; ctx.fillRect(bx - 100, top - 120, 200, 200);
      for (const [c, sc] of [['rgba(255,120,40,0.9)', 1], ['rgba(255,200,80,0.9)', 0.6], ['rgba(255,255,200,0.9)', 0.3]]) { ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(bx - pw * 0.3 * sc, top); ctx.quadraticCurveTo(bx - pw * 0.35 * sc + jitter * 3, top - fh * 0.5 * sc, bx + Math.sin(t * 7) * 2 * sc, top - fh * sc); ctx.quadraticCurveTo(bx + pw * 0.35 * sc + jitter * 3, top - fh * 0.5 * sc, bx + pw * 0.3 * sc, top); ctx.closePath(); ctx.fill(); }
      for (let i = 0; i < 3; i++) { const ph2 = (t * 0.8 + i * 0.33) % 1; ctx.fillStyle = 'rgba(255,180,80,' + (0.8 * (1 - ph2)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(bx + Math.sin(ph2 * 8 + i) * 6 * k, top - fh - ph2 * 30 * k, 1.2 * k, 0, Math.PI * 2); ctx.fill(); }
    } else {
      ctx.fillStyle = 'rgba(120,120,130,0.35)'; for (let i = 0; i < 3; i++) { const ph2 = (t * 0.5 + i * 0.33) % 1; ctx.beginPath(); ctx.arc(bx + Math.sin(ph2 * 6 + i) * 4 * k, top - 4 * k - ph2 * 34 * k, (1.5 + ph2 * 3) * k, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = col([60, 55, 55], dl); ctx.beginPath(); ctx.ellipse(bx, by - 6 * k, pw * 0.4, 3 * k, 0, 0, Math.PI * 2); ctx.fill();
    }
    lanterns[s.id] = { x: bx, y: py + ph / 2, w: pw, h: ph + 12 * k, left, pct: Math.round(100 * contextFraction(s)), night: Boolean(s.night) };
  }
  THEMES.dino = {
    id: 'dino', name: 'Jurassic', hat: 'dino',
    perkNames: { headstart: 'First tools', deeproots: 'Egg memory', longlight: 'Long sun', patientsoil: 'Patient valley', secondwind: 'Second wind', greenkey: 'Cave key' },
    achNames: { clicks1k: 'Quick stick', harvests10: 'Ten nests', clicks100k: 'Elder' }, icon: '🦖', price: 10000000,
    blurb: 'A dinosaur that hatches from an egg and grows up in a nest under a smoking volcano. Food, eggs, water, sunshine, and ferns; spears and stone axes in the shop; pterosaurs, beetles, a cave, a campfire, and helpers with feathers.',
    words: {
      title: '🦖 Jurassic Claude', place: 'valley', sap: 'food', seed: 'egg', seeds: 'eggs', plant: 'dinosaur', plants: 'dinosaurs',
      harvest: 'Nest', harvested: 'nested', nothingToHarvest: 'nothing to nest', sprouted: 'hatched',
      water: 'water', light: 'sunshine', nutrients: 'ferns', sunbeam: 'sunbeam', puddle: 'mud bath', greenhouse: 'cave',
      crowLanded: 'a pterosaur swooped in', crowTitle: 'A pterosaur', birdTitle: 'A passing dragonfly', birdFloat: '🪰 +',
      beeTitle: 'A beetle', beeTip: 'Click it to feed it to the dinosaur for a bonus before it scuttles off.', beeVisit: 'a beetle is crawling near', beeFloat: '🪲 fed +',
      shopTitle: 'Tribe camp', shopTab: 'Camp', prestige: 'Extinction event', season: 'era',
      stages: ['egg', 'cracking', 'hatchling', 'juvenile', 'young', 'adult', 'nesting', 'alpha', 'giant', 'glowing', 'enchanted', 'colossal', 'ancient', 'mythic'],
      mailboxTitle: 'Message stone', mailboxEmpty: 'Carved messages arrive here only when Claude needs an answer from you.', deskTitle: 'Carving stone', gateTitle: 'The log gate', lanternTitle: 'Campfire of', tend: 'click to feed',
      starTitle: 'A falling star', butterflyTitle: 'A giant dragonfly', catTitle: 'A cat', snailTitle: 'A snail', ladybugTitle: 'A beetle',
      lanternOut: 'Burnt out while the context is compacted. It is relit when compaction finishes.', lanternLeft: 'of the firewood left before compaction is due.', lanternLow: 'The fire is dying down. Let auto-compact run or type /compact in the app.',
    },
    items: {
      trowel: { name: 'Stick', icon: '🪵' }, can: { name: 'Stone axe', icon: '🪓' }, shears: { name: 'Spear', icon: '🗡️' }, trellis: { name: 'Hunting net', icon: '🕸️' }, hive: { name: 'Hunting pack', icon: '🐺' }, sprinkler: { name: 'Trap pit', icon: '🕳️' }, orchard: { name: 'Herd', icon: '🦕' },
      puddle: { name: 'Deep mud bath', icon: '🟤', desc: 'Clicks while rain soaks a nest pay double instead of 1.5 times.' },
      birdseed: { name: 'Bug trap', icon: '🪤', desc: 'Catching a passing dragonfly pays three times as much.' },
      hold: { desc: 'Hold the button down on a nest and it keeps clicking for you: 3 a second, then 4, 5, and 7, a touch faster than a fast thumb.' },
      barrel: { name: 'Water hole', icon: '💧', desc: 'Water holds 150 and drains a third slower.' },
      compost: { name: 'Fern patch', icon: '🌿', desc: 'Shell commands give twice the ferns.' },
      feeder: { name: 'Berry bush', icon: '🫐', desc: 'Every tool call feeds water, sunshine, and ferns twice as much.' },
      scarecrow: { name: 'Bone totem', icon: '🦴', desc: 'Pterosaurs from failed tools leave in 20 seconds instead of 60.' },
      greenhouse: { name: 'Cave', icon: '🪨', desc: 'A cave at the back of the valley. Sunshine drains a third slower and pterosaurs can no longer slow the trickle.' },
    },
    species: {
      leafy: { name: 'Raptor', blurb: 'The everyday dinosaur. Quick, feathered, and always hungry.' },
      sunflower: { name: 'Brachiosaurus', blurb: 'A long neck that follows the sun to the tallest ferns.' },
      cactus: { name: 'Ankylosaurus', blurb: 'Armoured, with a club tail. Water drains slowly.' },
      lavender: { name: 'Parasaurolophus', blurb: 'A crested caller whose voice carries across the valley.' },
      rose: { name: 'Stegosaurus', blurb: 'Plated from the start, bright plates from the first stage up.' },
      bonsai: { name: 'Triceratops', blurb: 'A frill and three horns on a stout body.' },
      crystalfern: { name: 'Amber raptor', blurb: 'Glows like amber in the sun. Yields 30% more.' },
      moonbloom: { name: 'Tyrannosaurus', blurb: 'The one with the big head. Opens to the night.' },
    },
    palette: {
      DAY: [[0.00, [120, 70, 90], [255, 170, 110]], [0.12, [110, 160, 190], [220, 225, 190]], [0.60, [100, 150, 180], [215, 220, 180]], [0.80, [130, 110, 140], [255, 190, 120]], [0.92, [80, 40, 70], [240, 110, 70]], [1.00, [30, 20, 50], [120, 60, 70]]],
      NIGHT: [[14, 18, 40], [40, 50, 80]],
    },
    draw: { sky: dnSky, ground: dnGround, planter: dnPlanter, plant: dnDino, greenhouse: dnCave, pests: dnPteros, critters: dnBeetles, upgrades: dnUpgrades, ambient: dnAmbient, mailbox: dnMailbox, desk: dnDesk, gate: dnGate, lantern: dnFire },
  };
})();

// ---------- theme: reef ----------
// The sky is water. A coral head grows into a reef with anemones, fish, and a
// wreck; pearls for sap, shells for seeds, current, light, and plankton.
(function registerReef() {
  const tag = themeShared.tag;
  const rock = (k, dl, a) => col([k, k - 6, k - 16], dl, a);
  const bubbles = Array.from({ length: 26 }, (_, i) => ({ x: (i * 0.137) % 1, sp: 0.02 + (i % 4) * 0.01, r: 1 + (i % 3), ph: i * 1.7 }));
  function rfSky(t) {
    const [top, bottom] = skyColors(t);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgb(top)); g.addColorStop(1, rgb(bottom));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (!connected) return;
    const f = dayFraction(), night = isNight(), dl = daylight();
    // the surface, and the sun or moon wavering through it
    const sx = W * 0.08 + f * W * 0.84;
    if (!night) { const gl = ctx.createRadialGradient(sx, 0, 10, sx, 0, 160); gl.addColorStop(0, 'rgba(255,250,220,0.55)'); gl.addColorStop(1, 'rgba(255,250,220,0)'); ctx.fillStyle = gl; ctx.fillRect(sx - 160, -160, 320, 320); }
    else { ctx.fillStyle = 'rgba(230,235,255,0.5)'; ctx.beginPath(); ctx.ellipse(W * 0.76, 14, 26 + Math.sin(t) * 3, 10, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.25 + 0.2 * dl).toFixed(2) + ')'; ctx.lineWidth = 2; ctx.beginPath();
    for (let x = 0; x <= W; x += 10) ctx.lineTo(x, 8 + Math.sin(x * 0.02 + t * 1.5) * 3 + Math.sin(x * 0.05 - t) * 2);
    ctx.stroke();
    // light shafts by day, drifting slowly
    if (!night) {
      for (let i = 0; i < 6; i++) {
        const x0 = ((i * 0.17 + t * 0.004) % 1.1 - 0.05) * W, lean = 60 + Math.sin(t * 0.3 + i) * 20;
        const sg = ctx.createLinearGradient(0, 0, 0, H * 0.85); sg.addColorStop(0, 'rgba(255,255,230,' + (0.14 * dl).toFixed(2) + ')'); sg.addColorStop(1, 'rgba(255,255,230,0)');
        ctx.fillStyle = sg; ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0 + 40, 0); ctx.lineTo(x0 + 40 + lean, H * 0.85); ctx.lineTo(x0 - 20 + lean, H * 0.85); ctx.closePath(); ctx.fill();
      }
    } else {
      for (const s of stars) { const a = (0.3 + 0.7 * Math.abs(Math.sin(t * 1.5 + s.tw))) * 0.8; ctx.fillStyle = 'rgba(120,230,255,' + a.toFixed(2) + ')'; ctx.beginPath(); ctx.arc(s.x * W, s.y * H + H * 0.1, s.r * 0.8, 0, Math.PI * 2); ctx.fill(); }
    }
    // rising bubbles
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1;
    for (const b of bubbles) { const y = H - ((t * b.sp * 60 + b.ph * 40) % (H + 20)), x = b.x * W + Math.sin(t + b.ph) * 6; ctx.beginPath(); ctx.arc(x, y, b.r, 0, Math.PI * 2); ctx.stroke(); }
    // reads stir up a silt cloud where the garden has rain clouds
    if (weather.rain > 0.15) { ctx.fillStyle = 'rgba(180,200,210,' + (weather.rain * 0.25).toFixed(2) + ')'; for (let i = 0; i < 5; i++) { const cx = ((i + 0.5) / 5) * W + Math.sin(t * 0.3 + i) * 20; ctx.beginPath(); ctx.ellipse(cx, 40 + (i % 2) * 20, W * 0.15, 22, 0, 0, Math.PI * 2); ctx.fill(); } }
  }
  function rfGround(t) {
    const dl = daylight();
    const [, skyBottom] = skyColors(t);
    ctx.fillStyle = col(mix([30, 70, 90], skyBottom, 0.4), dl); ctx.beginPath(); ctx.moveTo(0, soilY);
    for (let x = 0; x <= W; x += 14) ctx.lineTo(x, soilY - 14 - Math.abs(Math.sin(x * 0.012)) * 30 - Math.abs(Math.sin(x * 0.05 + 1)) * 8);
    ctx.lineTo(W, soilY); ctx.closePath(); ctx.fill();
    const g = ctx.createLinearGradient(0, soilY - 8, 0, H);
    g.addColorStop(0, col([214, 196, 150], dl)); g.addColorStop(0.5, col([190, 172, 130], dl)); g.addColorStop(1, col([140, 126, 96], dl));
    ctx.fillStyle = g; ctx.fillRect(0, soilY - 8, W, H - soilY + 8);
    ctx.strokeStyle = col([170, 152, 112], dl, 0.6); ctx.lineWidth = 1.2;
    for (let row = 0; row < 5; row++) { const y = soilY + 14 + row * 18; ctx.beginPath(); for (let x = 0; x <= W; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.04 + row) * 3); ctx.stroke(); }
    // seaweed sways where the grass was
    ctx.lineCap = 'round';
    for (const tf of tufts) {
      const x = tf.x * W, y = soilY + 4 + tf.y * (H - soilY - 8), h = tf.h * 2.6, sway = Math.sin(t * 1.2 + x * 0.03) * 4 * (1 + weather.wind * 2);
      ctx.strokeStyle = col(tf.h > 7 ? [40, 120, 70] : [60, 150, 90], dl); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + sway, y - h * 0.5, x + sway * 1.6, y - h); ctx.stroke();
    }
    for (const pb of pebbles) { const x = pb.x * W, y = soilY + 10 + pb.y * (H - soilY - 20); ctx.fillStyle = col([240, 225, 200], dl); ctx.beginPath(); ctx.ellipse(x, y, pb.r * 2.2, pb.r * 1.5, 0, Math.PI, Math.PI * 2); ctx.fill(); ctx.strokeStyle = col([200, 170, 140], dl); ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x - pb.r * 2, y); ctx.lineTo(x + pb.r * 2, y); ctx.stroke(); }
  }
  function rfPlanter(r, s, plant, isFocus) {
    const { x, w, y, h, cx } = r;
    const dl = daylight();
    shadow(cx, y + h + 3, w * 1.05, w * 0.06);
    ctx.fillStyle = rock(isFocus ? 120 : 108, dl); ctx.beginPath(); ctx.moveTo(x - 6, y + h); ctx.quadraticCurveTo(x - 2, y - 4, x + w * 0.3, y - 2); ctx.quadraticCurveTo(x + w * 0.7, y - 8, x + w + 6, y + h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = rock(88, dl); for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(x + w * (0.2 + i * 0.2), y + h * 0.55 + (i % 2) * 10, 5, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = col([60, 150, 90], dl, 0.7); for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(x + w * (0.25 + i * 0.25), y + 2, 8, 3, 0, 0, Math.PI * 2); ctx.fill(); }
    if (plant) { ctx.fillStyle = 'rgba(40,120,200,' + ((plant.water / waterCap()) * 0.3).toFixed(2) + ')'; ctx.beginPath(); ctx.ellipse(cx, y, w / 2 - 6, 6, 0, 0, Math.PI * 2); ctx.fill(); }
    const rings = Math.min(6, (s && s.compactions) || 0);
    if (rings) { ctx.fillStyle = col([240, 225, 200], dl); for (let i = 0; i < rings; i++) { ctx.beginPath(); ctx.ellipse(x + 10 + i * 9, y + h - 4, 3.5, 2.5, 0, Math.PI, Math.PI * 2); ctx.fill(); } }
    if (s) tag(r, s, 'rgba(10,40,60,0.9)', '#dff8ff', 'rgba(10,40,60,0.85)', '#bfeeff');
  }
  function rfReef(r, sid, t, plant, wilt) {
    if (!plant) return;
    const dl = daylight();
    const sp = speciesOf(plant), si = plantStage(plant), prog = plantProgress(plant);
    const k = Math.max(0.6, r.scale) * (si >= 11 ? 1.3 : 1) * themeRoom(r);
    const cx = r.cx, base = r.y - 4;
    const shape = sp.shape;
    const size = (8 + Math.min(si, 12) * 5 + prog * 4) * k;
    const tint = shape === 'cactus' ? [240, 150, 60] : shape === 'fronds' ? [200, 240, 255] : shape === 'moon' ? [220, 220, 245] : shape === 'stem' ? [250, 170, 60] : shape === 'spikes' ? [170, 90, 180] : shape === 'bonsai' ? [230, 200, 120] : sp.thorns ? [230, 120, 90] : [220, 140, 150];
    const rs = seededRandom(hashStr(sid));
    ctx.save(); ctx.globalAlpha = 1 - wilt * 0.6;
    if (si === 0) { ctx.fillStyle = col(tint, dl); ctx.beginPath(); ctx.arc(cx + Math.sin(t * 2) * 6, base - 10 - Math.abs(Math.sin(t * 3)) * 6, 2.5 * k, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return; }
    // the coral body by species
    const light = col(tint.map((c) => Math.min(255, c + 30)), dl), mid = col(tint, dl), dark = col(tint.map((c) => c * 0.7), dl);
    if (shape === 'branch' && !sp.thorns) {
      // brain coral: a dome with grooves
      ctx.fillStyle = mid; ctx.beginPath(); ctx.arc(cx, base, size, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = dark; ctx.lineWidth = 1.5 * k; for (let i = 0; i < 6 + si; i++) { ctx.beginPath(); const a0 = rs() * Math.PI; ctx.arc(cx + (rs() - 0.5) * size * 0.8, base - rs() * size * 0.5, size * (0.15 + rs() * 0.3), a0, a0 + 2 + rs() * 2); ctx.stroke(); }
    } else if (shape === 'stem' || shape === 'branch') {
      // staghorn and sun coral: branching arms
      const arms = 3 + Math.min(si, 9);
      for (let i = 0; i < arms; i++) {
        const a = -Math.PI / 2 + (i - (arms - 1) / 2) * 0.28 + Math.sin(t * 0.7 + i) * 0.03;
        const len = size * (0.8 + (i % 3) * 0.25);
        ctx.strokeStyle = i % 2 ? mid : light; ctx.lineWidth = (5 - Math.min(3, i % 4)) * k; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx, base); ctx.quadraticCurveTo(cx + Math.cos(a) * len * 0.5 + (i % 2 ? 6 : -6) * k, base + Math.sin(a) * len * 0.5, cx + Math.cos(a) * len, base + Math.sin(a) * len); ctx.stroke();
        if (shape === 'stem') { const f = dayFraction(); const sunX = W * 0.08 + f * W * 0.84; const dir = Math.sign(sunX - cx) || 1; ctx.fillStyle = 'rgba(255,220,120,0.85)'; for (let j = 0; j < 5; j++) { const b = a + (j - 2) * 0.35 + dir * 0.2; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * len + Math.cos(b) * 5 * k, base + Math.sin(a) * len + Math.sin(b) * 5 * k, 1.4 * k, 0, Math.PI * 2); ctx.fill(); } }
      }
    } else if (shape === 'cactus') {
      // fire coral: plates stacked with a glow
      for (let i = 0; i < 3 + Math.min(si, 6); i++) { const py = base - i * size * 0.18, pw = size * (1.1 - i * 0.1); ctx.fillStyle = i % 2 ? mid : light; ctx.beginPath(); ctx.ellipse(cx + Math.sin(i) * 4 * k, py, pw, size * 0.12, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = 'rgba(255,120,40,' + (0.2 + 0.2 * Math.sin(t * 2)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(cx, base - size * 0.4, size * 0.9, 0, Math.PI * 2); ctx.fill();
    } else if (shape === 'spikes') {
      // sea fan
      ctx.strokeStyle = mid; ctx.lineWidth = 1.5 * k;
      for (let i = 0; i < 9; i++) { const a = -Math.PI / 2 + (i - 4) * 0.2, sway = Math.sin(t * 0.8 + i) * 0.04; ctx.beginPath(); ctx.moveTo(cx, base); ctx.quadraticCurveTo(cx + Math.cos(a + sway) * size * 0.7, base + Math.sin(a) * size * 0.7, cx + Math.cos(a + sway * 2) * size * 1.4, base + Math.sin(a) * size * 1.4); ctx.stroke(); }
      ctx.strokeStyle = light; ctx.lineWidth = 0.8 * k; for (let ring = 1; ring <= 3; ring++) { ctx.beginPath(); ctx.arc(cx, base, size * 0.45 * ring, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); }
    } else if (shape === 'bonsai') {
      // table coral
      ctx.fillStyle = dark; ctx.fillRect(cx - 4 * k, base - size * 0.9, 8 * k, size * 0.9);
      ctx.fillStyle = mid; ctx.beginPath(); ctx.ellipse(cx, base - size * 0.9, size * 1.3, size * 0.28, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = light; ctx.beginPath(); ctx.ellipse(cx, base - size * 0.95, size * 1.1, size * 0.18, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      // glass sponge and moon jelly reef: translucent tubes and domes
      for (let i = -2; i <= 2; i++) { const hgt = size * (0.6 + Math.abs(i) * 0.15 + (i % 2 ? 0.3 : 0)); ctx.fillStyle = shape === 'moon' ? 'rgba(220,220,250,0.55)' : 'rgba(180,240,255,0.5)'; ctx.beginPath(); if (shape === 'moon') ctx.arc(cx + i * size * 0.45, base - hgt * 0.5, size * 0.3, Math.PI, 0); else ctx.roundRect(cx + i * size * 0.45 - size * 0.12, base - hgt, size * 0.24, hgt, [size * 0.12, size * 0.12, 0, 0]); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1; ctx.stroke(); }
      const gl = ctx.createRadialGradient(cx, base - size * 0.5, 2, cx, base - size * 0.5, size * 1.6); gl.addColorStop(0, 'rgba(150,240,255,' + (0.25 + 0.1 * Math.sin(t * 2)).toFixed(2) + ')'); gl.addColorStop(1, 'rgba(150,240,255,0)'); ctx.fillStyle = gl; ctx.fillRect(cx - size * 1.6, base - size * 2.2, size * 3.2, size * 3.2);
    }
    // anemones from five: swaying tentacles at the foot
    if (si >= 5) { for (let a2 = 0; a2 < 2; a2++) { const ax = cx + (a2 ? 1 : -1) * size * 0.9; ctx.strokeStyle = a2 ? 'rgba(255,120,180,0.9)' : 'rgba(120,255,200,0.9)'; ctx.lineWidth = 2 * k; ctx.lineCap = 'round'; for (let i = 0; i < 7; i++) { const b = -Math.PI / 2 + (i - 3) * 0.3 + Math.sin(t * 2 + i + a2) * 0.15; ctx.beginPath(); ctx.moveTo(ax, base); ctx.lineTo(ax + Math.cos(b) * 12 * k, base + Math.sin(b) * 12 * k); ctx.stroke(); } } }
    // fish from six, shoals from seven
    if (si >= 6) { const n = si >= 7 ? 3 + Math.min(6, si - 6) : 2; for (let i = 0; i < n; i++) { const a = t * (0.6 + i * 0.1) + i * 1.3, fx = cx + Math.cos(a) * (size + 18 * k), fy = base - size * 0.6 + Math.sin(a * 1.3) * size * 0.4, dir = Math.sign(-Math.sin(a)) || 1; ctx.fillStyle = 'hsl(' + ((i * 47 + 20) % 360) + ',80%,60%)'; ctx.beginPath(); ctx.ellipse(fx, fy, 5 * k, 2.5 * k, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(fx - dir * 5 * k, fy); ctx.lineTo(fx - dir * 9 * k, fy - 3 * k); ctx.lineTo(fx - dir * 9 * k, fy + 3 * k); ctx.closePath(); ctx.fill(); } }
    // a wreck leans on the reef from eight
    if (si >= 8) { ctx.save(); ctx.translate(cx + size * 1.1, base); ctx.rotate(-0.35); ctx.fillStyle = col([90, 60, 40], dl); ctx.beginPath(); ctx.moveTo(-size * 0.5, 0); ctx.lineTo(size * 0.6, 0); ctx.lineTo(size * 0.45, -size * 0.5); ctx.lineTo(-size * 0.4, -size * 0.5); ctx.closePath(); ctx.fill(); ctx.fillStyle = col([70, 45, 30], dl); ctx.fillRect(-2 * k, -size * 1.2, 4 * k, size * 0.7); ctx.fillStyle = 'rgba(255,220,120,' + (0.4 + 0.3 * Math.sin(t * 2)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(size * 0.1, -size * 0.25, 3 * k, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    if (si >= 9) { const gl = ctx.createRadialGradient(cx, base - size * 0.4, size * 0.5, cx, base - size * 0.4, size * 2.2); gl.addColorStop(0, 'rgba(120,255,230,' + (si >= 10 ? 0.22 : 0.14) + ')'); gl.addColorStop(1, 'rgba(120,255,230,0)'); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(cx, base - size * 0.4, size * 2.2, 0, Math.PI * 2); ctx.fill(); }
    if (si >= 10) { for (let i = 0; i < 8; i++) { ctx.fillStyle = 'hsla(' + ((t * 30 + i * 45) % 360) + ',85%,70%,0.85)'; ctx.beginPath(); ctx.arc(cx + Math.cos(i * 0.8 + t * 0.2) * size * 0.9, base - Math.abs(Math.sin(i * 1.1)) * size * 0.9, 2.2 * k, 0, Math.PI * 2); ctx.fill(); } }
    if (si >= 12) { ctx.fillStyle = col([240, 230, 210], dl); for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(cx + (rs() - 0.5) * size * 1.6, base - rs() * size * 0.5, 2 * k, 0, Math.PI * 2); ctx.fill(); } }
    if (si >= 13) { for (let i = 0; i < 3; i++) { const a = t * 0.3 + i * 2.1; ctx.strokeStyle = 'hsla(' + ((t * 40 + i * 120) % 360) + ',90%,80%,0.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, base - size); ctx.lineTo(cx + Math.cos(a) * W * 0.4, base - size - Math.abs(Math.sin(a)) * H * 0.5 - 40); ctx.stroke(); } }
    ctx.restore();
  }
  function rfWreck(t) {
    if (!has('greenhouse')) return;
    const dl = daylight();
    const w = Math.max(96, Math.min(150, W * 0.11));
    const x = W * 0.27, y = soilY - 2;
    shadow(x, y + 3, w * 1.05, 5, 0.15);
    ctx.save(); ctx.translate(x, y); ctx.rotate(0.12);
    ctx.fillStyle = col([96, 66, 44], dl); ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.lineTo(w * 0.42, -w * 0.3); ctx.lineTo(-w * 0.45, -w * 0.28); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = col([70, 48, 32], dl); ctx.lineWidth = 1; for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-w * 0.44, -w * 0.07 * i); ctx.lineTo(w * 0.44, -w * 0.07 * i); ctx.stroke(); }
    ctx.fillStyle = col([80, 54, 36], dl); ctx.fillRect(-3, -w * 0.75, 6, w * 0.5);
    ctx.fillStyle = 'rgba(255,220,120,' + (0.3 + 0.3 * Math.sin(t * 1.5)).toFixed(2) + ')'; for (const px of [-w * 0.2, w * 0.15]) { ctx.beginPath(); ctx.arc(px, -w * 0.15, 4, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  function rfEels(t) {
    for (const p of pests) {
      const pos = pestPos(p); if (!pos) continue;
      const x = pos.x, y = pos.y + 8;
      ctx.strokeStyle = '#4a7a3a'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x - 22, y + 6); for (let i = 0; i < 5; i++) ctx.lineTo(x - 22 + i * 6, y + Math.sin(t * 5 + i) * 3); ctx.stroke();
      ctx.fillStyle = '#5a8a48'; ctx.beginPath(); ctx.ellipse(x + 4, y, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x + 6, y + 1); ctx.lineTo(x + 12, y - 1 + Math.sin(t * 6) * 2); ctx.lineTo(x + 12, y + 3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffd45c'; ctx.beginPath(); ctx.arc(x + 2, y - 2, 1.4, 0, Math.PI * 2); ctx.fill();
    }
  }
  function rfShrimp(t) {
    for (const c of critters) {
      const fade = Math.min(1, c.age * 3, (c.life - c.age) * 2);
      ctx.save(); ctx.globalAlpha = fade; ctx.translate(c.x, c.y); ctx.rotate(Math.sin(c.age * 3) * 0.3);
      ctx.strokeStyle = '#ff6a5a'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-6, 2); ctx.quadraticCurveTo(0, -5, 7, 0); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 3, -2); ctx.lineTo(i * 3, 2); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(14, -5 + Math.sin(t * 8) * 2); ctx.moveTo(7, 0); ctx.lineTo(14, 3); ctx.stroke();
      ctx.restore();
    }
  }
  function rfUpgrades(t) {
    const dl = daylight();
    if (has('barrel')) { const x = mailbox.x + mailbox.w + 22, y = soilY; ctx.fillStyle = rock(100, dl); ctx.beginPath(); ctx.ellipse(x + 14, y + 4, 24, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(80,180,220,0.8)'; ctx.beginPath(); ctx.ellipse(x + 14, y + 4, 18, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#ff8fa3'; ctx.beginPath(); ctx.arc(x + 8, y + 4, 2, 0, Math.PI * 2); ctx.fill(); }
    const room = gate.x - 8;
    if (has('compost')) { const x = room - (has('scarecrow') ? 56 : 0) - 28, y = soilY; ctx.strokeStyle = col([50, 120, 70], dl); ctx.lineWidth = 3; ctx.lineCap = 'round'; for (let i = -1; i <= 1; i++) { const sway = Math.sin(t * 1.1 + i) * 8; ctx.beginPath(); ctx.moveTo(x + i * 10, y); ctx.quadraticCurveTo(x + i * 10 + sway, y - 30, x + i * 10 + sway * 1.8, y - 60 + Math.abs(i) * 10); ctx.stroke(); } }
    if (has('scarecrow')) { const x = room - 28, y = soilY - 2; shadow(x, y + 6, 30, 4, 0.2); ctx.strokeStyle = col([120, 100, 70], dl); ctx.lineWidth = 1.5; ctx.strokeRect(x - 12, y - 30, 24, 28); for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x - 12 + i * 6, y - 30); ctx.lineTo(x - 12 + i * 6, y - 2); ctx.stroke(); } ctx.fillStyle = col([120, 100, 70], dl); ctx.fillRect(x - 14, y - 32, 28, 3); }
    if (has('feeder')) { const x = Math.min(W - 30, gate.x + gate.w + 40), y = soilY; ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; for (let i = 0; i < 8; i++) { const ph = (t * 0.4 + i * 0.125) % 1; ctx.beginPath(); ctx.arc(x + Math.sin(ph * 6 + i) * 8, y - ph * 90, 1.5 + ph * 2.5, 0, Math.PI * 2); ctx.stroke(); } }
  }
  function rfAmbient(a, layer, t, fade) {
    const dl = daylight();
    if (layer === 'back') {
      if (a.kind === 'cloud') { ctx.fillStyle = 'rgba(200,230,230,' + (0.1 * fade).toFixed(2) + ')'; ctx.beginPath(); ctx.ellipse(a.x, a.y, a.w * 0.5, a.w * 0.12, 0, 0, Math.PI * 2); ctx.fill(); return true; }
      if (a.kind === 'rainbow') { ctx.save(); ctx.globalAlpha = 0.5 * fade * dl; for (let i = 0; i < 12; i++) { const x = ((i * 0.083 + t * 0.01) % 1) * W; ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); for (let y = 0; y < H * 0.8; y += 20) ctx.lineTo(x + Math.sin(y * 0.03 + t + i) * 14, y); ctx.stroke(); } ctx.restore(); return true; }
      if (a.kind === 'flock') { for (let k = 0; k < a.n * 2; k++) { const bx = a.x + (k % a.n) * 12 - Math.floor(k / a.n) * 6, by = a.y + Math.floor(k / a.n) * 9 + Math.sin(t * 4 + k) * 2; ctx.fillStyle = 'rgba(200,220,230,' + (0.8 * fade).toFixed(2) + ')'; ctx.beginPath(); ctx.ellipse(bx, by, 5, 2.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(bx + 5, by); ctx.lineTo(bx + 8, by - 2.5); ctx.lineTo(bx + 8, by + 2.5); ctx.closePath(); ctx.fill(); } return true; }
      if (a.kind === 'balloon') { ctx.save(); ctx.translate(a.x, a.y); ctx.scale(a.vx > 0 ? -1 : 1, 1); ctx.globalAlpha = fade * (0.5 + 0.5 * dl); ctx.fillStyle = col([70, 90, 120], dl); ctx.beginPath(); ctx.ellipse(0, 0, 70, 22, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(60, 0); ctx.lineTo(90, -16 + Math.sin(t) * 4); ctx.lineTo(90, 14); ctx.closePath(); ctx.fill(); ctx.fillStyle = col([200, 210, 225], dl); ctx.beginPath(); ctx.ellipse(-10, 12, 50, 8, 0, 0, Math.PI); ctx.fill(); ctx.fillStyle = '#1c1c24'; ctx.beginPath(); ctx.arc(-50, -6, 2, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(-30, -24 - ((t * 20) % 30), 3, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); return true; }
      if (a.kind === 'plane') { const dir = a.vx > 0 ? 1 : -1; ctx.save(); ctx.translate(a.x, a.y + 40); ctx.scale(dir, 1); ctx.globalAlpha = fade; ctx.fillStyle = col([220, 190, 60], dl); ctx.beginPath(); ctx.ellipse(0, 0, 22, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(-4, -14, 8, 8); ctx.fillStyle = 'rgba(160,230,255,0.9)'; ctx.beginPath(); ctx.arc(6, -1, 3, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = col([180, 150, 40], dl); ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(-30, -6); ctx.lineTo(-30, 6); ctx.closePath(); ctx.fill(); ctx.restore(); return true; }
      return false;
    }
    if (a.kind === 'kite') { ctx.save(); ctx.globalAlpha = fade; ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.ax, a.ay); ctx.quadraticCurveTo((a.ax + a.x) / 2 - 20, (a.ay + a.y) / 2 + 30, a.x, a.y); ctx.stroke(); ctx.translate(a.x, a.y); ctx.fillStyle = 'rgba(255,170,220,0.6)'; ctx.beginPath(); ctx.arc(0, 0, 12, Math.PI, 0); ctx.fill(); ctx.strokeStyle = 'rgba(255,170,220,0.7)'; ctx.lineWidth = 1.5; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 4, 0); ctx.quadraticCurveTo(i * 4 + Math.sin(t * 3 + i) * 5, 12, i * 5, 24); ctx.stroke(); } ctx.restore(); return true; }
    if (a.kind === 'butterfly') { ctx.save(); ctx.translate(a.x, a.y); ctx.globalAlpha = fade; const pulse = 1 + Math.sin(t * 3 + a.phase) * 0.15; ctx.fillStyle = 'hsla(' + a.hue + ',80%,80%,0.55)'; ctx.beginPath(); ctx.arc(0, 0, 8 * pulse, Math.PI, 0); ctx.fill(); ctx.strokeStyle = 'hsla(' + a.hue + ',80%,80%,0.7)'; ctx.lineWidth = 1; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 4, 0); ctx.quadraticCurveTo(i * 4 + Math.sin(t * 4 + i) * 3, 8, i * 5, 16); ctx.stroke(); } ctx.restore(); return true; }
    if (a.kind === 'ladybug') { const p = ambientPos(a); ctx.save(); ctx.translate(p.x, p.y); ctx.globalAlpha = fade; ctx.scale(a.dir, 1); ctx.fillStyle = '#e0603a'; ctx.beginPath(); ctx.ellipse(0, 0, 6, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#e0603a'; ctx.lineWidth = 1.5; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 3, 2); ctx.lineTo(i * 4, 6); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(6, -1); ctx.lineTo(10, -5 + Math.sin(t * 6) * 2); ctx.moveTo(6, 1); ctx.lineTo(10, 4); ctx.stroke(); ctx.fillStyle = '#1c1c24'; ctx.beginPath(); ctx.arc(3, -3, 1, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return true; }
    if (a.kind === 'rabbit') { ctx.save(); ctx.translate(a.x, a.y); ctx.globalAlpha = fade; ctx.scale(a.vx > 0 ? 1 : -1, 1); ctx.fillStyle = col([200, 120, 150], dl); ctx.beginPath(); ctx.arc(-4, -8, 8, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = col([220, 100, 60], dl); ctx.lineWidth = 2; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(4 + i * 2, -3); ctx.lineTo(8 + i * 3, 2 + Math.sin(a.age * 10 + i) * 1.5); ctx.stroke(); } ctx.fillStyle = col([220, 100, 60], dl); ctx.beginPath(); ctx.arc(8, -6, 3, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return true; }
    if (a.kind === 'seed') { ctx.strokeStyle = 'rgba(255,255,255,' + (0.6 * fade).toFixed(2) + ')'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(a.x, a.y - a.age * 10, 2, 0, Math.PI * 2); ctx.stroke(); return true; }
    return false;
  }
  function rfMailbox(t) {
    const { x, y, w, h, postH } = mailbox;
    const dl = daylight();
    const flagUp = unread > 0;
    shadow(x + w / 2, y + postH + 2, w * 1.3, 4, 0.2);
    ctx.strokeStyle = col([120, 100, 70], dl); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + w / 2, y - h + 4); ctx.lineTo(x + w / 2, -10); ctx.stroke();
    const by = y + postH - 30 + Math.sin(t * 0.8) * 3;
    ctx.fillStyle = col([200, 160, 80], dl); ctx.beginPath(); ctx.arc(x + w / 2, by, w * 0.55, Math.PI, 0); ctx.lineTo(x + w / 2 + w * 0.55, by + 16); ctx.lineTo(x + w / 2 - w * 0.55, by + 16); ctx.closePath(); ctx.fill();
    ctx.fillStyle = col([150, 110, 50], dl); ctx.fillRect(x + w / 2 - w * 0.55, by + 14, w * 1.1, 4);
    ctx.fillStyle = flagUp ? 'rgba(255,230,150,0.95)' : 'rgba(160,220,240,0.8)'; ctx.beginPath(); ctx.arc(x + w / 2, by - 2, 7, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = col([120, 90, 40], dl); ctx.lineWidth = 1.5; ctx.stroke();
    if (flagUp) { const pulse = 0.5 + 0.5 * Math.sin(t * 3); ctx.fillStyle = 'rgba(255,220,120,' + (0.25 + 0.35 * pulse).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(x + w / 2, by, w * 0.9, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(120,220,180,0.9)'; ctx.beginPath(); ctx.roundRect(x + w / 2 - 4, by - 34 + Math.sin(t * 2) * 3, 8, 16, 3); ctx.fill(); }
    if (unread > 0) { ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#c94a3a'; ctx.beginPath(); ctx.arc(x + w / 2 + 14, by - 22, 9, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(String(unread), x + w / 2 + 14, by - 22); }
  }
  function rfDesk(t) {
    const st = deskState();
    const on = st.mode === 'ready', queue = st.mode === 'queue' || st.mode === 'later';
    const { x, y, w } = desk;
    const dl = daylight();
    ctx.fillStyle = col([100, 70, 45], dl); ctx.fillRect(x + w / 2 - 4, y - 22, 8, 22);
    ctx.save(); ctx.translate(x + w / 2, y - 34); ctx.rotate(on ? Math.sin(t * 0.7) * 0.2 : 0);
    ctx.strokeStyle = col([140, 100, 60], dl); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 6, Math.sin(a) * 6); ctx.lineTo(Math.cos(a) * 20, Math.sin(a) * 20); ctx.stroke(); }
    ctx.fillStyle = col([160, 120, 70], dl); ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = on ? '#fffdf2' : queue ? '#e6dfcf' : '#a9a29a'; ctx.beginPath(); ctx.roundRect(x + 2, y - 12, 18, 12, 2); ctx.fill();
    ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 5, y - 6); ctx.lineTo(x + 10, y - 9); ctx.lineTo(x + 16, y - 4); ctx.stroke();
    ctx.fillStyle = on ? '#ffcb5c' : queue ? '#c9a24d' : '#6f6a63'; ctx.beginPath(); ctx.arc(x + w - 8, y - 46, 5, 0, Math.PI * 2); ctx.fill();
    if (on || queue) { const g = ctx.createRadialGradient(x + w - 8, y - 46, 2, x + w - 8, y - 46, 40); g.addColorStop(0, 'rgba(255,230,140,' + (on ? 0.45 : 0.2) + ')'); g.addColorStop(1, 'rgba(255,230,140,0)'); ctx.fillStyle = g; ctx.fillRect(x + w - 48, y - 86, 80, 80); }
    if (queuedNotes[st.s && st.s.id]) { ctx.fillStyle = '#c94a3a'; ctx.beginPath(); ctx.arc(x + 32, y - 44, 5, 0, Math.PI * 2); ctx.fill(); }
  }
  function rfGate(t) {
    const { x, y, w } = gate;
    const dl = daylight();
    shadow(x + w / 2, y + 4, w + 40, 5, 0.16);
    for (const px of [x, x + w]) { ctx.fillStyle = col([110, 80, 55], dl); ctx.beginPath(); ctx.roundRect(px - 5, y - 64, 10, 70, 4); ctx.fill(); ctx.fillStyle = col([240, 225, 200], dl); ctx.beginPath(); ctx.arc(px, y - 66, 5, 0, Math.PI * 2); ctx.fill(); }
    // a kelp wall to the edge
    ctx.lineCap = 'round';
    for (let fx = x + w + 10; fx < W - 4; fx += 12) { const sway = Math.sin(t * 1.1 + fx * 0.05) * 6; ctx.strokeStyle = col(fx % 24 ? [40, 120, 70] : [60, 150, 90], dl); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(fx, y + 2); ctx.quadraticCurveTo(fx + sway, y - 28, fx + sway * 1.8, y - 56); ctx.stroke(); }
    const pm = (focused() && focused().permissionMode) || '';
    const openMode = !pm || pm === 'auto' || pm === 'bypassPermissions';
    ctx.save(); ctx.translate(x + 3, y);
    const strands = () => { for (let gx = 6; gx < w - 6; gx += 10) { const sway = Math.sin(t * 1.3 + gx) * 4; ctx.strokeStyle = col([60, 150, 90], dl); ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(gx, 2); ctx.quadraticCurveTo(gx + sway, -26, gx + sway * 1.5, -52); ctx.stroke(); } ctx.strokeStyle = col([120, 90, 60], dl); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(w - 6, -40); ctx.moveTo(0, -16); ctx.lineTo(w - 6, -16); ctx.stroke(); };
    if (paused) { strands(); ctx.fillStyle = '#c94a3a'; ctx.beginPath(); ctx.arc((w - 6) / 2, -28, 8, 0, Math.PI * 2); ctx.fill(); }
    else if (!openMode) { strands(); if (pm === 'plan') { ctx.fillStyle = col([240, 225, 200], dl); ctx.beginPath(); ctx.roundRect((w - 6) / 2 - 24, -34, 48, 14, 3); ctx.fill(); ctx.fillStyle = '#3b2a12'; ctx.font = '600 9px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('planning', (w - 6) / 2, -27); } }
    else { ctx.globalAlpha = 0.35; strands(); }
    ctx.restore();
    drawGateVisitor(t);
  }
  function rfTank(r, s, t) {
    if (!s) return;
    const dl = daylight();
    const left = s.night ? 0 : Math.max(0, Math.min(1, 1 - contextFraction(s) / compactAt));
    const k = Math.max(0.8, Math.min(1.3, r.scale || 1));
    const bx = r.x - 20 * k, by = r.y + r.h;
    const gw = 22 * k, gh = 46 * k, gx = bx - gw / 2, gy = by - 4 * k - gh;
    shadow(bx + 4, by + 2, gw + 14, 3, 0.2);
    ctx.fillStyle = col([220, 200, 60], dl); ctx.beginPath(); ctx.roundRect(gx, gy, gw, gh, [gw / 2, gw / 2, 5, 5]); ctx.fill();
    ctx.fillStyle = col([180, 160, 40], dl); ctx.fillRect(gx, gy + gh * 0.55, gw, 3 * k);
    ctx.fillStyle = 'rgba(20,20,30,0.85)'; ctx.beginPath(); ctx.roundRect(gx + 4 * k, gy + 8 * k, gw - 8 * k, gh - 16 * k, 3); ctx.fill();
    const fillH = (gh - 16 * k - 4) * 0.9, lvl = fillH * left, ly = gy + gh - 8 * k - 2 - lvl;
    ctx.fillStyle = 'hsla(' + (200 - 160 * (1 - left)) + ',90%,60%,0.95)'; ctx.fillRect(gx + 6 * k, ly, gw - 12 * k, lvl);
    const lineY = gy + gh - 8 * k - 2 - fillH;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.2 * k; ctx.beginPath(); ctx.moveTo(gx + 5 * k, lineY); ctx.lineTo(gx + gw - 5 * k, lineY); ctx.stroke();
    ctx.lineWidth = 1; for (const q of [0.75, 0.5, 0.25]) { const ty = gy + gh - 8 * k - 2 - fillH * q; ctx.beginPath(); ctx.moveTo(gx + 5 * k, ty); ctx.lineTo(gx + 8 * k, ty); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = (6.5 * k).toFixed(1) + 'px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText('max', gx + gw - 5 * k, lineY - 1);
    ctx.fillStyle = col([120, 120, 130], dl); ctx.fillRect(bx - 3 * k, gy - 8 * k, 6 * k, 8 * k); ctx.fillRect(bx - 8 * k, gy - 10 * k, 16 * k, 3 * k);
    if (left > 0) { for (let i = 0; i < 3; i++) { const ph = (t * 0.6 + i * 0.33) % 1; ctx.strokeStyle = 'rgba(255,255,255,' + (0.6 * (1 - ph)).toFixed(2) + ')'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(bx + Math.sin(ph * 6 + i) * 5 * k, gy - 12 * k - ph * 30 * k, (1.5 + ph * 2) * k, 0, Math.PI * 2); ctx.stroke(); } }
    lanterns[s.id] = { x: bx, y: gy + gh / 2, w: gw, h: gh + 12 * k, left, pct: Math.round(100 * contextFraction(s)), night: Boolean(s.night) };
  }
  THEMES.reef = {
    id: 'reef', name: 'Deep reef', hat: 'reef',
    perkNames: { headstart: 'Diver kit', deeproots: 'Shell memory', longlight: 'Long shaft', patientsoil: 'Patient current', secondwind: 'Second breath', greenkey: 'Wreck key' },
    achNames: { clicks1k: 'Sure net', harvests10: 'Ten dives', clicks100k: 'Old salt' }, icon: '🐚', price: 10000000, firefly: 'rgba(120,240,255,',
    blurb: 'The sky is water. A coral head grows into a reef with anemones, fish, shoals, and a wreck leaning on it. Pearls, shells, current, light, and plankton; nets and harpoons in the shop; moray eels, cleaner shrimp, a shipwreck, a diving bell, and divers.',
    words: {
      title: '🐚 Reef of Claude', place: 'reef', sap: 'pearls', seed: 'shell', seeds: 'shells', plant: 'reef', plants: 'reefs',
      harvest: 'Dive', harvested: 'dived', nothingToHarvest: 'nothing to dive for', sprouted: 'settled',
      water: 'current', light: 'light', nutrients: 'plankton', sunbeam: 'light shaft', puddle: 'plankton bloom', greenhouse: 'wreck',
      crowLanded: 'a moray eel slid in', crowTitle: 'A moray eel', birdTitle: 'A passing turtle', birdFloat: '🐢 +',
      beeTitle: 'A cleaner shrimp', beeTip: 'Click it to let it clean the reef for a bonus before it darts off.', beeVisit: 'a cleaner shrimp is visiting', beeFloat: '🦐 cleaned +',
      shopTitle: 'Tide pool market', shopTab: 'Seabed', prestige: 'New tide', season: 'tide',
      stages: ['larva', 'polyp', 'coral bud', 'coral head', 'colony', 'anemones', 'fish', 'shoals', 'wreck', 'glowing', 'enchanted', 'colossal', 'ancient', 'mythic'],
      mailboxTitle: 'Diving bell', mailboxEmpty: 'Bottles arrive here only when Claude needs an answer from you.', deskTitle: "Ship's wheel", gateTitle: 'The kelp gate', lanternTitle: 'Air tank of', tend: 'click to gather pearls',
      starTitle: 'A shooting star', butterflyTitle: 'A jellyfish', catTitle: 'A cat', snailTitle: 'A sea snail', ladybugTitle: 'A crab',
      lanternOut: 'Empty while the context is compacted. It is refilled when compaction finishes.', lanternLeft: 'of the air left before compaction is due.', lanternLow: 'The air is running low. Let auto-compact run or type /compact in the app.',
    },
    items: {
      trowel: { name: 'Net', icon: '🥅' }, can: { name: 'Harpoon', icon: '🔱' }, shears: { name: 'Diving suit', icon: '🤿' }, trellis: { name: 'Trawler', icon: '🚤' }, hive: { name: 'Pearl farm', icon: '🦪' }, sprinkler: { name: 'Dredger', icon: '⚓' }, orchard: { name: 'Pearl fleet', icon: '⛵' },
      longbeam: { name: 'Long light shaft', desc: 'The light shaft after Claude writes a file lasts 12, then 16 seconds instead of 8.' },
      brightbeam: { name: 'Bright light shaft', icon: '🔆', desc: 'Clicks inside a light shaft pay four times instead of three.' },
      puddle: { name: 'Thick bloom', icon: '🦠', desc: 'Clicks during a plankton bloom on a reef pay double instead of 1.5 times.' },
      birdseed: { name: 'Turtle net', icon: '🪢', desc: 'Catching a passing turtle pays three times as much.' },
      hold: { desc: 'Hold the button down on a reef and it keeps clicking for you: 3 a second, then 4, 5, and 7, a touch faster than a fast thumb.' },
      barrel: { name: 'Tide pool', icon: '🌊', desc: 'Current holds 150 and drains a third slower.' },
      compost: { name: 'Kelp bed', icon: '🌿', desc: 'Shell commands give twice the plankton.' },
      feeder: { name: 'Upwelling', icon: '🌀', desc: 'Every tool call feeds current, light, and plankton twice as much.' },
      scarecrow: { name: 'Eel trap', icon: '🪤', desc: 'Moray eels from failed tools leave in 20 seconds instead of 60.' },
      greenhouse: { name: 'Shipwreck', icon: '🚢', desc: 'A wreck at the back of the reef. Light drains a third slower and eels can no longer slow the trickle.' },
    },
    species: {
      leafy: { name: 'Brain coral', blurb: 'The everyday reef. A grooved dome that fills with life.' },
      sunflower: { name: 'Sun coral', blurb: 'Orange arms whose polyps open toward the light.' },
      cactus: { name: 'Fire coral', blurb: 'Stacked plates with a warm glow. Current drains slowly.' },
      lavender: { name: 'Sea fan', blurb: 'A purple fan that thickens as it grows.' },
      rose: { name: 'Staghorn', blurb: 'Branching from the start, sharp from the first stage up.' },
      bonsai: { name: 'Table coral', blurb: 'A flat crown on a stalk, shade for everything under it.' },
      crystalfern: { name: 'Glass sponge', blurb: 'Translucent glowing tubes. Yields 30% more.' },
      moonbloom: { name: 'Moon jelly reef', blurb: 'Silver domes that open to the night.' },
    },
    palette: {
      DAY: [[0.00, [10, 50, 90], [40, 130, 150]], [0.12, [20, 90, 140], [70, 180, 190]], [0.60, [20, 100, 150], [80, 190, 200]], [0.80, [15, 70, 120], [60, 150, 170]], [0.92, [10, 40, 90], [40, 100, 140]], [1.00, [6, 24, 60], [24, 70, 110]]],
      NIGHT: [[4, 14, 40], [10, 40, 80]],
    },
    draw: { sky: rfSky, ground: rfGround, planter: rfPlanter, plant: rfReef, greenhouse: rfWreck, pests: rfEels, critters: rfShrimp, upgrades: rfUpgrades, ambient: rfAmbient, mailbox: rfMailbox, desk: rfDesk, gate: rfGate, lantern: rfTank },
  };
})();

// ---------- theme: clockwork ----------
// A brass machine assembles itself on a factory floor: cogs for sap, springs
// for seeds, steam, oil, and coal for the meters, rust sprites for crows,
// sparks for bees, and a pressure gauge where the lantern was.
(function registerClockwork() {
  const tag = themeShared.tag;
  const brass = (k, dl, a) => col([k, k * 0.78, k * 0.35], dl, a);
  const iron = (k, dl, a) => col([k, k, k + 6], dl, a);
  function gear(x, y, r, teeth, ang, fill, dl) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = fill; ctx.beginPath();
    for (let i = 0; i < teeth; i++) { const a0 = (i / teeth) * Math.PI * 2, a1 = ((i + 0.5) / teeth) * Math.PI * 2; ctx.lineTo(Math.cos(a0) * r, Math.sin(a0) * r); ctx.lineTo(Math.cos(a0 + 0.1) * r * 1.22, Math.sin(a0 + 0.1) * r * 1.22); ctx.lineTo(Math.cos(a1 - 0.1) * r * 1.22, Math.sin(a1 - 0.1) * r * 1.22); ctx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function ckSky(t) {
    const [top, bottom] = skyColors(t);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgb(top)); g.addColorStop(1, rgb(bottom));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (!connected) return;
    const f = dayFraction(), night = isNight(), dl = daylight();
    if (night) {
      for (const s of stars) { const a = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.8 + s.tw)); ctx.fillStyle = 'rgba(255,240,200,' + (a * (1 - weather.cloud)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2); ctx.fill(); }
      // a clock-face moon
      const mx = W * 0.78, my = H * 0.18, r = 26;
      ctx.fillStyle = 'rgba(240,228,200,0.95)'; ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(90,70,40,0.8)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(mx, my, r - 3, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; ctx.beginPath(); ctx.moveTo(mx + Math.cos(a) * (r - 6), my + Math.sin(a) * (r - 6)); ctx.lineTo(mx + Math.cos(a) * (r - 3), my + Math.sin(a) * (r - 3)); ctx.stroke(); }
      const d = new Date(), hA = (d.getHours() % 12 + d.getMinutes() / 60) * Math.PI / 6 - Math.PI / 2, mA = d.getMinutes() * Math.PI / 30 - Math.PI / 2;
      ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + Math.cos(hA) * r * 0.5, my + Math.sin(hA) * r * 0.5); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + Math.cos(mA) * r * 0.75, my + Math.sin(mA) * r * 0.75); ctx.stroke();
    } else {
      // a brass sun with gear teeth
      const sx = W * 0.08 + f * W * 0.84, sy = H * 0.62 - Math.sin(f * Math.PI) * H * 0.5;
      const warmth = Math.max(0, 1 - Math.sin(f * Math.PI) * 1.4), r = 22 + weather.sun * 14 + warmth * 8;
      const core = mix([255, 220, 140], [255, 140, 70], warmth);
      const glow = ctx.createRadialGradient(sx, sy, r * 0.4, sx, sy, r * 4); glow.addColorStop(0, rgb(core, 0.4 + weather.sun * 0.3)); glow.addColorStop(1, rgb(core, 0)); ctx.fillStyle = glow; ctx.fillRect(sx - r * 4, sy - r * 4, r * 8, r * 8);
      gear(sx, sy, r, 14, t * 0.2, rgb(core, 0.95), dl);
    }
    // smokestacks on the horizon, always at it
    for (let i = 0; i < 4; i++) { const x = W * (0.12 + i * 0.22), h = 50 + (i % 2) * 30; ctx.fillStyle = col([70, 60, 60], dl * 0.8, 0.8); ctx.fillRect(x - 6, soilY - 40 - h, 12, h + 40); ctx.fillStyle = 'rgba(120,110,115,0.35)'; for (let k = 0; k < 4; k++) { const ph = (t * 0.12 + k * 0.25 + i * 0.1) % 1; ctx.beginPath(); ctx.arc(x + ph * 50 + Math.sin(ph * 5 + k) * 6, soilY - 44 - h - ph * 70, 5 + ph * 14, 0, Math.PI * 2); ctx.fill(); } }
    if (weather.rain > 0.15) { ctx.fillStyle = 'rgba(80,70,70,' + (weather.rain * 0.6).toFixed(2) + ')'; for (let i = 0; i < 5; i++) { const cx = ((i + 0.5) / 5) * W + Math.sin(t * 0.3 + i) * 20; ctx.beginPath(); ctx.ellipse(cx, 30 + (i % 2) * 20, W * 0.14, 24, 0, 0, Math.PI * 2); ctx.fill(); } }
  }
  function ckGround(t) {
    const dl = daylight();
    // pipes along the back wall
    ctx.fillStyle = col([90, 80, 75], dl); ctx.fillRect(0, soilY - 30, W, 8); ctx.fillRect(0, soilY - 16, W, 5);
    ctx.fillStyle = brass(190, dl); for (let x = 30; x < W; x += 90) { ctx.fillRect(x, soilY - 33, 8, 14); }
    // the floor: grating over turning gears
    ctx.fillStyle = col([40, 36, 40], dl); ctx.fillRect(0, soilY - 8, W, H - soilY + 8);
    for (const pb of pebbles) { const x = pb.x * W, y = soilY + 16 + pb.y * (H - soilY - 30), r = 8 + pb.r * 10; gear(x, y, r, 8 + Math.floor(pb.r * 4), t * (pb.r > 1.5 ? 0.4 : -0.6) + pb.x * 10, brass(130 + pb.r * 20, dl * 0.8), dl); }
    ctx.strokeStyle = col([120, 112, 108], dl, 0.9); ctx.lineWidth = 3;
    for (let x = 0; x <= W; x += 22) { ctx.beginPath(); ctx.moveTo(x, soilY - 8); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = soilY - 8; y <= H; y += 22) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.fillStyle = col([160, 150, 140], dl); ctx.fillRect(0, soilY - 10, W, 4);
    for (const tf of tufts) { if (tf.h > 6) continue; ctx.fillStyle = brass(200, dl); ctx.beginPath(); ctx.arc(tf.x * W, soilY - 8, 1.6, 0, Math.PI * 2); ctx.fill(); }
  }
  function ckPlanter(r, s, plant, isFocus) {
    const { x, w, y, h, cx } = r;
    const dl = daylight();
    shadow(cx, y + h + 3, w * 1.05, w * 0.06);
    const body = ctx.createLinearGradient(x, 0, x + w, 0);
    body.addColorStop(0, brass(isFocus ? 235 : 215, dl)); body.addColorStop(0.55, brass(175, dl)); body.addColorStop(1, brass(120, dl));
    ctx.fillStyle = body; ctx.beginPath(); ctx.moveTo(x + 2, y); ctx.lineTo(x + w - 2, y); ctx.lineTo(x + w - 8, y + h); ctx.lineTo(x + 8, y + h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = brass(240, dl); ctx.beginPath(); ctx.roundRect(x - 4, y - 8, w + 8, 10, 2); ctx.fill();
    ctx.fillStyle = iron(60, dl); for (let i = 0; i < Math.floor(w / 14); i++) { ctx.beginPath(); ctx.arc(x + 10 + i * 14, y - 3, 1.6, 0, Math.PI * 2); ctx.fill(); }
    const rings = Math.min(6, (s && s.compactions) || 0);
    if (rings) { ctx.fillStyle = iron(70, dl); for (let i = 0; i < rings; i++) ctx.fillRect(x + 10, y + 10 + i * 6, w - 20, 2); }
    if (plant) { ctx.fillStyle = 'rgba(255,255,255,' + ((plant.water / waterCap()) * 0.25).toFixed(2) + ')'; ctx.fillRect(x + 4, y - 7, w - 8, 3); }
    if (s) tag(r, s, 'rgba(50,36,20,0.92)', '#ffe9b8', 'rgba(50,36,20,0.85)', '#ffd98a');
  }
  function ckMachine(r, sid, t, plant, wilt) {
    if (!plant) return;
    const dl = daylight();
    const sp = speciesOf(plant), si = plantStage(plant), prog = plantProgress(plant);
    const k = Math.max(0.6, r.scale) * (si >= 11 ? 1.25 : 1) * themeRoom(r);
    const cx = r.cx, base = r.y - 8;
    const shape = sp.shape;
    const metal = shape === 'cactus' ? [90, 84, 86] : shape === 'fronds' ? [200, 225, 235] : shape === 'moon' ? [210, 210, 220] : shape === 'stem' ? [240, 200, 90] : shape === 'spikes' ? [200, 120, 80] : shape === 'bonsai' ? [220, 190, 110] : sp.thorns ? [110, 100, 100] : [215, 170, 70];
    const m = col(metal, dl), md = col(metal.map((c) => c * 0.65), dl), ml = col(metal.map((c) => Math.min(255, c + 40)), dl);
    const bw = 30 * k, unit = 14 * k;
    ctx.save(); ctx.globalAlpha = 1 - wilt * 0.6;
    if (si === 0) {
      // a blueprint on the pedestal
      ctx.fillStyle = 'rgba(40,80,160,0.85)'; ctx.fillRect(cx - bw, base - 26 * k, bw * 2, 26 * k);
      ctx.strokeStyle = 'rgba(220,235,255,0.8)'; ctx.lineWidth = 1; ctx.setLineDash([3, 2]); ctx.strokeRect(cx - bw * 0.6, base - 22 * k, bw * 1.2, 18 * k); ctx.beginPath(); ctx.arc(cx, base - 13 * k, 5 * k, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore(); return;
    }
    // frame
    const frameH = (si >= 2 ? 3 : 1.5) * unit + (si >= 4 ? unit : 0) + (si >= 6 ? unit * 1.5 : 0) + prog * unit * 0.5;
    ctx.strokeStyle = md; ctx.lineWidth = 3 * k; ctx.beginPath(); ctx.moveTo(cx - bw, base); ctx.lineTo(cx - bw, base - frameH); ctx.moveTo(cx + bw, base); ctx.lineTo(cx + bw, base - frameH); ctx.moveTo(cx - bw, base - frameH); ctx.lineTo(cx + bw, base - frameH); ctx.stroke();
    if (si === 1) { ctx.beginPath(); ctx.moveTo(cx - bw, base); ctx.lineTo(cx + bw, base - frameH); ctx.moveTo(cx + bw, base); ctx.lineTo(cx - bw, base - frameH); ctx.stroke(); }
    // boiler from two
    if (si >= 2) {
      const g = ctx.createLinearGradient(cx - bw, 0, cx + bw, 0); g.addColorStop(0, ml); g.addColorStop(0.5, m); g.addColorStop(1, md);
      ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(cx - bw * 0.8, base - unit * 2.6, bw * 1.6, unit * 2.4, 8 * k); ctx.fill();
      ctx.fillStyle = iron(50, dl); for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(cx - bw * 0.65 + i * bw * 0.26, base - unit * 2.35, 1.4 * k, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(cx - bw * 0.65 + i * bw * 0.26, base - unit * 0.5, 1.4 * k, 0, Math.PI * 2); ctx.fill(); }
      if (shape === 'cactus') { ctx.fillStyle = 'rgba(255,120,40,' + (0.5 + 0.4 * Math.sin(t * 3)).toFixed(2) + ')'; ctx.fillRect(cx - bw * 0.3, base - unit * 1.6, bw * 0.6, unit * 0.6); }
      if (shape === 'fronds') { ctx.fillStyle = 'rgba(180,240,255,0.5)'; ctx.fillRect(cx - bw * 0.6, base - unit * 2.2, bw * 1.2, unit * 1.6); for (let i = 0; i < 4; i++) { ctx.fillStyle = 'rgba(120,255,200,' + (0.4 + 0.5 * Math.max(0, Math.sin(t * 3 + i * 1.6))).toFixed(2) + ')'; ctx.fillRect(cx - bw * 0.5 + i * bw * 0.3, base - unit * 1.9, bw * 0.16, unit * 0.9); } }
      if (shape === 'moon') { ctx.fillStyle = iron(30, dl); ctx.beginPath(); ctx.arc(cx - bw * 0.25, base - unit * 1.5, 3 * k, 0, Math.PI * 2); ctx.arc(cx + bw * 0.25, base - unit * 1.5, 3 * k, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = iron(30, dl); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, base - unit * 1.1, 6 * k, 0.2, Math.PI - 0.2); ctx.stroke(); }
    }
    // pistons from three
    if (si >= 3) { for (const side of [-1, 1]) { const px = cx + side * bw * 1.05, ph = Math.abs(Math.sin(t * 4 + side)) * unit * 0.6; ctx.fillStyle = iron(90, dl); ctx.fillRect(px - 4 * k, base - unit * 1.2, 8 * k, unit * 1.2); ctx.fillStyle = ml; ctx.fillRect(px - 2.5 * k, base - unit * 1.2 - ph, 5 * k, ph + unit * 0.2); ctx.fillStyle = iron(120, dl); ctx.fillRect(px - 6 * k, base - unit * 1.2 - ph - 3 * k, 12 * k, 3 * k); } }
    // gears from four
    if (si >= 4) { gear(cx - bw * 0.45, base - unit * 3.2, 9 * k, 8, t * 1.2, m, dl); gear(cx + bw * 0.35, base - unit * 3.4, 12 * k, 10, -t * 0.9, ml, dl); if (si >= 7) gear(cx + bw * 1.1, base - unit * 2.9, 7 * k, 7, t * 1.6, m, dl); }
    // lamps from five
    if (si >= 5) { for (let i = -1; i <= 1; i += 2) { const lx = cx + i * bw * 0.5, ly = base - unit * 2.1; const gl = ctx.createRadialGradient(lx, ly, 1, lx, ly, 14 * k); gl.addColorStop(0, 'rgba(255,220,120,' + (0.5 + 0.2 * Math.sin(t * 2 + i)).toFixed(2) + ')'); gl.addColorStop(1, 'rgba(255,220,120,0)'); ctx.fillStyle = gl; ctx.fillRect(lx - 14 * k, ly - 14 * k, 28 * k, 28 * k); ctx.fillStyle = 'rgba(255,240,180,0.95)'; ctx.beginPath(); ctx.arc(lx, ly, 3 * k, 0, Math.PI * 2); ctx.fill(); } }
    // chimney from six, bell from seven, orrery from eight
    const topY = base - frameH;
    if (si >= 6) { ctx.fillStyle = iron(70, dl); ctx.fillRect(cx - bw * 0.7 - 5 * k, topY - unit * 1.4, 10 * k, unit * 1.4); ctx.fillStyle = iron(90, dl); ctx.fillRect(cx - bw * 0.7 - 7 * k, topY - unit * 1.6, 14 * k, 4 * k); ctx.fillStyle = 'rgba(200,200,210,0.4)'; for (let i = 0; i < 4; i++) { const ph = (t * 0.4 + i * 0.25) % 1; ctx.beginPath(); ctx.arc(cx - bw * 0.7 + Math.sin(ph * 6 + i) * 5 * k + ph * 12 * k, topY - unit * 1.7 - ph * 36 * k, (2 + ph * 6) * k, 0, Math.PI * 2); ctx.fill(); } }
    if (si >= 7) { ctx.save(); ctx.translate(cx + bw * 0.55, topY - unit * 0.2); ctx.rotate(Math.sin(t * 3) * 0.2); ctx.fillStyle = brass(220, dl); ctx.beginPath(); ctx.moveTo(-7 * k, 0); ctx.quadraticCurveTo(-7 * k, -12 * k, 0, -13 * k); ctx.quadraticCurveTo(7 * k, -12 * k, 7 * k, 0); ctx.closePath(); ctx.fill(); ctx.fillStyle = iron(40, dl); ctx.beginPath(); ctx.arc(0, 1, 2 * k, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    if (si >= 8) { const oy = topY - unit * 1.2; ctx.strokeStyle = brass(220, dl); ctx.lineWidth = 1.2; for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.ellipse(cx, oy, 10 * k * i, 3.5 * k * i, 0, 0, Math.PI * 2); ctx.stroke(); const a = t * (1.2 / i) + i; ctx.fillStyle = ['#4da6ff', '#ff8f4d', '#8a5cff'][i - 1]; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 10 * k * i, oy + Math.sin(a) * 3.5 * k * i, 2.5 * k, 0, Math.PI * 2); ctx.fill(); } ctx.fillStyle = '#ffd45c'; ctx.beginPath(); ctx.arc(cx, oy, 3.5 * k, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = iron(80, dl); ctx.fillRect(cx - 1.5 * k, oy, 3 * k, unit * 1.2); }
    if (shape === 'stem' && si >= 3) { const sunX = W * 0.08 + dayFraction() * W * 0.84; const ang = Math.atan2(-H * 0.4, sunX - cx); ctx.save(); ctx.translate(cx, topY - 4 * k); ctx.rotate(ang + Math.PI / 2); ctx.fillStyle = brass(240, dl); ctx.beginPath(); ctx.ellipse(0, -8 * k, 12 * k, 4 * k, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    if (shape === 'spikes' && si >= 2) { ctx.strokeStyle = 'rgba(255,200,120,0.8)'; ctx.lineWidth = 1; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(cx - bw * 0.7 + i * bw * 0.28, base - unit * 2.6); ctx.lineTo(cx - bw * 0.7 + i * bw * 0.28 + Math.sin(t * 5 + i) * 3, base - unit * 0.3); ctx.stroke(); } }
    if (sp.thorns) { ctx.fillStyle = iron(120, dl); for (let i = 0; i < 5; i++) { const px = cx - bw * 0.7 + i * bw * 0.35; ctx.beginPath(); ctx.moveTo(px - 3 * k, base - unit * 2.6); ctx.lineTo(px, base - unit * 3.3); ctx.lineTo(px + 3 * k, base - unit * 2.6); ctx.closePath(); ctx.fill(); } }
    if (shape === 'bonsai' && si >= 2) { ctx.fillStyle = '#fff8e8'; ctx.beginPath(); ctx.arc(cx, base - unit * 1.4, 8 * k, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#2b2620'; ctx.lineWidth = 1; const d = new Date(); ctx.beginPath(); ctx.moveTo(cx, base - unit * 1.4); ctx.lineTo(cx + Math.cos(d.getSeconds() * Math.PI / 30 - Math.PI / 2) * 6 * k, base - unit * 1.4 + Math.sin(d.getSeconds() * Math.PI / 30 - Math.PI / 2) * 6 * k); ctx.stroke(); }
    // late stages
    if (si >= 9) { const gl = ctx.createRadialGradient(cx, base - frameH / 2, 6, cx, base - frameH / 2, bw * 2.4); gl.addColorStop(0, 'rgba(255,200,100,' + (si >= 10 ? 0.22 : 0.14) + ')'); gl.addColorStop(1, 'rgba(255,200,100,0)'); ctx.fillStyle = gl; ctx.fillRect(cx - bw * 2.4, base - frameH / 2 - bw * 2.4, bw * 4.8, bw * 4.8); }
    if (si >= 10) { for (let i = 0; i < 8; i++) { const ph = (t * 1.5 + i * 0.37) % 1; ctx.fillStyle = 'hsla(' + ((t * 60 + i * 45) % 360) + ',90%,70%,' + (1 - ph).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(cx + Math.cos(i * 0.8) * bw * (0.6 + ph * 0.8), base - unit * 3 - Math.sin(i * 1.3) * bw * ph, 2 * k, 0, Math.PI * 2); ctx.fill(); } }
    if (si >= 12) { ctx.fillStyle = 'rgba(60,140,100,0.5)'; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(cx - bw * 0.6 + i * bw * 0.3, base - unit * (0.6 + (i % 3) * 0.7), 3 * k, 0, Math.PI * 2); ctx.fill(); } }
    if (si >= 13) { for (let i = 0; i < 3; i++) { const a = t * 0.3 + i * 2.1; ctx.strokeStyle = 'hsla(' + ((t * 40 + i * 120) % 360) + ',90%,80%,0.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, topY - unit); ctx.lineTo(cx + Math.cos(a) * W * 0.4, topY - unit - Math.abs(Math.sin(a)) * H * 0.5 - 40); ctx.stroke(); } }
    ctx.restore();
  }
  function ckWorkshop(t) {
    if (!has('greenhouse')) return;
    const dl = daylight();
    const w = Math.max(96, Math.min(150, W * 0.11)), h = w * 0.6;
    const x = W * 0.27 - w / 2, y = soilY - 4;
    shadow(x + w / 2, y + 3, w * 1.05, 5, 0.15);
    ctx.fillStyle = col([120, 90, 70], dl); ctx.fillRect(x, y - h * 0.6, w, h * 0.6);
    ctx.fillStyle = iron(70, dl); ctx.beginPath(); ctx.moveTo(x - 4, y - h * 0.6); ctx.lineTo(x + w / 2, y - h); ctx.lineTo(x + w + 4, y - h * 0.6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,170,60,' + (0.35 + 0.4 * Math.abs(Math.sin(t * 4))).toFixed(2) + ')'; ctx.fillRect(x + w * 0.35, y - h * 0.45, w * 0.3, h * 0.45);
    gear(x + w * 0.18, y - h * 0.35, 8, 8, t, brass(220, dl), dl);
    ctx.fillStyle = iron(90, dl); ctx.fillRect(x + w * 0.78, y - h * 0.95, 8, h * 0.35);
  }
  function ckRust(t) {
    for (const p of pests) {
      const pos = pestPos(p); if (!pos) continue;
      const x = pos.x, y = pos.y + Math.sin(t * 3 + p.flap) * 2;
      ctx.fillStyle = '#a8522a'; ctx.beginPath(); ctx.moveTo(x - 8, y + 4); ctx.quadraticCurveTo(x - 9, y - 8, x, y - 9); ctx.quadraticCurveTo(x + 9, y - 8, x + 8, y + 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#7a3a1a'; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(x - 4 + i * 3, y - 2 + (i % 2) * 3, 1.5, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = '#ffd45c'; ctx.beginPath(); ctx.arc(x - 3, y - 4, 1.4, 0, Math.PI * 2); ctx.arc(x + 3, y - 4, 1.4, 0, Math.PI * 2); ctx.fill();
    }
  }
  function ckSparks(t) {
    for (const c of critters) {
      const fade = Math.min(1, c.age * 3, (c.life - c.age) * 2);
      ctx.save(); ctx.globalAlpha = fade; ctx.translate(c.x, c.y);
      ctx.strokeStyle = '#ffe07a'; ctx.lineWidth = 2; ctx.beginPath(); let px = 0, py = 0; ctx.moveTo(0, 0); for (let i = 0; i < 5; i++) { px += (Math.random() - 0.5) * 8; py += (Math.random() - 0.5) * 8; ctx.lineTo(px, py); } ctx.stroke();
      ctx.fillStyle = '#fff8d0'; ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  function ckUpgrades(t) {
    const dl = daylight();
    if (has('barrel')) { const x = mailbox.x + mailbox.w + 22, y = soilY; shadow(x + 13, y + 5, 34, 4, 0.2); ctx.fillStyle = brass(190, dl); ctx.beginPath(); ctx.roundRect(x, y - 36, 26, 40, 6); ctx.fill(); ctx.fillStyle = iron(50, dl); for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(x + 4 + i * 6, y - 30, 1.2, 0, Math.PI * 2); ctx.fill(); } ctx.fillStyle = 'rgba(255,255,255,0.35)'; for (let i = 0; i < 3; i++) { const ph = (t * 0.6 + i * 0.33) % 1; ctx.beginPath(); ctx.arc(x + 13 + Math.sin(ph * 5) * 4, y - 40 - ph * 18, 2 + ph * 3, 0, Math.PI * 2); ctx.fill(); } }
    const room = gate.x - 8;
    if (has('compost')) { const x = room - (has('scarecrow') ? 56 : 0) - 40, y = soilY; shadow(x + 12, y + 5, 32, 4, 0.2); ctx.fillStyle = iron(45, dl); for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.arc(x + 4 + (i % 4) * 6 + Math.floor(i / 4) * 3, y - 3 - Math.floor(i / 4) * 5, 3.5, 0, Math.PI * 2); ctx.fill(); } ctx.fillStyle = 'rgba(255,120,40,' + (0.3 + 0.3 * Math.sin(t * 2)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(x + 12, y - 6, 3, 0, Math.PI * 2); ctx.fill(); }
    if (has('scarecrow')) { const x = room - 28, y = soilY - 2; shadow(x, y + 6, 30, 4, 0.2); ctx.fillStyle = iron(90, dl); ctx.fillRect(x - 2, y - 40, 4, 42); ctx.fillStyle = brass(200, dl); ctx.beginPath(); ctx.roundRect(x - 8, y - 58, 16, 18, 3); ctx.fill(); ctx.beginPath(); ctx.moveTo(x + 8, y - 52); ctx.lineTo(x + 22, y - 58); ctx.lineTo(x + 22, y - 54); ctx.lineTo(x + 8, y - 48); ctx.closePath(); ctx.fill(); ctx.fillStyle = 'rgba(120,220,255,' + (0.4 + 0.5 * Math.sin(t * 6)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(x + 22, y - 56, 2, 0, Math.PI * 2); ctx.fill(); }
    if (has('feeder')) { const x = Math.min(W - 30, gate.x + gate.w + 40), y = soilY - 44; ctx.fillStyle = iron(90, dl); ctx.fillRect(x - 1, y - 6, 2, 50); gear(x, y - 12, 12, 10, t * 2, brass(230, dl), dl); ctx.strokeStyle = '#ffe07a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 12, y - 12); ctx.lineTo(x + 16 + Math.random() * 4, y - 16 + Math.random() * 8); ctx.stroke(); }
  }
  function ckAmbient(a, layer, t, fade) {
    const dl = daylight();
    if (layer === 'back') {
      if (a.kind === 'cloud') { ctx.fillStyle = 'rgba(110,100,105,' + (0.3 * dl * fade + 0.05).toFixed(2) + ')'; const w = a.w, h = w * 0.3; ctx.beginPath(); ctx.ellipse(a.x, a.y, w * 0.5, h * 0.5, 0, 0, Math.PI * 2); ctx.ellipse(a.x - w * 0.25, a.y + h * 0.15, w * 0.3, h * 0.4, 0, 0, Math.PI * 2); ctx.ellipse(a.x + w * 0.25, a.y + h * 0.1, w * 0.3, h * 0.42, 0, 0, Math.PI * 2); ctx.fill(); return true; }
      if (a.kind === 'rainbow') { const bands = ['#c77dff', '#4da6ff', '#66d9a8', '#ffe74d', '#ffa64d']; const lw = Math.max(4, a.r * 0.028); ctx.lineWidth = lw; for (let k = 0; k < bands.length; k++) { ctx.strokeStyle = bands[k]; ctx.globalAlpha = 0.16 * fade * dl; ctx.beginPath(); ctx.arc(a.cx, soilY + 30, Math.max(1, a.r - k * lw), Math.PI, Math.PI * 2); ctx.stroke(); } ctx.globalAlpha = 1; return true; }
      if (a.kind === 'flock') { for (let k = 0; k < a.n; k++) { const bx = a.x + Math.abs(k - (a.n - 1) / 2) * 14, by = a.y + (k - (a.n - 1) / 2) * 7, flap = Math.sin(t * 12 + k) * 3; ctx.strokeStyle = 'rgba(200,160,70,' + (0.8 * fade).toFixed(2) + ')'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(bx - 6, by - flap); ctx.lineTo(bx, by + 1); ctx.lineTo(bx + 6, by - flap); ctx.stroke(); ctx.fillStyle = 'rgba(80,70,60,' + (0.8 * fade).toFixed(2) + ')'; ctx.fillRect(bx - 1.5, by - 1, 3, 3); } return true; }
      if (a.kind === 'balloon') { ctx.save(); ctx.translate(a.x, a.y); ctx.globalAlpha = fade * (0.5 + 0.5 * dl); ctx.fillStyle = col([170, 130, 90], dl); ctx.beginPath(); ctx.ellipse(0, 0, 34, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(60,40,20,0.5)'; ctx.lineWidth = 1; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 12, -11); ctx.lineTo(i * 12, 11); ctx.stroke(); } ctx.fillStyle = col([90, 60, 40], dl); ctx.fillRect(-10, 13, 20, 7); ctx.beginPath(); ctx.moveTo(-30, 2); ctx.lineTo(-40, -4); ctx.lineTo(-40, 8); ctx.closePath(); ctx.fill(); gear(28, 2, 4, 6, t * 8, col([120, 100, 80], dl), dl); ctx.restore(); return true; }
      if (a.kind === 'plane') { const dir = a.vx > 0 ? 1 : -1; ctx.save(); ctx.translate(a.x, a.y); ctx.scale(dir, 1); ctx.globalAlpha = fade; ctx.fillStyle = col([200, 60, 50], dl); ctx.fillRect(-12, -2, 24, 4); ctx.fillStyle = col([220, 190, 120], dl); ctx.fillRect(-6, -8, 16, 2); ctx.fillRect(-6, 3, 16, 2); ctx.fillRect(-14, -6, 4, 4); ctx.strokeStyle = 'rgba(60,40,20,0.6)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-3, -7); ctx.lineTo(-3, 4); ctx.moveTo(7, -7); ctx.lineTo(7, 4); ctx.stroke(); ctx.strokeStyle = 'rgba(80,80,90,0.6)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(12, -5 + Math.sin(t * 40) * 4); ctx.lineTo(12, 5 - Math.sin(t * 40) * 4); ctx.stroke(); ctx.restore(); return true; }
      return false;
    }
    if (a.kind === 'kite') { ctx.save(); ctx.globalAlpha = fade; ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.ax, a.ay); ctx.quadraticCurveTo((a.ax + a.x) / 2 - 20, (a.ay + a.y) / 2 + 30, a.x, a.y); ctx.stroke(); ctx.translate(a.x, a.y); ctx.rotate(0.3 + Math.sin(a.age * 1.7 + a.phase) * 0.1); ctx.strokeStyle = col([200, 60, 50], dl); ctx.lineWidth = 1.5; ctx.strokeRect(-10, -14, 20, 10); ctx.strokeRect(-10, 4, 20, 10); ctx.beginPath(); ctx.moveTo(-10, -4); ctx.lineTo(-10, 4); ctx.moveTo(10, -4); ctx.lineTo(10, 4); ctx.stroke(); ctx.fillStyle = 'rgba(200,60,50,0.35)'; ctx.fillRect(-10, -14, 20, 10); ctx.fillRect(-10, 4, 20, 10); ctx.restore(); return true; }
    if (a.kind === 'butterfly') { ctx.save(); ctx.translate(a.x, a.y); ctx.globalAlpha = fade; const flap = Math.abs(Math.sin(t * 10 + a.phase)); ctx.fillStyle = col([200, 170, 90], dl); ctx.beginPath(); ctx.ellipse(-5 * flap - 1, -2, 6 * (0.4 + flap * 0.6), 5, -0.5, 0, Math.PI * 2); ctx.ellipse(5 * flap + 1, -2, 6 * (0.4 + flap * 0.6), 5, 0.5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(60,40,20,0.5)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(-6 * flap, -2); ctx.lineTo(6 * flap, -2); ctx.stroke(); ctx.fillStyle = iron(60, dl); ctx.fillRect(-0.8, -5, 1.6, 10); gear(0, 2, 2, 6, t * 5, iron(120, dl), dl); ctx.restore(); return true; }
    if (a.kind === 'ladybug' || a.kind === 'snail') { const p = ambientPos(a); ctx.save(); ctx.translate(p.x, p.y); ctx.globalAlpha = fade; ctx.scale(a.dir, 1); ctx.fillStyle = a.kind === 'snail' ? brass(200, dl) : iron(140, dl); ctx.beginPath(); ctx.ellipse(0, 0, 5.5, 3.8, 0, 0, Math.PI * 2); ctx.fill(); gear(-2, -4, 2, 6, t * 6, brass(230, dl), dl); ctx.fillStyle = iron(50, dl); ctx.beginPath(); ctx.arc(4, 0, 1.8, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return true; }
    if (a.kind === 'rabbit') { ctx.save(); ctx.translate(a.x, a.y); ctx.globalAlpha = fade; ctx.scale(a.vx > 0 ? 1 : -1, 1); ctx.fillStyle = iron(150, dl); ctx.beginPath(); ctx.ellipse(0, -4, 9, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(8, -6, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#2b2620'; ctx.beginPath(); ctx.arc(9.5, -7, 0.8, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = iron(90, dl); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-9, -4); ctx.lineTo(-16, -8); ctx.stroke(); gear(-4, -9, 2.5, 6, a.age * 12, brass(220, dl), dl); ctx.fillStyle = iron(60, dl); for (const wx of [-5, 4]) { ctx.beginPath(); ctx.arc(wx, 1, 2.2, 0, Math.PI * 2); ctx.fill(); } ctx.restore(); return true; }
    if (a.kind === 'seed') { ctx.fillStyle = 'rgba(255,220,120,' + (0.85 * fade).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(a.x, a.y - a.age * 8, 1.5, 0, Math.PI * 2); ctx.fill(); return true; }
    return false;
  }
  function ckMailbox(t) {
    const { x, y, w, h, postH } = mailbox;
    const dl = daylight();
    const flagUp = unread > 0;
    shadow(x + w / 2, y + postH + 2, w * 1.3, 4, 0.2);
    ctx.fillStyle = brass(160, dl); ctx.fillRect(x + w / 2 - 7, y - h - 20, 14, postH + h + 20);
    ctx.fillStyle = 'rgba(200,230,240,0.45)'; ctx.fillRect(x + w / 2 - 5, y - h - 18, 10, postH + h + 16);
    ctx.fillStyle = brass(220, dl); ctx.fillRect(x + w / 2 - 10, y - h - 24, 20, 6); ctx.fillRect(x + w / 2 - 10, y + postH - 4, 20, 6);
    const cy = flagUp ? y - h + 6 + Math.sin(t * 2) * 3 : y + postH - 16;
    ctx.fillStyle = flagUp ? '#ffcb5c' : brass(200, dl); ctx.beginPath(); ctx.roundRect(x + w / 2 - 4, cy - 8, 8, 16, 4); ctx.fill();
    if (flagUp) { const pulse = 0.5 + 0.5 * Math.sin(t * 3); ctx.fillStyle = 'rgba(255,220,120,' + (0.25 + 0.35 * pulse).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(x + w / 2, y - h / 2, w * 0.9, 0, Math.PI * 2); ctx.fill(); }
    if (unread > 0) { ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#c94a3a'; ctx.beginPath(); ctx.arc(x + w / 2, y - h - 32, 9, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(String(unread), x + w / 2, y - h - 32); }
  }
  function ckDesk(t) {
    const st = deskState();
    const on = st.mode === 'ready', queue = st.mode === 'queue' || st.mode === 'later';
    const { x, y, w } = desk;
    const dl = daylight();
    ctx.fillStyle = iron(80, dl); ctx.fillRect(x + 4, y - 24, 4, 24); ctx.fillRect(x + w - 8, y - 24, 4, 24);
    ctx.save(); ctx.translate(x, y - 24); ctx.rotate(-0.25);
    ctx.fillStyle = col([120, 90, 60], dl); ctx.fillRect(0, -6, w + 4, 8);
    ctx.fillStyle = on ? '#fffdf2' : queue ? '#e6dfcf' : '#a9a29a'; ctx.fillRect(4, -12, w - 4, 7);
    ctx.strokeStyle = 'rgba(40,80,160,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(8, -9); ctx.lineTo(20, -9); ctx.moveTo(24, -11); ctx.lineTo(24, -6); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = iron(60, dl); ctx.fillRect(x + w - 14, y - 52, 3, 28); ctx.fillStyle = brass(200, dl); ctx.beginPath(); ctx.moveTo(x + w - 22, y - 50); ctx.lineTo(x + w - 4, y - 50); ctx.lineTo(x + w - 8, y - 58); ctx.lineTo(x + w - 18, y - 58); ctx.closePath(); ctx.fill();
    if (on || queue) { const g = ctx.createRadialGradient(x + w - 13, y - 46, 2, x + w - 13, y - 46, 40); g.addColorStop(0, 'rgba(255,220,120,' + (on ? 0.5 + 0.1 * Math.sin(t * 2) : 0.2).toFixed(2) + ')'); g.addColorStop(1, 'rgba(255,220,120,0)'); ctx.fillStyle = g; ctx.fillRect(x + w - 53, y - 86, 80, 80); }
    if (queuedNotes[st.s && st.s.id]) { ctx.fillStyle = '#c94a3a'; ctx.beginPath(); ctx.arc(x + 32, y - 44, 5, 0, Math.PI * 2); ctx.fill(); }
  }
  function ckGate(t) {
    const { x, y, w } = gate;
    const dl = daylight();
    shadow(x + w / 2, y + 4, w + 40, 5, 0.16);
    ctx.fillStyle = iron(110, dl); ctx.fillRect(x + w + 4, y - 56, W - x - w - 4, 60);
    ctx.fillStyle = iron(80, dl); for (let px = x + w + 4; px < W; px += 30) for (let py = y - 50; py < y; py += 14) { ctx.beginPath(); ctx.arc(px + 15, py, 1.6, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = iron(140, dl); ctx.fillRect(x + w + 4, y - 60, W - x - w - 4, 4);
    for (let px = x + w + 40; px < W - 10; px += 70) gear(px, y - 28, 9, 8, t * 0.8 + px, brass(180, dl * 0.9), dl);
    ctx.fillStyle = iron(130, dl); ctx.fillRect(x - 8, y - 70, 12, 76); ctx.fillRect(x + w - 4, y - 70, 12, 76); ctx.fillRect(x - 8, y - 74, w + 20, 6);
    const pm = (focused() && focused().permissionMode) || '';
    const openMode = !pm || pm === 'auto' || pm === 'bypassPermissions';
    const open = !paused && openMode;
    ctx.save(); ctx.translate(x + w / 2, y - 34);
    if (open) { ctx.transform(0.4, 0, 0, 1, 0, 0); ctx.translate(-w / 2 + 6, 0); }
    ctx.fillStyle = iron(open ? 90 : 120, dl); ctx.beginPath(); ctx.roundRect(-w / 2 + 6, -32, w - 12, 66, 4); ctx.fill();
    ctx.fillStyle = iron(70, dl); for (let i = -1; i <= 1; i += 2) for (let j = -2; j <= 2; j++) { ctx.beginPath(); ctx.arc(i * (w / 2 - 12), j * 13, 1.6, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = brass(220, dl); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 4, 9, 0, Math.PI * 2); ctx.stroke(); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + (open ? t : 0); ctx.beginPath(); ctx.moveTo(Math.cos(a) * 3, 4 + Math.sin(a) * 3); ctx.lineTo(Math.cos(a) * 13, 4 + Math.sin(a) * 13); ctx.stroke(); }
    if (paused) { ctx.fillStyle = '#ff5a4a'; ctx.beginPath(); ctx.arc(0, -18, 5, 0, Math.PI * 2); ctx.fill(); }
    else if (pm === 'plan' && !open) { ctx.fillStyle = brass(230, dl); ctx.beginPath(); ctx.roundRect(-24, -26, 48, 14, 3); ctx.fill(); ctx.fillStyle = '#2b1c08'; ctx.font = '600 9px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('planning', 0, -19); }
    ctx.restore();
    drawGateVisitor(t);
  }
  function ckGauge(r, s, t) {
    // a pressure gauge on a post: the needle is the context left, the red zone is where compaction is due
    if (!s) return;
    const dl = daylight();
    const left = s.night ? 0 : Math.max(0, Math.min(1, 1 - contextFraction(s) / compactAt));
    const k = Math.max(0.8, Math.min(1.3, r.scale || 1));
    const bx = r.x - 22 * k, by = r.y + r.h;
    const gr = 16 * k, gy = by - 10 * k - gr - 16 * k;
    shadow(bx + 4, by + 2, gr * 2 + 10, 3, 0.2);
    ctx.fillStyle = iron(90, dl); ctx.fillRect(bx - 3 * k, gy + gr, 6 * k, by - gy - gr); ctx.fillRect(bx - 9 * k, by - 4 * k, 18 * k, 4 * k);
    ctx.fillStyle = brass(210, dl); ctx.beginPath(); ctx.arc(bx, gy, gr + 4 * k, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f6efd8'; ctx.beginPath(); ctx.arc(bx, gy, gr, 0, Math.PI * 2); ctx.fill();
    // the dial: empty on the left, max on the right, red in the last quarter
    const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2;
    ctx.strokeStyle = 'rgba(200,60,50,0.85)'; ctx.lineWidth = 3 * k; ctx.beginPath(); ctx.arc(bx, gy, gr - 3 * k, a0, a0 + (a1 - a0) * 0.25); ctx.stroke();
    ctx.strokeStyle = 'rgba(60,50,40,0.85)'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const a = a0 + (a1 - a0) * (i / 4); ctx.beginPath(); ctx.moveTo(bx + Math.cos(a) * (gr - 5 * k), gy + Math.sin(a) * (gr - 5 * k)); ctx.lineTo(bx + Math.cos(a) * (gr - 1.5 * k), gy + Math.sin(a) * (gr - 1.5 * k)); ctx.stroke(); }
    ctx.fillStyle = 'rgba(60,50,40,0.85)'; ctx.font = (6 * k).toFixed(1) + 'px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('max', bx + Math.cos(a1) * (gr - 8 * k) - 2 * k, gy + Math.sin(a1) * (gr - 8 * k) + 4 * k);
    const low = left < 0.25, jitter = low ? Math.sin(t * 19) * 0.06 : Math.sin(t * 3) * 0.01;
    const na = a0 + (a1 - a0) * left + jitter;
    ctx.strokeStyle = '#c94a3a'; ctx.lineWidth = 1.8 * k; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(bx - Math.cos(na) * 3 * k, gy - Math.sin(na) * 3 * k); ctx.lineTo(bx + Math.cos(na) * (gr - 4 * k), gy + Math.sin(na) * (gr - 4 * k)); ctx.stroke();
    ctx.fillStyle = brass(160, dl); ctx.beginPath(); ctx.arc(bx, gy, 2.2 * k, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(bx, gy, gr - 1, Math.PI * 1.1, Math.PI * 1.6); ctx.stroke();
    if (left > 0) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; for (let i = 0; i < 2; i++) { const ph = (t * 0.7 + i * 0.5) % 1; ctx.beginPath(); ctx.arc(bx + 6 * k + Math.sin(ph * 5) * 3, gy - gr - 6 * k - ph * 22 * k, (1.5 + ph * 3) * k * left, 0, Math.PI * 2); ctx.fill(); } }
    lanterns[s.id] = { x: bx, y: gy + 8 * k, w: gr * 2 + 8 * k, h: by - gy + gr, left, pct: Math.round(100 * contextFraction(s)), night: Boolean(s.night) };
  }
  THEMES.clockwork = {
    id: 'clockwork', name: 'Clockwork', hat: 'clockwork',
    perkNames: { headstart: 'Starter kit', deeproots: 'Spring memory', longlight: 'Long burst', patientsoil: 'Patient boiler', secondwind: 'Second wind-up', greenkey: 'Workshop key' },
    achNames: { clicks1k: 'Sure wrench', harvests10: 'Ten teardowns', clicks100k: 'Master engineer' }, icon: '⚙️', price: 10000000, firefly: 'rgba(255,220,120,',
    blurb: 'A brass machine that assembles itself: a boiler, pistons, gears, lamps, a chimney, a bell, and an orrery on top. Cogs, springs, steam, oil, and coal; wrenches and lathes in the shop; rust sprites, sparks, a workshop, a pneumatic tube, a pressure gauge, and wind-up helpers.',
    words: {
      title: '⚙️ Clockwork Claude', place: 'workshop', sap: 'cogs', seed: 'spring', seeds: 'springs', plant: 'machine', plants: 'machines',
      harvest: 'Dismantle', harvested: 'dismantled', nothingToHarvest: 'nothing to dismantle', sprouted: 'was assembled',
      water: 'steam', light: 'oil', nutrients: 'coal', sunbeam: 'boiler burst', puddle: 'oil slick', greenhouse: 'workshop',
      crowLanded: 'a rust sprite crept in', crowTitle: 'A rust sprite', birdTitle: 'A passing airship', birdFloat: '🎈 +',
      beeTitle: 'A spark', beeTip: 'Click it to catch the spark for a bonus before it fizzles.', beeVisit: 'a spark is jumping', beeFloat: '⚡ caught +',
      shopTitle: 'Parts counter', shopTab: 'Factory', prestige: 'Rebuild', season: 'build',
      stages: ['blueprint', 'frame', 'boiler', 'pistons', 'gears', 'lamps lit', 'chimney', 'bell', 'orrery', 'glowing', 'enchanted', 'colossal', 'ancient', 'mythic'],
      mailboxTitle: 'Pneumatic tube', mailboxEmpty: 'Capsules arrive here only when Claude needs an answer from you.', deskTitle: 'Drafting table', gateTitle: 'The iron door', lanternTitle: 'Pressure gauge of', tend: 'click to turn the crank',
      starTitle: 'A shooting star', butterflyTitle: 'A clockwork moth', catTitle: 'A cat', snailTitle: 'A wind-up snail', ladybugTitle: 'A tin beetle',
      lanternOut: 'No pressure while the context is compacted. It builds again when compaction finishes.', lanternLeft: 'of the pressure left before compaction is due.', lanternLow: 'The needle is in the red. Let auto-compact run or type /compact in the app.',
    },
    items: {
      trowel: { name: 'Wrench', icon: '🔧' }, can: { name: 'Oil can', icon: '🛢️' }, shears: { name: 'Hammer', icon: '🔨' }, trellis: { name: 'Lathe', icon: '⚙️' }, hive: { name: 'Assembly line', icon: '🏭' }, sprinkler: { name: 'Steam hammer', icon: '🔩' }, orchard: { name: 'Foundry', icon: '🏗️' },
      longbeam: { name: 'Long burst', desc: 'The boiler burst after Claude writes a file lasts 12, then 16 seconds instead of 8.' },
      brightbeam: { name: 'Bright burst', icon: '💥', desc: 'Clicks inside a boiler burst pay four times instead of three.' },
      puddle: { name: 'Wide oil slick', icon: '🛢️', desc: 'Clicks while oil rains on a machine pay double instead of 1.5 times.' },
      birdseed: { name: 'Grapple hook', icon: '🪝', desc: 'Catching a passing airship pays three times as much.' },
      hold: { desc: 'Hold the button down on a machine and it keeps clicking for you: 3 a second, then 4, 5, and 7, a touch faster than a fast thumb.' },
      barrel: { name: 'Steam tank', icon: '🫙', desc: 'Steam holds 150 and drains a third slower.' },
      compost: { name: 'Coal bunker', icon: '🪨', desc: 'Shell commands give twice the coal.' },
      feeder: { name: 'Dynamo', icon: '🔋', desc: 'Every tool call feeds steam, oil, and coal twice as much.' },
      scarecrow: { name: 'Rust guard', icon: '🧴', desc: 'Rust sprites from failed tools leave in 20 seconds instead of 60.' },
      greenhouse: { name: 'Workshop', icon: '🏚️', desc: 'A workshop at the back of the floor. Oil drains a third slower and rust sprites can no longer slow the trickle.' },
    },
    species: {
      leafy: { name: 'Brass engine', blurb: 'The everyday machine. Brass, rivets, and a steady beat.' },
      sunflower: { name: 'Solar engine', blurb: 'A golden engine whose dish follows the sun.' },
      cactus: { name: 'Iron furnace', blurb: 'Black iron with a fire in its belly. Steam drains slowly.' },
      lavender: { name: 'Copper loom', blurb: 'Copper frames strung with humming threads.' },
      rose: { name: 'Spiked press', blurb: 'Iron spikes from the start, a heavy beat from the first stage up.' },
      bonsai: { name: 'Pocket watch', blurb: 'A small machine with a face that keeps real time.' },
      crystalfern: { name: 'Glass calculator', blurb: 'Glass panels with glowing valves. Yields 30% more.' },
      moonbloom: { name: 'Silver automaton', blurb: 'A silver machine with a face that opens to the night.' },
    },
    palette: {
      DAY: [[0.00, [80, 50, 40], [230, 170, 110]], [0.12, [150, 120, 90], [230, 200, 150]], [0.60, [140, 122, 100], [225, 205, 160]], [0.80, [120, 80, 60], [240, 170, 100]], [0.92, [70, 40, 40], [200, 110, 70]], [1.00, [40, 25, 25], [120, 70, 50]]],
      NIGHT: [[20, 14, 12], [60, 40, 30]],
    },
    draw: { sky: ckSky, ground: ckGround, planter: ckPlanter, plant: ckMachine, greenhouse: ckWorkshop, pests: ckRust, critters: ckSparks, upgrades: ckUpgrades, ambient: ckAmbient, mailbox: ckMailbox, desk: ckDesk, gate: ckGate, lantern: ckGauge },
  };
})();

// ---------- theme: bakery ----------
// Inside a bakery: a cake that gains a tier per stage on a cake stand, with a
// window on the street for a sky. Sugar for sap, recipes for seeds, flour,
// heat, and butter for the meters, ants for crows, wasps for bees.
(function registerBakery() {
  const tag = themeShared.tag;
  function bkSky(t) {
    // the back wall of the shop, with a window showing the street and the sky
    const [top, bottom] = skyColors(t);
    const dl = daylight();
    ctx.fillStyle = col([246, 226, 214], dl); ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = col([232, 200, 190], dl); for (let y = 0; y < soilY; y += 26) ctx.fillRect(0, y, W, 2);
    // the window
    const wx = W * 0.5 - W * 0.19, wy = H * 0.06, ww = W * 0.38, wh = soilY * 0.62;
    const g = ctx.createLinearGradient(0, wy, 0, wy + wh); g.addColorStop(0, rgb(top)); g.addColorStop(1, rgb(bottom));
    ctx.fillStyle = g; ctx.fillRect(wx, wy, ww, wh);
    if (connected) {
      const f = dayFraction(), night = isNight();
      if (night) { ctx.fillStyle = 'rgba(245,240,220,0.95)'; ctx.beginPath(); ctx.arc(wx + ww * 0.75, wy + wh * 0.3, 18, 0, Math.PI * 2); ctx.fill(); for (const s of stars) { if (s.x < 0.3 || s.x > 0.7 || s.y > 0.5) continue; ctx.fillStyle = 'rgba(255,255,255,' + (0.5 + 0.5 * Math.abs(Math.sin(t + s.tw))).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(wx + (s.x - 0.3) / 0.4 * ww, wy + s.y * 2 * wh * 0.6, s.r, 0, Math.PI * 2); ctx.fill(); } }
      else { const sx = wx + ww * (0.1 + f * 0.8), sy = wy + wh * 0.75 - Math.sin(f * Math.PI) * wh * 0.6, r = 16 + weather.sun * 8; const glow = ctx.createRadialGradient(sx, sy, r * 0.4, sx, sy, r * 3); glow.addColorStop(0, 'rgba(255,240,180,0.5)'); glow.addColorStop(1, 'rgba(255,240,180,0)'); ctx.save(); ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip(); ctx.fillStyle = glow; ctx.fillRect(sx - r * 3, sy - r * 3, r * 6, r * 6); ctx.fillStyle = '#fff3c0'; ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
      // rooftops across the street
      ctx.fillStyle = col([150, 120, 130], dl * 0.9); for (let i = 0; i < 5; i++) { const bx = wx + i * ww / 5, bh = wh * (0.25 + (i % 3) * 0.1); ctx.fillRect(bx, wy + wh - bh, ww / 5 - 4, bh); ctx.fillStyle = 'rgba(255,230,150,' + (0.5 * (1 - dl) + 0.1).toFixed(2) + ')'; ctx.fillRect(bx + 6, wy + wh - bh + 8, 6, 8); ctx.fillStyle = col([150, 120, 130], dl * 0.9); }
      if (weather.rain > 0.15) { ctx.strokeStyle = 'rgba(200,220,240,' + (weather.rain * 0.7).toFixed(2) + ')'; ctx.lineWidth = 1; for (let i = 0; i < 20; i++) { const rx = wx + ((i * 0.05 + t * 0.1) % 1) * ww, ry = wy + ((i * 0.13 + t * 0.9) % 1) * wh; ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - 2, ry + 8); ctx.stroke(); } }
    }
    ctx.strokeStyle = col([255, 250, 245], dl); ctx.lineWidth = 8; ctx.strokeRect(wx, wy, ww, wh); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh); ctx.moveTo(wx, wy + wh / 2); ctx.lineTo(wx + ww, wy + wh / 2); ctx.stroke();
    ctx.fillStyle = col([255, 250, 245], dl); ctx.fillRect(wx - 10, wy + wh, ww + 20, 8);
    // shelves of loaves and jars either side
    for (const sx of [W * 0.06, W * 0.86]) { for (let row = 0; row < 3; row++) { const sy = H * 0.12 + row * H * 0.14; ctx.fillStyle = col([170, 120, 80], dl); ctx.fillRect(sx, sy, W * 0.08, 4); for (let i = 0; i < 3; i++) { ctx.fillStyle = row % 2 ? col([220, 160, 90], dl) : col([200, 180, 220], dl, 0.8); ctx.beginPath(); ctx.roundRect(sx + 4 + i * W * 0.026, sy - 12, W * 0.02, 12, [4, 4, 1, 1]); ctx.fill(); } } }
    // hanging lamps
    for (let i = 0; i < 3; i++) { const lx = W * (0.3 + i * 0.2), ly = 8 + Math.sin(t * 0.5 + i) * 2; ctx.strokeStyle = col([90, 70, 60], dl); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, ly + 14); ctx.stroke(); ctx.fillStyle = col([220, 190, 150], dl); ctx.beginPath(); ctx.moveTo(lx - 10, ly + 24); ctx.lineTo(lx + 10, ly + 24); ctx.lineTo(lx + 5, ly + 14); ctx.lineTo(lx - 5, ly + 14); ctx.closePath(); ctx.fill(); const lg = ctx.createRadialGradient(lx, ly + 26, 2, lx, ly + 26, 60); lg.addColorStop(0, 'rgba(255,230,170,' + (0.35 * (1 - dl) + 0.08).toFixed(2) + ')'); lg.addColorStop(1, 'rgba(255,230,170,0)'); ctx.fillStyle = lg; ctx.fillRect(lx - 60, ly - 34, 120, 120); }
  }
  function bkGround(t) {
    const dl = daylight();
    // the counter edge and a chequered floor
    ctx.fillStyle = col([170, 120, 80], dl); ctx.fillRect(0, soilY - 12, W, 12);
    ctx.fillStyle = col([200, 150, 100], dl); ctx.fillRect(0, soilY - 14, W, 4);
    const tile = 34;
    for (let row = 0; row < Math.ceil((H - soilY) / tile) + 1; row++) {
      for (let cx = 0; cx < W + tile; cx += tile) {
        const i = Math.floor(cx / tile) + row;
        ctx.fillStyle = i % 2 ? col([240, 232, 220], dl) : col([120, 90, 80], dl);
        const skew = row * 6;
        ctx.beginPath(); ctx.moveTo(cx - skew, soilY + row * tile); ctx.lineTo(cx + tile - skew, soilY + row * tile); ctx.lineTo(cx + tile - skew - 6, soilY + (row + 1) * tile); ctx.lineTo(cx - skew - 6, soilY + (row + 1) * tile); ctx.closePath(); ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; for (const pb of pebbles) { ctx.beginPath(); ctx.arc(pb.x * W, soilY + 10 + pb.y * (H - soilY - 20), pb.r, 0, Math.PI * 2); ctx.fill(); }
  }
  function bkPlanter(r, s, plant, isFocus) {
    const { x, w, y, h, cx } = r;
    const dl = daylight();
    shadow(cx, y + h + 3, w * 1.05, w * 0.06);
    // a cake stand
    ctx.fillStyle = col([220, 220, 230], dl); ctx.fillRect(cx - 5, y + 6, 10, h - 10); ctx.beginPath(); ctx.ellipse(cx, y + h - 2, w * 0.3, 6, 0, 0, Math.PI * 2); ctx.fill();
    const plate = ctx.createLinearGradient(x, 0, x + w, 0); plate.addColorStop(0, col(isFocus ? [255, 255, 255] : [245, 245, 250], dl)); plate.addColorStop(1, col([200, 200, 215], dl));
    ctx.fillStyle = plate; ctx.beginPath(); ctx.ellipse(cx, y, w / 2 + 6, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = col([180, 180, 200], dl); ctx.lineWidth = 1; ctx.stroke();
    const rings = Math.min(6, (s && s.compactions) || 0);
    if (rings) { ctx.fillStyle = col([220, 120, 140], dl); for (let i = 0; i < rings; i++) { ctx.beginPath(); ctx.arc(x + 8 + i * 9, y + h - 6, 2.5, 0, Math.PI * 2); ctx.fill(); } }
    if (plant) { ctx.fillStyle = 'rgba(255,255,255,' + ((plant.water / waterCap()) * 0.5).toFixed(2) + ')'; ctx.beginPath(); ctx.ellipse(cx, y - 1, w / 2 - 6, 5, 0, 0, Math.PI * 2); ctx.fill(); }
    if (s) tag(r, s, 'rgba(90,50,60,0.92)', '#fff0f4', 'rgba(90,50,60,0.85)', '#ffd6e0');
  }
  function bkCake(r, sid, t, plant, wilt) {
    if (!plant) return;
    const dl = daylight();
    const sp = speciesOf(plant), si = plantStage(plant), prog = plantProgress(plant);
    const k = Math.max(0.6, r.scale) * (si >= 11 ? 1.3 : 1) * themeRoom(r);
    const cx = r.cx, base = r.y - 6;
    const shape = sp.shape;
    const sponge = shape === 'cactus' ? [120, 70, 40] : shape === 'stem' ? [240, 220, 120] : shape === 'spikes' ? [190, 160, 220] : sp.thorns ? [170, 40, 50] : shape === 'moon' ? [200, 170, 110] : [240, 200, 140];
    const icing = shape === 'fronds' ? [200, 240, 255] : shape === 'moon' ? [235, 225, 210] : shape === 'spikes' ? [225, 200, 245] : sp.thorns ? [250, 240, 240] : shape === 'stem' ? [255, 245, 200] : shape === 'cactus' ? [200, 160, 110] : [255, 220, 230];
    const rs = seededRandom(hashStr(sid));
    ctx.save(); ctx.globalAlpha = 1 - wilt * 0.6;
    if (si === 0) {
      // batter in a bowl
      ctx.fillStyle = col([230, 230, 240], dl); ctx.beginPath(); ctx.moveTo(cx - 18 * k, base - 16 * k); ctx.quadraticCurveTo(cx, base + 6 * k, cx + 18 * k, base - 16 * k); ctx.closePath(); ctx.fill();
      ctx.fillStyle = col(sponge, dl); ctx.beginPath(); ctx.ellipse(cx, base - 15 * k, 16 * k, 4 * k, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col([160, 120, 80], dl); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx + 4 * k + Math.sin(t * 2) * 4, base - 34 * k); ctx.lineTo(cx - 2 * k, base - 14 * k); ctx.stroke();
      ctx.restore(); return;
    }
    if (si === 1) {
      // in the tin, rising
      ctx.fillStyle = col([190, 190, 200], dl); ctx.fillRect(cx - 20 * k, base - 16 * k, 40 * k, 16 * k);
      ctx.fillStyle = col(sponge, dl); ctx.beginPath(); ctx.ellipse(cx, base - 16 * k, 18 * k, (4 + prog * 8) * k, 0, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; for (let i = 0; i < 3; i++) { const ph = (t * 0.5 + i * 0.33) % 1; ctx.beginPath(); ctx.arc(cx + (i - 1) * 8 * k, base - 24 * k - ph * 20 * k, (2 + ph * 3) * k, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore(); return;
    }
    // tiers: one at two, two at four, three at seven, more with age
    const tiers = si >= 11 ? 5 : si >= 7 ? 3 : si >= 4 ? 2 : 1;
    const tierH = 16 * k, cupcakes = shape === 'bonsai';
    let y = base;
    for (let i = 0; i < tiers; i++) {
      const tw = (44 - i * 9) * k;
      if (cupcakes) {
        for (let c = -i; c <= i; c += 2) { const px = cx + c * 12 * k * 0.9; ctx.fillStyle = col([200, 160, 120], dl); ctx.beginPath(); ctx.moveTo(px - 7 * k, y - tierH); ctx.lineTo(px + 7 * k, y - tierH); ctx.lineTo(px + 5 * k, y); ctx.lineTo(px - 5 * k, y); ctx.closePath(); ctx.fill(); ctx.fillStyle = col(icing, dl); ctx.beginPath(); ctx.arc(px, y - tierH - 2 * k, 7 * k, Math.PI, 0); ctx.fill(); }
      } else {
        ctx.fillStyle = col(sponge, dl); ctx.fillRect(cx - tw, y - tierH, tw * 2, tierH);
        ctx.fillStyle = col(sponge.map((c) => c * 0.8), dl); ctx.fillRect(cx - tw, y - tierH * 0.45, tw * 2, 2 * k);
        ctx.fillStyle = col(icing, dl); ctx.beginPath(); ctx.ellipse(cx, y - tierH, tw, 5 * k, 0, 0, Math.PI * 2); ctx.fill();
        if (si >= 6) { for (let d = 0; d < 5; d++) { const dx = cx - tw + (d + 0.5) * tw * 0.4, dh = (4 + ((d * 7) % 5)) * k; ctx.beginPath(); ctx.roundRect(dx - 2 * k, y - tierH, 4 * k, dh + 4 * k, 2 * k); ctx.fill(); } }
      }
      y -= tierH + (cupcakes ? 6 * k : 3 * k);
    }
    const topY = y + (cupcakes ? 6 * k : 3 * k);
    // the tier in progress rises on top
    if (prog > 0.1 && tiers < 5 && si >= 2) { ctx.fillStyle = col(sponge, dl, 0.6); ctx.fillRect(cx - (44 - tiers * 9) * k, topY - prog * tierH * 0.5, (44 - tiers * 9) * 2 * k, prog * tierH * 0.5); }
    // candles from five, frosting flowers from eight
    if (si >= 5) { const n = Math.min(7, si - 2); for (let i = 0; i < n; i++) { const px = cx + (i - (n - 1) / 2) * 9 * k; ctx.fillStyle = ['#ff8fa3', '#7fd0ff', '#ffe07a', '#b8f28a'][i % 4]; ctx.fillRect(px - 1.5 * k, topY - 14 * k, 3 * k, 14 * k); const flick = 1 + Math.sin(t * 11 + i) * 0.2; const lean = shape === 'stem' ? Math.sign(W * 0.08 + dayFraction() * W * 0.84 - cx) * 2 * k : 0; ctx.fillStyle = 'rgba(255,200,90,0.95)'; ctx.beginPath(); ctx.ellipse(px + lean, topY - 18 * k, 2 * k, 4 * k * flick, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(255,255,220,0.9)'; ctx.beginPath(); ctx.ellipse(px + lean, topY - 17 * k, 0.8 * k, 2 * k * flick, 0, 0, Math.PI * 2); ctx.fill(); } }
    if (si >= 8 || sp.thorns) { for (let i = 0; i < (si >= 8 ? 6 : 3); i++) { const px = cx + (rs() - 0.5) * 60 * k, py = base - rs() * (tiers * tierH); ctx.fillStyle = sp.thorns ? '#d7263d' : ['#ff8fa3', '#ffb3c6', '#ffd6e0'][i % 3]; for (let p = 0; p < 6; p++) { const a = p * Math.PI / 3 + t * 0.2; ctx.beginPath(); ctx.ellipse(px + Math.cos(a) * 3 * k, py + Math.sin(a) * 3 * k, 2.5 * k, 1.5 * k, a, 0, Math.PI * 2); ctx.fill(); } ctx.fillStyle = '#ffe07a'; ctx.beginPath(); ctx.arc(px, py, 1.5 * k, 0, Math.PI * 2); ctx.fill(); } }
    if (shape === 'fronds') { const gl = ctx.createRadialGradient(cx, topY, 4, cx, topY, 60 * k); gl.addColorStop(0, 'rgba(180,240,255,' + (0.3 + 0.15 * Math.sin(t * 2)).toFixed(2) + ')'); gl.addColorStop(1, 'rgba(180,240,255,0)'); ctx.fillStyle = gl; ctx.fillRect(cx - 60 * k, topY - 60 * k, 120 * k, 120 * k); }
    if (shape === 'cactus') { ctx.fillStyle = '#7a1f2b'; for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.arc(cx + (rs() - 0.5) * 70 * k, base - rs() * tiers * tierH, 2 * k, 0, Math.PI * 2); ctx.fill(); } }
    if (shape === 'spikes') { ctx.fillStyle = '#8a5cff'; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(cx + (i - 2.5) * 12 * k, topY - 3 * k, 2 * k, 5 * k, 0, 0, Math.PI * 2); ctx.fill(); } }
    if (si >= 9) { const gl = ctx.createRadialGradient(cx, base - tiers * tierH / 2, 8, cx, base - tiers * tierH / 2, 110 * k); gl.addColorStop(0, 'rgba(255,220,240,' + (si >= 10 ? 0.28 : 0.16) + ')'); gl.addColorStop(1, 'rgba(255,220,240,0)'); ctx.fillStyle = gl; ctx.fillRect(cx - 110 * k, base - tiers * tierH / 2 - 110 * k, 220 * k, 220 * k); }
    if (si >= 10) { for (let i = 0; i < 24; i++) { ctx.fillStyle = 'hsl(' + ((i * 37) % 360) + ',90%,65%)'; ctx.save(); ctx.translate(cx + (rs() - 0.5) * 80 * k, base - rs() * tiers * tierH); ctx.rotate(rs() * 3); ctx.fillRect(-2 * k, -0.8 * k, 4 * k, 1.6 * k); ctx.restore(); } }
    if (si >= 12) { ctx.fillStyle = 'rgba(255,215,90,0.85)'; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(cx + (rs() - 0.5) * 70 * k, base - rs() * tiers * tierH, 2.5 * k, 0, Math.PI * 2); ctx.fill(); } }
    if (si >= 13) { ctx.fillStyle = '#ffe07a'; ctx.beginPath(); ctx.moveTo(cx, topY - 30 * k); for (let i = 1; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 5 * k : 11 * k; ctx.lineTo(cx + Math.cos(a) * rr, topY - 20 * k + Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); for (let i = 0; i < 3; i++) { const a = t * 0.3 + i * 2.1; ctx.strokeStyle = 'hsla(' + ((t * 40 + i * 120) % 360) + ',90%,80%,0.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, topY - 22 * k); ctx.lineTo(cx + Math.cos(a) * W * 0.4, topY - 22 * k - Math.abs(Math.sin(a)) * H * 0.5 - 40); ctx.stroke(); } }
    ctx.restore();
  }
  function bkPantry(t) {
    if (!has('greenhouse')) return;
    const dl = daylight();
    const w = Math.max(96, Math.min(150, W * 0.11)), h = w * 0.7;
    const x = W * 0.27 - w / 2, y = soilY - 4;
    shadow(x + w / 2, y + 3, w * 1.05, 5, 0.15);
    ctx.fillStyle = col([160, 110, 70], dl); ctx.fillRect(x, y - h, w, h);
    ctx.fillStyle = col([120, 80, 50], dl); ctx.fillRect(x + 6, y - h + 6, w - 12, h - 12);
    for (let row = 0; row < 3; row++) { const sy = y - h + 14 + row * (h - 20) / 3; ctx.fillStyle = col([200, 150, 100], dl); ctx.fillRect(x + 8, sy + 14, w - 16, 3); for (let i = 0; i < 4; i++) { ctx.fillStyle = ['#e07a5f', '#f2cc8f', '#81b29a', '#f4f1de'][(i + row) % 4]; ctx.beginPath(); ctx.roundRect(x + 12 + i * (w - 24) / 4, sy, (w - 24) / 4 - 4, 14, 3); ctx.fill(); } }
  }
  function bkAnts(t) {
    for (const p of pests) {
      const pos = pestPos(p); if (!pos) continue;
      const x = pos.x, y = pos.y + 10;
      ctx.fillStyle = '#1c1c24';
      for (let i = 0; i < 5; i++) { const ax = x - 12 + i * 6 + Math.sin(t * 6 + i) * 1.5, ay = y + Math.sin(t * 9 + i) * 1; ctx.beginPath(); ctx.arc(ax, ay, 1.6, 0, Math.PI * 2); ctx.arc(ax - 2.2, ay, 1.2, 0, Math.PI * 2); ctx.arc(ax + 2, ay - 0.3, 1.1, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  function bkWasps(t) {
    for (const c of critters) {
      const fade = Math.min(1, c.age * 3, (c.life - c.age) * 2);
      ctx.save(); ctx.globalAlpha = fade; ctx.translate(c.x, c.y);
      ctx.fillStyle = 'rgba(200,220,255,0.6)'; const wing = Math.sin(t * 40) * 0.5; ctx.beginPath(); ctx.ellipse(-2, -4, 5, 2 + wing, -0.5, 0, Math.PI * 2); ctx.ellipse(3, -4, 5, 2 - wing, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd45c'; ctx.beginPath(); ctx.ellipse(1, 0, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1c1c24'; for (const sx of [-2, 1, 4]) ctx.fillRect(sx, -3, 1.5, 6); ctx.beginPath(); ctx.arc(-6, 0, 2.2, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(10, -1); ctx.lineTo(7, 1.5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
  function bkUpgrades(t) {
    const dl = daylight();
    if (has('barrel')) { const x = mailbox.x + mailbox.w + 22, y = soilY; shadow(x + 13, y + 5, 34, 4, 0.2); ctx.fillStyle = col([240, 230, 210], dl); ctx.beginPath(); ctx.roundRect(x, y - 34, 26, 36, 6); ctx.fill(); ctx.fillStyle = col([200, 190, 170], dl); ctx.fillRect(x + 6, y - 38, 14, 6); ctx.fillStyle = '#c94a3a'; ctx.font = '600 8px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('FLOUR', x + 13, y - 18); }
    const room = gate.x - 8;
    if (has('compost')) { const x = room - (has('scarecrow') ? 56 : 0) - 40, y = soilY; shadow(x + 12, y + 5, 32, 4, 0.2); ctx.fillStyle = col([150, 110, 70], dl); ctx.beginPath(); ctx.moveTo(x + 2, y); ctx.lineTo(x + 4, y - 28); ctx.lineTo(x + 22, y - 28); ctx.lineTo(x + 24, y); ctx.closePath(); ctx.fill(); ctx.fillStyle = col([120, 85, 55], dl); ctx.fillRect(x + 2, y - 30, 22, 4); ctx.fillStyle = col([200, 190, 170], dl); ctx.fillRect(x + 11, y - 44 + Math.sin(t * 3) * 3, 4, 16); }
    if (has('scarecrow')) { const x = room - 28, y = soilY - 2; shadow(x, y + 6, 30, 4, 0.2); ctx.fillStyle = col([230, 230, 240], dl); ctx.beginPath(); ctx.roundRect(x - 8, y - 30, 16, 30, 4); ctx.fill(); ctx.fillStyle = col([120, 120, 130], dl); ctx.fillRect(x - 6, y - 34, 12, 5); ctx.fillStyle = '#c94a3a'; ctx.beginPath(); ctx.arc(x, y - 18, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.5)'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x + 8 + i * 4, y - 36 - i * 3 - Math.sin(t * 3 + i) * 2, 1, 0, Math.PI * 2); ctx.fill(); } }
    if (has('feeder')) { const x = Math.min(W - 30, gate.x + gate.w + 40), y = soilY - 6; shadow(x, y + 8, 40, 4, 0.2); ctx.fillStyle = col([255, 180, 90], dl); ctx.beginPath(); ctx.roundRect(x - 18, y - 22, 36, 22, 3); ctx.fill(); ctx.fillStyle = col([120, 180, 230], dl); ctx.fillRect(x - 14, y - 18, 10, 8); ctx.fillStyle = '#1c1c24'; for (const wx of [-10, 10]) { ctx.beginPath(); ctx.arc(x + wx, y + 2, 4, 0, Math.PI * 2); ctx.fill(); } ctx.fillStyle = '#fff'; ctx.font = '600 7px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('CAKE', x + 5, y - 11); }
  }
  function bkAmbient(a, layer, t, fade) {
    const dl = daylight();
    if (layer === 'back') {
      if (a.kind === 'cloud') { ctx.fillStyle = 'rgba(255,255,255,' + (0.35 * fade).toFixed(2) + ')'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(a.x - a.w * 0.1 + i * 10, a.y - i * 8, 8 + i * 2, 0, Math.PI * 2); ctx.fill(); } return true; }
      if (a.kind === 'rainbow') { for (let i = 0; i < 30; i++) { const ang = Math.PI + (i / 30) * Math.PI, rr = a.r * 0.9 + Math.sin(i * 3) * 8; ctx.fillStyle = 'hsla(' + ((i * 37) % 360) + ',90%,65%,' + (0.7 * fade).toFixed(2) + ')'; ctx.save(); ctx.translate(a.cx + Math.cos(ang) * rr, soilY + 30 + Math.sin(ang) * rr); ctx.rotate(ang); ctx.fillRect(-3, -1.2, 6, 2.4); ctx.restore(); } return true; }
      if (a.kind === 'flock') { for (let k = 0; k < a.n; k++) { const bx = a.x + Math.abs(k - (a.n - 1) / 2) * 12, by = a.y + (k - (a.n - 1) / 2) * 6, flap = Math.sin(t * 9 + k) * 2; ctx.fillStyle = 'rgba(120,120,140,' + (0.7 * fade).toFixed(2) + ')'; ctx.beginPath(); ctx.ellipse(bx, by, 4, 2.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(120,120,140,' + (0.7 * fade).toFixed(2) + ')'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(bx - 4, by - flap); ctx.lineTo(bx, by); ctx.lineTo(bx + 4, by - flap); ctx.stroke(); } return true; }
      if (a.kind === 'balloon') { ctx.save(); ctx.translate(a.x, a.y); ctx.globalAlpha = fade; for (let i = 0; i < 3; i++) { const bx = (i - 1) * 12, by = -i % 2 * 10; ctx.fillStyle = ['#ff8fa3', '#7fd0ff', '#ffe07a'][i]; ctx.beginPath(); ctx.ellipse(bx, by, 9, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(80,80,90,0.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx, by + 11); ctx.lineTo(0, 30); ctx.stroke(); } ctx.restore(); return true; }
      if (a.kind === 'plane') { const dir = a.vx > 0 ? 1 : -1; ctx.save(); ctx.translate(a.x, a.y); ctx.scale(dir, 1); ctx.rotate(Math.sin(t * 2) * 0.1); ctx.globalAlpha = fade; ctx.fillStyle = 'rgba(250,250,255,0.95)'; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-10, -6); ctx.lineTo(-6, 0); ctx.lineTo(-10, 6); ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(120,120,140,0.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-6, 0); ctx.stroke(); ctx.restore(); return true; }
      return false;
    }
    if (a.kind === 'kite') { ctx.save(); ctx.globalAlpha = fade; ctx.strokeStyle = 'rgba(120,120,140,0.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.ax, a.ay); ctx.quadraticCurveTo((a.ax + a.x) / 2 - 20, (a.ay + a.y) / 2 + 30, a.x, a.y); ctx.stroke(); ctx.translate(a.x, a.y); ctx.fillStyle = 'hsl(' + a.hue + ',85%,65%)'; ctx.beginPath(); ctx.ellipse(0, -8, 11, 14, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.ellipse(-4, -13, 3, 5, -0.4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'hsl(' + a.hue + ',85%,55%)'; ctx.beginPath(); ctx.moveTo(-3, 5); ctx.lineTo(3, 5); ctx.lineTo(0, 8); ctx.closePath(); ctx.fill(); ctx.restore(); return true; }
    if (a.kind === 'rabbit') { ctx.save(); ctx.translate(a.x, a.y); ctx.globalAlpha = fade; ctx.scale(a.vx > 0 ? 1 : -1, 1); ctx.fillStyle = col([150, 150, 160], dl); ctx.beginPath(); ctx.ellipse(0, -3, 7, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(6, -5, 3, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#ffb3c6'; ctx.beginPath(); ctx.arc(5, -8, 1.8, 0, Math.PI * 2); ctx.arc(8, -8, 1.8, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = col([150, 150, 160], dl); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-7, -3); ctx.quadraticCurveTo(-14, -2 + Math.sin(a.age * 6) * 3, -16, -8); ctx.stroke(); ctx.fillStyle = '#1c1c24'; ctx.beginPath(); ctx.arc(7.5, -6, 0.6, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return true; }
    if (a.kind === 'seed') { ctx.fillStyle = 'rgba(255,255,255,' + (0.7 * fade).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(a.x, a.y, 2.5, 0, Math.PI * 2); ctx.fill(); return true; }
    return false;
  }
  function bkMailbox(t) {
    const { x, y, w, h, postH } = mailbox;
    const dl = daylight();
    const flagUp = unread > 0;
    shadow(x + w / 2, y + postH + 2, w * 1.3, 4, 0.2);
    ctx.fillStyle = col([120, 90, 60], dl); ctx.fillRect(x + w / 2 - 3, y, 6, postH);
    ctx.fillStyle = col([200, 60, 60], dl); ctx.beginPath(); ctx.roundRect(x - 2, y - h, w + 4, h + 4, 5); ctx.fill();
    ctx.fillStyle = col([160, 40, 40], dl); ctx.fillRect(x + 4, y - h + 10, w - 8, 4);
    ctx.fillStyle = '#fff'; ctx.font = '600 8px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('ORDERS', x + w / 2, y - 8);
    if (flagUp) { const pulse = 0.5 + 0.5 * Math.sin(t * 3); ctx.fillStyle = 'rgba(255,220,120,' + (0.25 + 0.35 * pulse).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(x + w / 2, y - h / 2, w * 0.9, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#f3e6c4'; ctx.beginPath(); ctx.roundRect(x + w / 2 - 9, y - h - 10 + Math.sin(t * 2) * 2, 18, 12, 2); ctx.fill(); }
    if (unread > 0) { ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif'; ctx.fillStyle = '#c94a3a'; ctx.beginPath(); ctx.arc(x + w / 2 + 14, y - h - 12, 9, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(String(unread), x + w / 2 + 14, y - h - 12); }
  }
  function bkDesk(t) {
    const st = deskState();
    const on = st.mode === 'ready', queue = st.mode === 'queue' || st.mode === 'later';
    const { x, y, w } = desk;
    const dl = daylight();
    ctx.fillStyle = col([120, 90, 60], dl); ctx.fillRect(x, y - 30, w, 6); ctx.fillRect(x + 4, y - 24, 5, 26); ctx.fillRect(x + w - 9, y - 24, 5, 26);
    ctx.fillStyle = on ? '#fffdf2' : queue ? '#e6dfcf' : '#a9a29a'; ctx.beginPath(); ctx.roundRect(x + 8, y - 44, 24, 16, 2); ctx.fill();
    ctx.strokeStyle = on ? '#6b5a3a' : '#8a8478'; ctx.lineWidth = 1; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x + 11, y - 40 + i * 4); ctx.lineTo(x + 24 - i * 4, y - 40 + i * 4); ctx.stroke(); }
    ctx.fillStyle = '#ffd45c'; ctx.save(); ctx.translate(x + 30, y - 46); ctx.rotate(0.6); ctx.fillRect(-1.5, -10, 3, 14); ctx.fillStyle = '#e07a5f'; ctx.fillRect(-1.5, -12, 3, 2); ctx.restore();
    // a candle in a bun
    ctx.fillStyle = col([220, 170, 110], dl); ctx.beginPath(); ctx.arc(x + w - 14, y - 30, 8, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#efe6d2'; ctx.fillRect(x + w - 16, y - 46, 4, 16);
    if (on || queue) { const fl = 3 + Math.sin(t * 9) * 0.8; ctx.fillStyle = on ? '#ffcb5c' : '#c9a24d'; ctx.beginPath(); ctx.ellipse(x + w - 14, y - 50, fl * 0.6, fl, 0, 0, Math.PI * 2); ctx.fill(); const g = ctx.createRadialGradient(x + w - 14, y - 50, 2, x + w - 14, y - 50, 40); g.addColorStop(0, 'rgba(255,220,120,' + (on ? 0.5 : 0.2) + ')'); g.addColorStop(1, 'rgba(255,220,120,0)'); ctx.fillStyle = g; ctx.fillRect(x + w - 54, y - 90, 80, 80); }
    if (queuedNotes[st.s && st.s.id]) { ctx.fillStyle = '#c94a3a'; ctx.beginPath(); ctx.arc(x + 34, y - 48, 5, 0, Math.PI * 2); ctx.fill(); }
  }
  function bkGate(t) {
    const { x, y, w } = gate;
    const dl = daylight();
    shadow(x + w / 2, y + 4, w + 40, 5, 0.16);
    // the shop door in its frame, with a counter running to the edge
    ctx.fillStyle = col([170, 120, 80], dl); ctx.fillRect(x + w + 4, y - 36, W - x - w - 4, 40);
    ctx.fillStyle = col([200, 150, 100], dl); ctx.fillRect(x + w + 4, y - 40, W - x - w - 4, 5);
    ctx.fillStyle = 'rgba(220,240,255,0.5)'; ctx.fillRect(x + w + 10, y - 34, W - x - w - 20, 22);
    for (let px = x + w + 20; px < W - 20; px += 22) { ctx.fillStyle = ['#e07a5f', '#f2cc8f', '#81b29a', '#ffb3c6'][Math.floor(px / 22) % 4]; ctx.beginPath(); ctx.arc(px, y - 22, 6, Math.PI, 0); ctx.fill(); }
    ctx.fillStyle = col([120, 80, 50], dl); ctx.fillRect(x - 8, y - 80, 10, 84); ctx.fillRect(x + w - 2, y - 80, 10, 84); ctx.fillRect(x - 8, y - 84, w + 20, 6);
    const pm = (focused() && focused().permissionMode) || '';
    const openMode = !pm || pm === 'auto' || pm === 'bypassPermissions';
    const open = !paused && openMode;
    ctx.save(); ctx.translate(x + 2, y);
    if (open) ctx.transform(0.45, -0.15, 0, 1, 0, 0);
    ctx.fillStyle = col([90, 150, 170], dl); ctx.fillRect(0, -78, w - 4, 78);
    ctx.fillStyle = 'rgba(220,240,255,0.7)'; ctx.fillRect(6, -70, w - 16, 34);
    ctx.fillStyle = col([255, 250, 240], dl); ctx.beginPath(); ctx.roundRect((w - 4) / 2 - 20, -58, 40, 14, 3); ctx.fill();
    ctx.fillStyle = paused ? '#c94a3a' : open ? '#2f7a3a' : pm === 'plan' ? '#8a5cff' : '#c94a3a'; ctx.font = '700 9px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(paused ? 'CLOSED' : open ? 'OPEN' : pm === 'plan' ? 'PLANNING' : 'CLOSED', (w - 4) / 2, -51);
    ctx.fillStyle = col([220, 190, 90], dl); ctx.beginPath(); ctx.arc(w - 12, -34, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = col([220, 190, 90], dl); ctx.beginPath(); ctx.arc(x + w / 2, y - 88 + (open ? Math.sin(t * 6) * 2 : 0), 4, 0, Math.PI * 2); ctx.fill();
    drawGateVisitor(t);
  }
  function bkOven(r, s, t) {
    if (!s) return;
    const dl = daylight();
    const left = s.night ? 0 : Math.max(0, Math.min(1, 1 - contextFraction(s) / compactAt));
    const k = Math.max(0.8, Math.min(1.3, r.scale || 1));
    const bx = r.x - 22 * k, by = r.y + r.h;
    const ow = 34 * k, oh = 44 * k, ox = bx - ow / 2, oy = by - oh;
    shadow(bx, by + 2, ow + 10, 3, 0.2);
    ctx.fillStyle = col([90, 90, 100], dl); ctx.beginPath(); ctx.roundRect(ox, oy, ow, oh, 3); ctx.fill();
    ctx.fillStyle = col([50, 50, 60], dl); ctx.fillRect(ox + 4 * k, oy + 14 * k, ow - 8 * k, oh - 20 * k);
    const fillH = oh - 20 * k - 4, lvl = fillH * left;
    if (left > 0) {
      const low = left < 0.25, jitter = low ? Math.sin(t * 19) * 2 : Math.sin(t * 5) * 1;
      const fg = ctx.createLinearGradient(0, oy + oh - 6 * k - lvl, 0, oy + oh - 6 * k); fg.addColorStop(0, 'rgba(255,220,90,0.95)'); fg.addColorStop(1, 'rgba(255,100,40,0.95)');
      ctx.fillStyle = fg; ctx.beginPath(); ctx.moveTo(ox + 6 * k, oy + oh - 6 * k); ctx.lineTo(ox + ow - 6 * k, oy + oh - 6 * k); for (let i = 4; i >= 0; i--) { ctx.lineTo(ox + 6 * k + (ow - 12 * k) * i / 4, oy + oh - 6 * k - lvl * (i % 2 ? 1 : 0.6) - (i % 2 ? jitter : 0)); } ctx.closePath(); ctx.fill();
      const gl = ctx.createRadialGradient(bx, oy + oh * 0.6, 4, bx, oy + oh * 0.6, (40 + 40 * left) * k); gl.addColorStop(0, 'rgba(255,170,70,' + (0.1 + 0.3 * (1 - dl)).toFixed(2) + ')'); gl.addColorStop(1, 'rgba(255,170,70,0)'); ctx.fillStyle = gl; ctx.fillRect(bx - 90, oy - 60, 180, 200);
    } else { ctx.fillStyle = col([80, 70, 70], dl); ctx.beginPath(); ctx.ellipse(bx, oy + oh - 8 * k, ow * 0.3, 3 * k, 0, 0, Math.PI * 2); ctx.fill(); }
    // the glass door and the thermometer beside it
    ctx.strokeStyle = col([170, 170, 180], dl); ctx.lineWidth = 2 * k; ctx.strokeRect(ox + 4 * k, oy + 14 * k, ow - 8 * k, oh - 20 * k);
    ctx.fillStyle = col([170, 170, 180], dl); ctx.fillRect(ox + 8 * k, oy + 6 * k, ow - 16 * k, 3 * k);
    const tx = ox + ow + 5 * k, ty0 = oy + oh - 6 * k, th = fillH;
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(tx - 2 * k, ty0 - th, 4 * k, th);
    ctx.fillStyle = '#c94a3a'; ctx.fillRect(tx - 1.2 * k, ty0 - lvl, 2.4 * k, lvl); ctx.beginPath(); ctx.arc(tx, ty0 + 2 * k, 3 * k, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(60,50,40,0.8)'; ctx.lineWidth = 1.2 * k; ctx.beginPath(); ctx.moveTo(tx - 5 * k, ty0 - th); ctx.lineTo(tx + 5 * k, ty0 - th); ctx.stroke();
    ctx.lineWidth = 1; for (const q of [0.75, 0.5, 0.25]) { const y2 = ty0 - th * q; ctx.beginPath(); ctx.moveTo(tx + 2 * k, y2); ctx.lineTo(tx + 5 * k, y2); ctx.stroke(); }
    ctx.fillStyle = 'rgba(60,50,40,0.8)'; ctx.font = (6.5 * k).toFixed(1) + 'px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('max', tx + 6 * k, ty0 - th + 3 * k);
    lanterns[s.id] = { x: bx + 4 * k, y: oy + oh / 2, w: ow + 14 * k, h: oh + 6 * k, left, pct: Math.round(100 * contextFraction(s)), night: Boolean(s.night) };
  }
  THEMES.bakery = {
    id: 'bakery', name: 'Bakery', hat: 'bakery',
    perkNames: { headstart: 'Starter dough', deeproots: 'Recipe memory', longlight: 'Long bake', patientsoil: 'Patient proof', secondwind: 'Second rise', greenkey: 'Pantry key' },
    achNames: { clicks1k: 'Steady spoon', harvests10: 'Ten servings', clicks100k: 'Head baker' }, icon: '🎂', price: 10000000, firefly: 'rgba(255,240,200,',
    blurb: 'Inside a bakery: a cake that gains a tier per stage on a cake stand, candles, frosting flowers, and a sugar star at mythic. Sugar, recipes, flour, heat, and butter; spoons and whisks in the shop; ants, wasps, a pantry, an order box, and helpers in chef hats.',
    words: {
      title: '🎂 Bakery of Claude', place: 'bakery', sap: 'sugar', seed: 'recipe', seeds: 'recipes', plant: 'cake', plants: 'cakes',
      harvest: 'Serve', harvested: 'served', nothingToHarvest: 'nothing to serve', sprouted: 'went in the oven',
      water: 'flour', light: 'heat', nutrients: 'butter', sunbeam: 'oven glow', puddle: 'spilled cream', greenhouse: 'pantry',
      crowLanded: 'ants got in', crowTitle: 'Ants', birdTitle: 'A passing pigeon', birdFloat: '🐦 +',
      beeTitle: 'A wasp', beeTip: 'Click it to shoo the wasp for a bonus before it lands on the cake.', beeVisit: 'a wasp is circling', beeFloat: '🐝 shooed +',
      shopTitle: 'Pastry counter', shopTab: 'Kitchen', prestige: 'New menu', season: 'menu',
      stages: ['batter', 'baking', 'sponge', 'one tier', 'two tiers', 'candles', 'frosted', 'three tiers', 'flowers', 'glowing', 'enchanted', 'colossal', 'ancient', 'mythic'],
      mailboxTitle: 'Order box', mailboxEmpty: 'Orders arrive here only when Claude needs an answer from you.', deskTitle: 'Order pad', gateTitle: 'The shop door', lanternTitle: 'Oven of', tend: 'click to stir',
      starTitle: 'A shooting star', butterflyTitle: 'A butterfly', catTitle: 'A cat', snailTitle: 'A snail', ladybugTitle: 'A ladybug',
      lanternOut: 'Cold while the context is compacted. It is relit when compaction finishes.', lanternLeft: 'of the oven fuel left before compaction is due.', lanternLow: 'The oven is cooling. Let auto-compact run or type /compact in the app.',
    },
    items: {
      trowel: { name: 'Wooden spoon', icon: '🥄' }, can: { name: 'Whisk', icon: '🥣' }, shears: { name: 'Rolling pin', icon: '🫓' }, trellis: { name: 'Stand mixer', icon: '🍰' }, hive: { name: 'Second oven', icon: '🔥' }, sprinkler: { name: 'Bread machine', icon: '🍞' }, orchard: { name: 'Franchise', icon: '🏪' },
      longbeam: { name: 'Long oven glow', desc: 'The oven glow after Claude writes a file lasts 12, then 16 seconds instead of 8.' },
      brightbeam: { name: 'Bright oven glow', icon: '🔆', desc: 'Clicks inside an oven glow pay four times instead of three.' },
      puddle: { name: 'Extra cream', icon: '🍦', desc: 'Clicks while cream spills on a cake pay double instead of 1.5 times.' },
      birdseed: { name: 'Bread crumbs', icon: '🍞', desc: 'Catching a passing pigeon pays three times as much.' },
      hold: { desc: 'Hold the button down on a cake and it keeps clicking for you: 3 a second, then 4, 5, and 7, a touch faster than a fast thumb.' },
      barrel: { name: 'Flour sack', icon: '🌾', desc: 'Flour holds 150 and drains a third slower.' },
      compost: { name: 'Butter churn', icon: '🧈', desc: 'Shell commands give twice the butter.' },
      feeder: { name: 'Delivery van', icon: '🚚', desc: 'Every tool call feeds flour, heat, and butter twice as much.' },
      scarecrow: { name: 'Ant powder', icon: '🧂', desc: 'Ants from failed tools leave in 20 seconds instead of 60.' },
      greenhouse: { name: 'Pantry', icon: '🗄️', desc: 'A pantry at the back of the shop. Heat drains a third slower and ants can no longer slow the trickle.' },
    },
    species: {
      leafy: { name: 'Sponge cake', blurb: 'The everyday cake. Pink icing and candles from the fifth stage.' },
      sunflower: { name: 'Lemon drizzle', blurb: 'A yellow cake whose candle flames lean toward the sun.' },
      cactus: { name: 'Fruit cake', blurb: 'Dense and dark, studded with fruit. Flour drains slowly.' },
      lavender: { name: 'Lavender cake', blurb: 'Purple sponge with sprigs on top.' },
      rose: { name: 'Red velvet', blurb: 'Red sponge with roses from the first stage up.' },
      bonsai: { name: 'Cupcake tower', blurb: 'A tier of cupcakes for every stage instead of one big cake.' },
      crystalfern: { name: 'Sugar-glass cake', blurb: 'Glows like spun sugar. Yields 30% more.' },
      moonbloom: { name: 'Moon cake', blurb: 'A golden cake that opens to the night.' },
    },
    palette: {
      DAY: [[0.00, [220, 170, 180], [255, 220, 200]], [0.12, [170, 205, 235], [255, 240, 220]], [0.60, [160, 200, 235], [255, 245, 225]], [0.80, [220, 180, 170], [255, 215, 180]], [0.92, [140, 90, 120], [240, 150, 130]], [1.00, [80, 60, 90], [180, 120, 130]]],
      NIGHT: [[40, 30, 60], [90, 60, 90]],
    },
    draw: { sky: bkSky, ground: bkGround, planter: bkPlanter, plant: bkCake, greenhouse: bkPantry, pests: bkAnts, critters: bkWasps, upgrades: bkUpgrades, ambient: bkAmbient, mailbox: bkMailbox, desk: bkDesk, gate: bkGate, lantern: bkOven },
  };
})();

// Apply a theme: remember it, retitle the static labels, and redraw the shop.
function applyTheme(id, preview) {
  if (!THEMES[id] || (!preview && !themeOwned(id))) id = 'garden';
  theme = THEMES[id];
  prefs.theme = theme.id; saveJSON(PREF_KEY, prefs);
  $('sap-unit').textContent = W_('sap');
  $('water-label').textContent = W_('water'); $('light-label').textContent = W_('light'); $('nutrients-label').textContent = W_('nutrients');
  $('shop-title').textContent = W_('shopTitle'); $('shop-tab-garden').textContent = W_('shopTab');
  shopSig = ''; lastPillSig = '';
  updateHud();
}
{
  // ?theme=<id> previews a theme without owning it; otherwise the saved choice, if still owned
  const fromUrl = (location.search.match(/[?&]theme=([a-z]+)/) || [])[1];
  if (fromUrl) applyTheme(fromUrl, true); else applyTheme(prefs.theme || 'garden');
}

window.__garden = { critters, particles, plants, garden, ambient, spawnAmbient, deskState, openDesk, sessions: () => sessions, holds: () => pendingHolds, holding: () => holding, letters: () => letters, focused, holdRate, celebrateCommand, hourglass, desk, THEMES, applyTheme, theme: () => theme, prestige, legacyGain, renderAlmanac, ACHIEVEMENTS, PERKS, hold: (on) => { holding = on && focused() ? { sid: focused().id, x: W / 2, y: H * 0.7, acc: 0 } : null; } };   // debugging handle
updateHud();
requestAnimationFrame(frame);
})();
