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
  shopTitle: 'Garden shop', shopTab: 'Garden', stages: STAGE_NAMES,
};
const THEMES = {};
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

const garden = Object.assign({ sap: 0, lifetime: 0, seeds: 0, harvests: 0, clicks: 0, crits: 0, events: 0, born: Date.now(), levels: {} }, loadJSON(SAVE_KEY) || {});
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
  { id: 'hive', cat: 'tool', name: 'Beehive', icon: '🐝', base: 1500000000, factor: 1.15, max: 999, power: 1600, desc: 'Adds 1,600 click power per level.' },

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
function clickPower() { return toolsPower() * seedBonus(); }
const comboCap = () => [2, 2.5, 3, 3.5][Math.min(3, lvl('rhythm'))];
const comboSeconds = () => 8 + 4 * lvl('steady');
const critChance = () => 0.01 + 0.01 * lvl('lucky');
const critMult = () => 5 + 2.5 * lvl('bigcrit');
const sunbeamSeconds = () => 8 + 4 * lvl('longbeam');
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
  p.sap += amount; garden.sap += amount; garden.lifetime += amount;
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
  if (lastRain[sid] && Date.now() - lastRain[sid] < 6000) { m *= puddleMult(); why = why ? why + '+' + W_('puddle') : W_('puddle'); }
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
  $('seeds').textContent = garden.seeds + ' ' + (garden.seeds === 1 ? W_('seed') : W_('seeds')) + ' (+' + Math.round((seedBonus() - 1) * 100) + '% clicks) · ' + fmt(garden.lifetime) + ' lifetime ' + W_('sap') + ' · ' + owned + '/' + ITEMS.length + ' items' + (isWriter ? '' : adoptedRemote ? ' · mirroring another window' : '');
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
    'power  = (1 + tools ' + fmt(toolsPower() - 1) + ') × (1 + 0.25 × √' + garden.seeds + ' seeds = ' + seedBonus().toFixed(2) + ')\n' +
    'plant  = grows one stage per ' + STAGE_MINUTES + ' healthy minutes (meters above half), ×(1 + 0.3 × stage) on every click; harvest = 1 seed at fruiting + 1 per stage beyond, plant resets';

  $('stats-events').innerHTML = ledger.events.slice(-40).reverse().map((e) => {
    const d = new Date(e.at);
    return '<div><span>' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + '</span>' + esc(e.text) + '</div>';
  }).join('') || '<div>No harvests or purchases yet.</div>';
}
$('stats-open').addEventListener('click', () => { renderStats(); showPanel('stats'); });
$('stats-close').addEventListener('click', () => $('stats').classList.add('hidden'));
$('stats').addEventListener('click', (e) => { if (e.target === $('stats')) $('stats').classList.add('hidden'); });
setInterval(() => { if (!$('stats').classList.contains('hidden')) renderStats(); }, 5000);

$('journal-open').addEventListener('click', () => { renderJournal(); showPanel('journal'); });
$('journal-close').addEventListener('click', () => $('journal').classList.add('hidden'));
$('journal').addEventListener('click', (e) => { if (e.target === $('journal')) $('journal').classList.add('hidden'); });

// only one panel at a time
const PANELS = ['shop', 'journal', 'stats', 'desk', 'letter'];
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
    head = 'Lantern of ' + sessionLabel(sessions[lanternSid]);
    body = l.night ? 'Out while the context is compacted. It is relit when compaction finishes.'
      : 'Context ' + l.pct + '% full: ' + Math.round(l.left * 100) + '% of the light left before compaction is due.' + (l.left < 0.25 ? '\nIt is guttering. Let auto-compact run or type /compact in the app.' : '');
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
    head = 'The gate';
    body = pm === 'plan' ? 'Plan mode: Claude is working out a plan and will not change anything until you approve it.'
      : pm === 'acceptEdits' ? 'Accept-edits mode: file edits go through, other tools wait at the gate for your permission.'
      : pm === 'default' ? 'Default mode: Claude waits at the gate for your permission before each new kind of tool.'
      : pm ? 'The gate is open: Claude runs tools without asking (' + pm + ' mode).' : 'Nothing is known about the permission mode yet.';
  } else if (hitGate(hover.x, hover.y) && gateSession) {
    head = sessionLabel(gateSession) + ' is waiting at the gate';
    body = (gateSession.note || 'Claude needs you') + (gateSession.pendingTool ? '\n' + prettyTool(gateSession.pendingTool.name) + ': ' + gateSession.pendingTool.text : '') + '\n\nAnswer it in the Claude app.';
  } else if (hitMailbox(hover.x, hover.y)) {
    head = 'Mailbox'; body = unread ? unread + ' letter' + (unread === 1 ? '' : 's') + ' waiting for an answer' : 'Letters arrive here only when Claude needs an answer from you.';
  } else if (hitDesk(hover.x, hover.y)) {
    const st = deskState();
    head = 'Writing desk';
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
    head = a.kind === 'star' ? 'A shooting star' : a.kind === 'butterfly' ? 'A butterfly' : a.kind === 'cat' ? 'A cat' : a.kind === 'snail' ? 'A snail' : 'A ladybug';
    body = a.kind === 'star' ? 'Quick, click to make a wish.' : a.kind === 'cat' ? 'Click to pet it. The first pet of a visit pays.' : a.kind === 'snail' ? 'In no hurry. Click it for a small bonus.' : 'Click it for a small bonus.';
  } else {
    const sid = hitPlanter(hover.x, hover.y);
    if (sid && sessions[sid] && plants[sid]) {
      const s = sessions[sid], p = plants[sid];
      const wm = windowMult(sid);
      const sp = speciesOf(p);
      head = sessionLabel(s) + ' · ' + speciesName(sp) + ' (' + RARITY[sp.rarity].name.toLowerCase() + ') · ' + stageName(plantStage(p));
      const wait = nextStageIn(p);
      body = speciesBlurb(sp) + '\nyield ×' + yieldMult(p).toFixed(1) + ' · ' + fmt(p.sap) + ' ' + W_('sap') + ' drawn · meters ×' + meterFactor(p).toFixed(2) + (wm.m > 1 ? ' · ' + wm.why + ' ×' + wm.m : '') + (wait != null ? '\nnext stage in ' + Math.floor(wait / 60) + 'm ' + (wait % 60) + 's' : '\nnot growing: meters too low') + '\nclick to tend';
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
  const waterDrain = has('barrel') ? 0.06 : 0.09;
  const lightDrain = has('greenhouse') ? 0.075 : 0.11;
  const working = anyoneWorking();
  const power = passivePower();
  for (const [sid, p] of Object.entries(plants)) {
    const sp = speciesOf(p);
    p.water = Math.max(0, p.water - dt * waterDrain * sp.water);
    p.light = Math.max(0, p.light - dt * lightDrain * sp.light);
    p.nutrients = Math.max(0, (p.nutrients || 0) - dt * 0.09);
    // the plant grows while it is healthy; nothing else grows it
    p.grown = (p.grown || 0) + dt * 1000 * growthSpeed(p);
    // the trickle: Claude working keeps the plant alive at about a fifth of an active click rate
    const s = sessions[sid];
    if (working && s && s.status === 'working' && Date.now() - s.lastSeen < 60 * 1000) {
      let rate = TUNING.trickle * power * yieldMult(p) * meterFactor(p);
      if (!has('greenhouse') && pestsOn(sid)) rate *= 0.5;
      p.sap += rate * dt; garden.sap += rate * dt; garden.lifetime += rate * dt;
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
    if (!c.paid) { c.paid = true; earn(s.id, 8 * clickPower() * yieldMult(plants[s.id]), x, y, '🐈 purr +', 'window', 'bird'); }
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
    if (lastRain[sid] && now - lastRain[sid] < 6000) {
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
    if (theme.hat === 'wizard') { ctx.fillStyle = col([70, 50, 130], dl); ctx.beginPath(); ctx.ellipse(0, -40, 11, 3, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(-7, -40); ctx.lineTo(7, -40); ctx.lineTo(2 + Math.sin(t * 2 + seed) * 2, -60); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#ffd45c'; ctx.beginPath(); ctx.arc(0, -50, 1.6, 0, Math.PI * 2); ctx.fill(); }
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
    const k = Math.max(0.6, r.scale) * (si >= 11 ? 1.25 : 1);
    const cx = r.cx, base = r.y - 6;
    const shape = sp.shape;
    const floors = Math.min(si, 12), floorH = (shape === 'stem' ? 16 : 12) * k;
    const bw = (shape === 'stem' ? 22 : shape === 'spikes' ? 40 : shape === 'cactus' ? 24 : 34) * k;
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
    // walls, one floor at a time, narrowing a touch as they climb
    for (let f = 0; f < floors; f++) {
      const y0 = b - (f + 1) * floorH, ww = bw * (1 - f * 0.02);
      const g = ctx.createLinearGradient(cx - ww, 0, cx + ww, 0);
      g.addColorStop(0, col(wall.map((c) => Math.min(255, c + 30)), dl)); g.addColorStop(0.5, col(wall, dl)); g.addColorStop(1, col(wall.map((c) => c * 0.6), dl));
      ctx.fillStyle = g; ctx.fillRect(cx - ww, y0, ww * 2, floorH + 1);
      if (shape !== 'fronds' && shape !== 'moon') { ctx.strokeStyle = 'rgba(0,0,0,' + (0.18 * dl + 0.05).toFixed(2) + ')'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - ww, y0 + floorH); ctx.lineTo(cx + ww, y0 + floorH); ctx.stroke(); }
      // windows
      const n = shape === 'stem' ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const wx = n === 1 ? cx : cx - ww * 0.45 + i * ww * 0.9, wy = y0 + floorH * 0.5;
        const glow = lit ? 0.6 + 0.4 * Math.sin(t * 2 + f * 1.3 + i) : 0;
        ctx.fillStyle = lit ? 'rgba(255,200,110,' + (0.5 + 0.5 * glow).toFixed(2) + ')' : 'rgba(20,16,40,0.8)';
        ctx.beginPath(); ctx.roundRect(wx - 2.5 * k, wy - 4 * k, 5 * k, 7 * k, [2.5 * k, 2.5 * k, 0, 0]); ctx.fill();
        if (lit) { const gl = ctx.createRadialGradient(wx, wy, 1, wx, wy, 12 * k); gl.addColorStop(0, 'rgba(255,200,110,' + (0.35 * glow).toFixed(2) + ')'); gl.addColorStop(1, 'rgba(255,200,110,0)'); ctx.fillStyle = gl; ctx.fillRect(wx - 12 * k, wy - 12 * k, 24 * k, 24 * k); }
      }
    }
    // the floor in progress rises out of the last one
    if (floors < 12 && prog > 0.05) { const y0 = b - floors * floorH - prog * floorH * 0.6; ctx.fillStyle = col(wall, dl * 0.9, 0.7); ctx.fillRect(cx - bw * 0.9, y0, bw * 1.8, prog * floorH * 0.6 + 1); }
    const top = b - floors * floorH;
    // roof by species
    const roofY = top - (shape === 'stem' ? 30 : 22) * k;
    if (shape === 'rose' || (shape === 'branch' && sp.thorns)) {
      ctx.fillStyle = stone(100, dl); for (let i = -2; i <= 2; i++) ctx.fillRect(cx + i * bw * 0.4 - 3 * k, top - 8 * k, 6 * k, 8 * k);
      ctx.fillStyle = '#c94a3a'; ctx.beginPath(); ctx.moveTo(cx, top - 8 * k); ctx.lineTo(cx, top - 30 * k); ctx.lineTo(cx + 12 * k + Math.sin(t * 3) * 3, top - 25 * k); ctx.lineTo(cx, top - 20 * k); ctx.closePath(); ctx.fill();
    } else if (shape === 'cactus') {
      ctx.fillStyle = col([20, 16, 30], dl); ctx.beginPath(); ctx.moveTo(cx - bw, top); ctx.lineTo(cx + bw, top); ctx.lineTo(cx, top - 40 * k); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,80,60,' + (0.5 + 0.4 * Math.sin(t * 3)).toFixed(2) + ')'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx - bw * 0.5, top - 10 * k); ctx.lineTo(cx, top - 32 * k); ctx.stroke();
    } else if (shape === 'spikes') {
      for (let i = -1; i <= 1; i++) { ctx.fillStyle = col([170, 130, 230], dl, 0.9); ctx.beginPath(); ctx.moveTo(cx + i * bw * 0.6 - 8 * k, top); ctx.lineTo(cx + i * bw * 0.6 + 8 * k, top); ctx.lineTo(cx + i * bw * 0.6, top - (28 - Math.abs(i) * 10) * k); ctx.closePath(); ctx.fill(); }
    } else if (shape === 'fronds' || shape === 'moon') {
      ctx.fillStyle = shape === 'moon' ? col([225, 228, 245], dl) : col([180, 230, 255], dl, 0.9); ctx.beginPath(); ctx.moveTo(cx - bw, top); ctx.lineTo(cx + bw, top); ctx.lineTo(cx, roofY - 10 * k); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.moveTo(cx - bw * 0.6, top); ctx.lineTo(cx - bw * 0.2, top); ctx.lineTo(cx - 2 * k, roofY - 6 * k); ctx.closePath(); ctx.fill();
    } else {
      // slate cone with an overhang
      ctx.fillStyle = col(shape === 'stem' ? [200, 150, 60] : [70, 60, 100], dl); ctx.beginPath(); ctx.moveTo(cx - bw - 5 * k, top); ctx.lineTo(cx + bw + 5 * k, top); ctx.lineTo(cx, roofY); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,' + (0.12 * dl).toFixed(2) + ')'; ctx.beginPath(); ctx.moveTo(cx - bw - 5 * k, top); ctx.lineTo(cx - bw * 0.3, top); ctx.lineTo(cx - 2 * k, roofY + 4 * k); ctx.closePath(); ctx.fill();
    }
    const spireTip = shape === 'cactus' ? top - 40 * k : shape === 'spikes' ? top - 28 * k : shape === 'rose' ? top - 30 * k : roofY - (shape === 'fronds' || shape === 'moon' ? 10 * k : 0);
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
  THEMES.wizard = {
    id: 'wizard', name: 'Wizard tower', hat: 'wizard', icon: '🔮', price: 10000000, firefly: 'rgba(180,230,255,',
    blurb: 'A tower that gains a floor per stage on a rune-carved plinth. Mana, runes, ether, starlight, and ley power; wands and grimoires in the shop; imps, wisps, an observatory, and apprentices in pointy hats.',
    words: {
      title: '🔮 Tower of Claude', place: 'tower grounds', sap: 'mana', seed: 'rune', seeds: 'runes', plant: 'tower', plants: 'towers',
      harvest: 'Ascend', harvested: 'ascended', nothingToHarvest: 'nothing to ascend', sprouted: 'was founded',
      water: 'ether', light: 'starlight', nutrients: 'ley power', sunbeam: 'arcane beam', puddle: 'mana pool', greenhouse: 'observatory',
      crowLanded: 'an imp appeared', crowTitle: 'An imp', birdTitle: 'A passing spirit', birdFloat: '👻 +',
      beeTitle: 'A wisp', beeTip: 'Click it to bind it to the tower for a bonus before it drifts off.', beeVisit: 'a wisp is circling', beeFloat: '✨ bound +',
      shopTitle: 'Arcane shop', shopTab: 'Grounds',
      stages: ['foundation', 'cellar', 'ground floor', 'first floor', 'second floor', 'lit windows', 'crystal spire', 'floating stones', 'storm ring', 'glowing', 'enchanted', 'colossal', 'ancient', 'mythic'],
    },
    items: {
      trowel: { name: 'Wand', icon: '🪄' }, can: { name: 'Grimoire', icon: '📖' }, shears: { name: 'Staff', icon: '🔱' }, trellis: { name: 'Crystal ball', icon: '🔮' }, hive: { name: 'Familiar', icon: '🐈‍⬛' },
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
    draw: { ground: wizGround, planter: wizPlanter, plant: wizTower, greenhouse: wizObservatory, pests: wizImps, critters: wizWisps, upgrades: wizUpgrades, ambient: wizAmbient },
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

window.__garden = { critters, particles, plants, garden, ambient, spawnAmbient, deskState, openDesk, sessions: () => sessions, holds: () => pendingHolds, holding: () => holding, letters: () => letters, focused, holdRate, celebrateCommand, hourglass, desk, THEMES, applyTheme, theme: () => theme, hold: (on) => { holding = on && focused() ? { sid: focused().id, x: W / 2, y: H * 0.7, acc: 0 } : null; } };   // debugging handle
updateHud();
requestAnimationFrame(frame);
})();
