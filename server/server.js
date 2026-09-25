'use strict';
// Garden of Claude - local event server.
// Receives Claude Code hook payloads on POST /hook, streams them to the game
// page over Server-Sent Events, serves the game, holds the pause flag, and
// turns each finished turn into a "letter" the user can reply to from the game.
// Zero dependencies: run with `node server/server.js`.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.GARDEN_PORT) || 47831;
const HOST = '127.0.0.1';
const ROOT = path.join(__dirname, '..');
const GAME_DIR = path.join(ROOT, 'game');
const LOG_DIR = path.join(ROOT, 'logs');
const MAX_RECENT = 200;
const MAX_LETTERS = 40;
const MAX_BODY = 8 * 1024 * 1024;
const TRIM_STRING = 600;
// How long a finished turn waits for a reply from the game before it really ends.
// 0 means "until you reply, release, or type in the app" (bounded only by the hook's own timeout).
const HOLD_MS = process.env.GARDEN_HOLD_MS !== undefined ? Number(process.env.GARDEN_HOLD_MS) : 0;
// Fraction of the context window at which the day ends (auto-compact is expected).
const COMPACT_AT = Number(process.env.GARDEN_COMPACT_AT) || 0.9;
const WINDOW_OVERRIDE = Number(process.env.GARDEN_CONTEXT_WINDOW) || 0;

function windowFor(model) {
  if (WINDOW_OVERRIDE) return WINDOW_OVERRIDE;
  if (!model) return 200000;
  if (/\[1m\]|fable|mythos|opus-5|opus-4-[678]|sonnet-5|sonnet-4-6/i.test(model)) return 1000000;
  return 200000;
}

const state = { paused: false, sessions: {}, recent: [], letters: [] };
const clients = new Set();
const pending = new Map(); // session_id -> { resolve, timer, until, letterId }
const queued = new Map();  // session_id -> text written at the desk while Claude was busy
const LETTERS_FILE = path.join(LOG_DIR, 'letters.json');

function loadLetters() {
  try {
    const list = JSON.parse(fs.readFileSync(LETTERS_FILE, 'utf8'));
    if (Array.isArray(list)) state.letters = list.slice(-MAX_LETTERS);
  } catch { /* first run */ }
}
let saveTimer = null;
function saveLetters() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.writeFileSync(LETTERS_FILE, JSON.stringify(state.letters)); } catch { /* best effort */ }
  }, 300);
}

// ---------- helpers ----------

function trim(value, depth = 0) {
  if (typeof value === 'string') {
    return value.length > TRIM_STRING
      ? value.slice(0, TRIM_STRING) + ' ... [+' + (value.length - TRIM_STRING) + ' chars]'
      : value;
  }
  if (Array.isArray(value)) return depth > 6 ? '[...]' : value.slice(0, 50).map((v) => trim(v, depth + 1));
  if (value && typeof value === 'object') {
    if (depth > 6) return '{...}';
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = trim(v, depth + 1);
    return out;
  }
  return value;
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function broadcast(obj) {
  const line = 'data: ' + JSON.stringify(obj) + '\n\n';
  for (const res of clients) {
    try { res.write(line); } catch { clients.delete(res); }
  }
}

function pendingSummary() {
  const out = {};
  for (const [sid, p] of pending) out[sid] = { until: p.until, letterId: p.letterId };
  return out;
}

function snapshot() {
  const q = {};
  for (const [sid, text] of queued) q[sid] = text.slice(0, 120);
  return { paused: state.paused, sessions: state.sessions, pending: pendingSummary(), queued: q, holdMs: HOLD_MS, compactAt: COMPACT_AT };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { req.destroy(); reject(new Error('body too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function logEvent(ev) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    fs.appendFile(path.join(LOG_DIR, 'events-' + day + '.jsonl'), JSON.stringify(ev) + '\n', () => {});
  } catch { /* logging is best-effort */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- transcript reading ----------

function readTail(file, maxBytes = 2 * 1024 * 1024) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    let text = buf.toString('utf8');
    if (len < size) text = text.slice(text.indexOf('\n') + 1);
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

// Current context size = what the latest request carried in: fresh input plus everything cached.
function contextFrom(transcriptPath) {
  const lines = readTail(transcriptPath, 3 * 1024 * 1024).split('\n');
  let ctx = null;
  let prompt = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    let e; try { e = JSON.parse(lines[i]); } catch { continue; }
    // Everything above a compaction boundary is gone from the window; until the
    // first reply after it reports real usage, the context is as good as empty.
    if (e.type === 'system' && e.subtype === 'compact_boundary') {
      if (!ctx) ctx = { tokens: 0, model: '', window: windowFor(''), at: Date.now(), fresh: true };
      break;
    }
    if (e.isCompactSummary) continue;
    if (!ctx && e.type === 'assistant' && e.message && e.message.usage) {
      const u = e.message.usage;
      const tokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      const model = e.message.model || '';
      ctx = { tokens, model, window: windowFor(model), at: Date.now() };
    }
    if (!prompt) { const p = promptText(e); if (p) prompt = p; }
    if (ctx && prompt) break;
  }
  if (ctx) ctx.prompt = prompt;
  return ctx;
}

const contextChecked = new Map();
function refreshContext(ev) {
  const s = state.sessions[ev.session_id];
  if (!s || !ev.transcript_path) return;
  if (Date.now() - (contextChecked.get(ev.session_id) || 0) < 2000) return;
  contextChecked.set(ev.session_id, Date.now());
  try {
    const c = contextFrom(ev.transcript_path);
    if (c) {
      if (c.prompt && !s.prompt) s.prompt = c.prompt.slice(0, 400);
      delete c.prompt;
      if (c.fresh) { c.model = (s.context && s.context.model) || c.model; c.window = windowFor(c.model); delete c.fresh; }
      s.context = c; s.night = false;
    }
  } catch { /* transcript missing or partial */ }
}

function blocksOf(msg) {
  const c = msg && msg.content;
  if (typeof c === 'string') return [{ type: 'text', text: c }];
  return Array.isArray(c) ? c : [];
}

const GARDEN_MARKER = /replied from (Garden of Claude|Claude Garden)/;
const GARDEN_PREFACE_END = 'continue the conversation with them:';

// The user's words in a transcript entry: a real chat prompt, or a reply that
// came through the garden (recorded as a meta "Stop hook feedback" entry).
function promptText(e) {
  if (!e || e.type !== 'user') return null;
  const blocks = blocksOf(e.message);
  if (blocks.some((b) => b.type === 'tool_result')) return null;
  const text = blocks.filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n').trim();
  if (!text) return null;
  if (e.isMeta) {
    if (!GARDEN_MARKER.test(text)) return null;
    const i = text.indexOf(GARDEN_PREFACE_END);
    return (i >= 0 ? text.slice(i + GARDEN_PREFACE_END.length) : text).trim();
  }
  return text;
}

// Everything Claude said since the last real user prompt, split into the
// closing message ("final") and anything said earlier in the turn ("earlier").
function extractLetter(transcriptPath) {
  const lines = readTail(transcriptPath).split('\n').filter(Boolean);
  const entries = [];
  for (const line of lines) { try { entries.push(JSON.parse(line)); } catch { /* skip partial */ } }

  let lastPrompt = -1;
  let promptStr = '';
  for (let i = 0; i < entries.length; i++) {
    const p = promptText(entries[i]);
    if (p !== null) { lastPrompt = i; promptStr = p; }
  }

  const groups = [[]];
  let usage = null;
  let model = '';
  for (let i = lastPrompt + 1; i < entries.length; i++) {
    const e = entries[i];
    if (e.type === 'assistant') {
      if (e.message && e.message.usage) usage = e.message.usage;
      if (e.message && e.message.model) model = e.message.model;
      for (const b of blocksOf(e.message)) {
        if (b.type === 'text' && b.text && b.text.trim()) groups[groups.length - 1].push(b.text);
        if (b.type === 'tool_use' && groups[groups.length - 1].length) groups.push([]);
      }
    } else if (e.type === 'user' && blocksOf(e.message).some((b) => b.type === 'tool_result')) {
      if (groups[groups.length - 1].length) groups.push([]);
    }
  }
  const nonEmpty = groups.filter((g) => g.length);
  const final = nonEmpty.length ? nonEmpty[nonEmpty.length - 1].join('\n\n') : '';
  const earlier = nonEmpty.slice(0, -1).map((g) => g.join('\n\n'));
  return { final, earlier, prompt: promptStr, usage, model };
}

// ---------- readable summaries of what Claude did ----------
const baseName = (p) => (typeof p === 'string' ? p.split(/[\\/]/).filter(Boolean).pop() || p : '');
const firstLine = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const lineCount = (s) => (s ? String(s).split('\n').length : 0);

function summarize(payload) {
  const t = payload.tool_name || '';
  const inp = payload.tool_input || {};
  const r = payload.tool_response;
  const resp = r && typeof r === 'object' ? r : {};
  const rs = typeof r === 'string' ? r : '';
  try {
    if (payload.hook_event_name === 'PostToolUseFailure') {
      return { icon: 'fail', text: prettyToolName(t) + ' failed' + (inp.command ? ': ' + firstLine(inp.command, 40) : inp.file_path ? ' on ' + baseName(inp.file_path) : ''), detail: firstLine(payload.error || resp.error || rs, 90) };
    }
    if (/^(Edit|MultiEdit)$/.test(t)) {
      const oldS = inp.old_string || '', newS = inp.new_string || '';
      const changed = newS.split('\n').find((l) => l.trim() && !oldS.includes(l.trim())) || newS.split('\n').find((l) => l.trim()) || '';
      return { icon: 'edit', text: 'edited ' + baseName(inp.file_path) + ': −' + lineCount(oldS) + ' +' + lineCount(newS) + ' lines', detail: firstLine(changed, 80) };
    }
    if (t === 'Write') return { icon: 'write', text: (resp.type === 'update' ? 'rewrote ' : 'wrote ') + baseName(inp.file_path) + ' (' + lineCount(inp.content) + ' lines)', detail: firstLine((inp.content || '').split('\n').find((l) => l.trim()) || '', 80) };
    if (t === 'NotebookEdit') return { icon: 'edit', text: 'edited notebook ' + baseName(inp.notebook_path), detail: '' };
    if (t === 'Read') {
      const n = (resp.file && (resp.file.numLines || resp.file.totalLines)) || lineCount(resp.file && resp.file.content) || 0;
      return { icon: 'read', text: 'read ' + baseName(inp.file_path) + (n ? ' (' + n + ' lines)' : ''), detail: inp.offset ? 'from line ' + inp.offset : '' };
    }
    if (t === 'Grep') {
      const files = resp.numFiles != null ? resp.numFiles : Array.isArray(resp.filenames) ? resp.filenames.length : null;
      const m = resp.numMatches != null ? resp.numMatches : resp.numLines;
      const what = files != null ? files + ' file' + (files === 1 ? '' : 's') : m != null ? m + ' match' + (m === 1 ? '' : 'es') : 'done';
      return { icon: 'search', text: 'searched “' + firstLine(inp.pattern, 30) + '” → ' + what, detail: (Array.isArray(resp.filenames) ? resp.filenames : []).slice(0, 4).map(baseName).join(', ') };
    }
    if (t === 'Glob') {
      const n = resp.numFiles != null ? resp.numFiles : Array.isArray(resp.filenames) ? resp.filenames.length : null;
      return { icon: 'search', text: 'listed ' + (n != null ? n + ' file' + (n === 1 ? '' : 's') : 'files') + ' matching ' + firstLine(inp.pattern, 30), detail: '' };
    }
    if (/^(Bash|PowerShell)$/.test(t)) {
      const out = (resp.stdout != null ? String(resp.stdout) : rs).trim();
      const err = String(resp.stderr || '').trim();
      const code = resp.exitCode != null ? resp.exitCode : resp.exit_code != null ? resp.exit_code : resp.returnCode;
      const failed = Boolean(resp.interrupted) || (code != null && code !== 0);
      const last = out.split('\n').filter((l) => l.trim()).pop() || err.split('\n').filter((l) => l.trim()).pop() || '';
      return { icon: failed ? 'fail' : 'shell', text: (failed ? 'command failed: ' : 'ran ') + firstLine(inp.command, 48), detail: firstLine(last, 90) || (failed ? '' : 'no output') };
    }
    if (/^(Agent|Task)$/.test(t)) {
      const text = typeof r === 'string' ? r : Array.isArray(resp.content) ? resp.content.map((c) => c.text || '').join(' ') : resp.result || resp.text || '';
      return { icon: 'agent', text: 'helper finished: ' + firstLine(inp.description || inp.prompt, 48), detail: firstLine(text, 110) };
    }
    if (t === 'Workflow') return { icon: 'agent', text: 'workflow finished', detail: '' };
    if (t === 'WebSearch') return { icon: 'web', text: 'searched the web for “' + firstLine(inp.query, 40) + '”', detail: '' };
    if (t === 'WebFetch') return { icon: 'web', text: 'fetched ' + firstLine(inp.url, 60), detail: firstLine(inp.prompt, 80) };
    if (t === 'AskUserQuestion') return { icon: 'ask', text: 'asked you: ' + firstLine(inp.questions && inp.questions[0] && inp.questions[0].question, 70), detail: '' };
    if (t === 'Skill') return { icon: 'tool', text: 'loaded the ' + firstLine(inp.skill, 30) + ' skill', detail: '' };
    if (t.startsWith('mcp__')) {
      const parts = t.split('__').filter(Boolean);
      const server = (parts[1] || '').replace(/^claude[-_]?/i, '').replace(/[-_]+/g, ' ').toLowerCase();
      const arg = inp.url || inp.query || inp.action || inp.text || inp.command || '';
      return { icon: 'tool', text: 'used ' + server + ' ' + (parts[2] || '').replace(/_/g, ' ') + (arg ? ': ' + firstLine(arg, 40) : ''), detail: '' };
    }
    return { icon: 'tool', text: 'used ' + t, detail: '' };
  } catch {
    return { icon: 'tool', text: 'used ' + t, detail: '' };
  }
}
function prettyToolName(t) {
  if (!t) return 'a tool';
  if (t.startsWith('mcp__')) { const parts = t.split('__').filter(Boolean); return (parts[1] || '').replace(/^claude[-_]?/i, '').replace(/[-_]+/g, ' ').toLowerCase() + ' ' + (parts[2] || '').replace(/_/g, ' '); }
  return t;
}

// Claude's own narration: assistant text entries in the transcript that we
// have not shown yet. The first look at a transcript marks history as seen so
// old turns do not replay.
const noteSeen = new Map();
const MAX_NOTES = 60;
state.notes = [];
function notesFrom(transcriptPath, sid) {
  const lines = readTail(transcriptPath, 256 * 1024).split('\n');
  const fresh = !noteSeen.has(sid);
  const seen = noteSeen.get(sid) || new Set();
  const out = [];
  for (const line of lines) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== 'assistant' || !e.uuid || seen.has(e.uuid)) continue;
    const blocks = blocksOf(e.message);
    const texts = blocks.filter((b) => b.type === 'text' && b.text && b.text.trim()).map((b) => b.text.trim());
    // Between tool calls the model's progress notes arrive as short thinking summaries.
    const thoughts = blocks.filter((b) => b.type === 'thinking' && b.thinking && b.thinking.trim()).map((b) => b.thinking.trim());
    if (!texts.length && !thoughts.length) { continue; }
    seen.add(e.uuid);
    if (fresh) continue;
    const at = Date.parse(e.timestamp || '') || Date.now();
    if (texts.length) out.push({ session_id: sid, uuid: e.uuid, kind: 'text', text: texts.join('\n\n'), at });
    else out.push({ session_id: sid, uuid: e.uuid, kind: 'thought', text: thoughts.join('\n\n'), at });
  }
  noteSeen.set(sid, seen.size > 600 ? new Set([...seen].slice(-300)) : seen);
  return out;
}
function publishNotes(payload) {
  if (!payload.transcript_path || !payload.session_id) return;
  let notes = [];
  try { notes = notesFrom(payload.transcript_path, payload.session_id); } catch { return; }
  for (const n of notes) {
    n.cwd = payload.cwd || '';
    state.notes.push(n);
    if (state.notes.length > MAX_NOTES) state.notes.splice(0, state.notes.length - MAX_NOTES);
    broadcast({ type: 'note', note: n, ...snapshot() });
  }
}

// Does the closing message actually ask the user something?
function needsAnswer(final) {
  if (!final) return false;
  const paras = final.replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const tail = paras.slice(-2).join('\n');
  if (/\?\s*$/.test(tail) || /\?(\s*\n|\s*$)/.test(tail)) return true;
  return /\b(let me know|tell me|your call|which (one|would|do)|do you want|would you (like|rather|prefer)|should i|want me to|say (the word|go)|reply (from|when|with)|pick one|choose)\b/i.test(tail);
}

async function buildLetter(payload) {
  let body = { final: '', earlier: [], prompt: '', usage: null, model: '' };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (payload.transcript_path) body = extractLetter(payload.transcript_path);
    } catch (err) {
      body.error = String(err && err.message || err);
    }
    if (body.final) break;
    await sleep(250);
  }
  const letter = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    session_id: payload.session_id,
    cwd: payload.cwd || '',
    at: Date.now(),
    prompt: body.prompt,
    final: body.final,
    earlier: body.earlier,
    model: body.model,
    usage: body.usage,
    error: body.error || '',
    needsAnswer: needsAnswer(body.final),
    replied: false,
    reply: '',
    released: false,
  };
  state.letters.push(letter);
  if (state.letters.length > MAX_LETTERS) state.letters.splice(0, state.letters.length - MAX_LETTERS);
  saveLetters();
  return letter;
}

// Hold a Stop hook open until the game replies, releases, the user types in the
// app (seen as a queued message in the transcript), or the hold expires.
function holdFor(sessionId, letterId, transcriptPath) {
  return new Promise((resolve) => {
    const existing = pending.get(sessionId);
    if (existing) { clearTimeout(existing.timer); existing.resolve(null); }
    const timer = HOLD_MS > 0 ? setTimeout(() => finishHold(sessionId, null), HOLD_MS) : null;
    pending.set(sessionId, { resolve, timer, until: HOLD_MS > 0 ? Date.now() + HOLD_MS : null, letterId, transcriptPath, since: Date.now() });
    ensureQueueWatcher();
  });
}

function finishHold(sessionId, result) {
  const p = pending.get(sessionId);
  if (!p) return false;
  if (p.timer) clearTimeout(p.timer);
  pending.delete(sessionId);
  p.resolve(result);
  broadcast({ type: 'state', ...snapshot() });
  return true;
}

// While any hold is open, watch each session's transcript for a message the
// user queued in the app; if one appears, end the hold so that message can run.
let queueWatcher = null;
function ensureQueueWatcher() {
  if (queueWatcher) return;
  queueWatcher = setInterval(() => {
    if (!pending.size) { clearInterval(queueWatcher); queueWatcher = null; return; }
    for (const [sid, p] of [...pending]) {
      if (!p.transcriptPath) continue;
      try {
        const lines = readTail(p.transcriptPath, 64 * 1024).split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
          let e; try { e = JSON.parse(lines[i]); } catch { continue; }
          if (e.type !== 'queue-operation') continue;
          const ts = Date.parse(e.timestamp || '');
          if (!(ts > p.since - 1500)) break;
          if (e.operation === 'enqueue') { finishHold(sid, null); break; }
        }
      } catch { /* transcript unreadable right now */ }
    }
  }, 1500);
}

// ---------- session state machine ----------

const ATTENTION_TYPES = new Set(['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog']);
const TURN_OVER_TYPES = new Set(['idle_prompt', 'agent_needs_input', 'agent_completed']);

function touchSession(ev) {
  const id = ev.session_id;
  if (!id) return;
  if (ev.hook_event_name === 'SessionEnd') { delete state.sessions[id]; finishHold(id, null); return; }
  // A new prompt or tool call means the held turn is over (interrupted or answered in the app).
  if ((ev.hook_event_name === 'UserPromptSubmit' || ev.hook_event_name === 'PreToolUse') && pending.has(id)) finishHold(id, null);
  const s = state.sessions[id] || (state.sessions[id] = { id, cwd: ev.cwd || '', status: 'idle', firstSeen: Date.now(), note: '' });
  if (ev.cwd) s.cwd = ev.cwd;
  s.lastSeen = Date.now();
  s.lastEvent = ev.hook_event_name;
  switch (ev.hook_event_name) {
    case 'SessionStart':
      s.status = 'idle'; s.note = '';
      if (ev.source === 'compact' || ev.source === 'clear') { s.night = false; s.context = { tokens: 0, model: (s.context && s.context.model) || '', window: (s.context && s.context.window) || windowFor(''), at: Date.now() }; s.dawn = Date.now(); }
      break;
    case 'PreCompact':
      s.night = true; s.note = 'compacting'; break;
    case 'PostCompact':
      s.night = false; s.note = '';
      s.context = { tokens: 0, model: (s.context && s.context.model) || '', window: (s.context && s.context.window) || windowFor(''), at: Date.now() };
      s.dawn = Date.now();
      break;
    case 'UserPromptSubmit':
      s.status = 'working'; s.note = '';
      if (typeof ev.prompt === 'string' && ev.prompt.trim()) { s.prompt = ev.prompt.trim().slice(0, 400); s.promptAt = Date.now(); }
      break;
    case 'PostToolUse':
    case 'PostToolUseFailure':
      s.status = 'working'; s.note = ''; s.pendingTool = null; break;
    case 'SubagentStart':
    case 'SubagentStop':
      // Compaction runs a helper agent after the turn is over; only a prompt or a tool call starts a turn.
      if (s.status === 'idle' || s.status === 'your_turn') break;
      s.status = 'working'; s.note = ''; break;
    case 'PreToolUse': {
      const inp = ev.tool_input || {};
      const summary = inp.command || inp.pattern || inp.file_path || inp.url || inp.query || inp.description || inp.question || '';
      s.pendingTool = { name: ev.tool_name || '', text: String(summary).replace(/\s+/g, ' ').slice(0, 160), since: Date.now() };
      if (ev.tool_name === 'AskUserQuestion') { s.status = 'needs_you'; s.note = 'Claude is asking you a question'; }
      else { s.status = 'working'; s.note = ''; }
      break;
    }
    case 'Notification': {
      const t = ev.notification_type || '';
      const msg = ev.message || '';
      if (t === 'quota_auto_resume_fired') { s.status = 'working'; s.note = ''; }
      else if (t.startsWith('quota_auto_resume') || /usage limit|rate limit/i.test(msg)) { s.status = 'limit'; s.note = msg || 'Waiting for the usage limit to reset'; }
      else if (ATTENTION_TYPES.has(t) || /permission/i.test(msg)) { s.status = 'needs_you'; s.note = msg || 'Claude needs permission'; }
      else if (TURN_OVER_TYPES.has(t) || /waiting for your input/i.test(msg)) { s.status = 'your_turn'; s.note = msg; }
      break;
    }
    case 'Stop':
      s.status = 'your_turn'; s.note = 'Claude finished its turn'; break;
    default:
      break;
  }
}

// ---------- routes ----------

const PAUSE_REASON =
  'The user pressed Pause in their Garden of Claude overlay. Do not run any more tools. ' +
  'Briefly say that you are paused and end your turn, then wait for the next message from the user.';

function replyReason(text) {
  return 'The user replied from Garden of Claude, their companion overlay, instead of the chat box. ' +
    'Treat the following as their next message and continue the conversation with them:\n\n' + text;
}

function lateNoteContext(text) {
  return 'Before this message, the user wrote the following at the desk in Garden of Claude, their companion overlay, ' +
    'while no turn was running, so it was never delivered. Read it as their earlier message and answer both:\n\n' + text;
}

async function handleHook(req, res) {
  let payload = null;
  try { payload = JSON.parse(await readBody(req)); } catch { /* never fail the hook */ }
  if (!payload || typeof payload !== 'object') { res.writeHead(200); res.end(); return; }

  const ev = trim(payload);
  ev.received_at = Date.now();
  if (/^(PostToolUse|PostToolUseFailure)$/.test(payload.hook_event_name)) ev.summary = summarize(payload);
  touchSession(ev);
  if (/^(PostToolUse|Stop|UserPromptSubmit|SubagentStop)$/.test(payload.hook_event_name)) refreshContext(payload);
  if (/^(PreToolUse|PostToolUse|Stop|UserPromptSubmit)$/.test(payload.hook_event_name)) publishNotes(payload);
  state.recent.push(ev);
  if (state.recent.length > MAX_RECENT) state.recent.splice(0, state.recent.length - MAX_RECENT);
  logEvent(ev);
  broadcast({ type: 'hook', event: ev, ...snapshot() });

  // Pause gate: refuse the tool call while paused.
  if (payload.hook_event_name === 'PreToolUse' && state.paused) {
    send(res, 200, JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: PAUSE_REASON },
    }));
    return;
  }

  // A desk note that never found a turn to ride on goes in with the next prompt from the app.
  if (payload.hook_event_name === 'UserPromptSubmit' && payload.session_id && queued.has(payload.session_id)) {
    const sid = payload.session_id;
    const text = queued.get(sid); queued.delete(sid);
    broadcast({ type: 'state', delivered: { session_id: sid, text }, ...snapshot() });
    send(res, 200, JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: lateNoteContext(text) },
    }));
    return;
  }

  // Mailbox: turn the finished turn into a letter and hold for a reply, but
  // only while a game page is actually open to reply from.
  if (payload.hook_event_name === 'Stop' && payload.session_id) {
    const sid = payload.session_id;
    const letter = await buildLetter(payload);
    if (clients.size === 0) {
      letter.released = true; saveLetters();
      broadcast({ type: 'letter', letter, held: false, ...snapshot() });
      res.writeHead(200); res.end(); return;
    }
    // Make sure the closing words reached the board even if they landed in the transcript late.
    publishNotes(payload);
    // A note written at the desk while Claude was busy goes straight back as the next message.
    if (queued.has(sid)) {
      const text = queued.get(sid); queued.delete(sid);
      letter.replied = true; letter.reply = text; saveLetters();
      if (state.sessions[sid]) { state.sessions[sid].prompt = text.slice(0, 400); state.sessions[sid].promptAt = Date.now(); }
      broadcast({ type: 'letter', letter, held: false, ...snapshot() });
      send(res, 200, JSON.stringify({ decision: 'block', reason: replyReason(text) }));
      return;
    }
    // Register the hold first so the page learns about it in the same message as the letter.
    const holdPromise = holdFor(sid, letter.id, payload.transcript_path);
    res.on('close', () => { if (!res.writableFinished) finishHold(sid, null); });
    broadcast({ type: 'letter', letter, held: true, ...snapshot() });
    const result = await holdPromise;
    if (result && result.reply) {
      letter.replied = true; letter.reply = result.reply; saveLetters();
      broadcast({ type: 'letter', letter, held: false, ...snapshot() });
      send(res, 200, JSON.stringify({ decision: 'block', reason: replyReason(result.reply) }));
      return;
    }
    letter.released = true; saveLetters();
    broadcast({ type: 'letter', letter, held: false, ...snapshot() });
    if (!res.writableFinished) { res.writeHead(200); res.end(); }
    return;
  }

  res.writeHead(200);
  res.end();
}

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write('retry: 2000\n\n');
  res.write('data: ' + JSON.stringify({ type: 'snapshot', recent: state.recent.slice(-60), letters: state.letters.slice(-20), notes: state.notes.slice(-30), ...snapshot() }) + '\n\n');
  clients.add(res);
  const keepalive = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 20000);
  req.on('close', () => { clearInterval(keepalive); clients.delete(res); });
}

let resumeTimer = null;
function setPaused(paused, seconds) {
  state.paused = Boolean(paused);
  if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
  if (state.paused && seconds > 0) {
    resumeTimer = setTimeout(() => { resumeTimer = null; setPaused(false); }, seconds * 1000);
  }
  broadcast({ type: 'state', ...snapshot() });
}

async function handlePause(req, res) {
  try {
    const body = JSON.parse((await readBody(req)) || '{}');
    setPaused(body.paused, Number(body.seconds) || 0);
  } catch {
    setPaused(!state.paused, 0);
  }
  send(res, 200, JSON.stringify(snapshot()));
}

async function handleReply(req, res) {
  let body = {};
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch { /* fall through */ }
  const text = String(body.text || '').trim();
  const sid = String(body.session_id || '');
  if (!text) { send(res, 400, JSON.stringify({ error: 'empty reply' })); return; }
  if (!pending.has(sid)) {
    if (body.queue && state.sessions[sid]) {
      // Claude is busy: keep the note and hand it over the moment this turn ends.
      queued.set(sid, text);
      broadcast({ type: 'state', ...snapshot() });
      send(res, 200, JSON.stringify({ ok: true, queued: true }));
      return;
    }
    send(res, 409, JSON.stringify({ error: 'Claude is not reachable right now; write in the app' }));
    return;
  }
  if (state.sessions[sid]) { state.sessions[sid].prompt = text.slice(0, 400); state.sessions[sid].promptAt = Date.now(); }
  finishHold(sid, { reply: text });
  send(res, 200, JSON.stringify({ ok: true }));
}

// The game posts closed per-minute economy buckets here so they can be analysed outside the browser.
async function handleEcon(req, res) {
  let body = null;
  try { body = JSON.parse((await readBody(req)) || 'null'); } catch { /* ignore */ }
  if (body && typeof body === 'object') {
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      const day = new Date().toISOString().slice(0, 10);
      const rows = Array.isArray(body) ? body : [body];
      fs.appendFile(path.join(LOG_DIR, 'economy-' + day + '.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', () => {});
    } catch { /* best effort */ }
  }
  send(res, 200, JSON.stringify({ ok: true }));
}

async function handleUnqueue(req, res) {
  let body = {};
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch { /* fall through */ }
  const ok = queued.delete(String(body.session_id || ''));
  broadcast({ type: 'state', ...snapshot() });
  send(res, 200, JSON.stringify({ ok }));
}

// ---------- shared save: one garden for every browser ----------
// The last client to report real input (a click or a purchase) is the writer;
// others mirror it, so opening the game in a second browser never forks the save.
const SAVE_FILE = path.join(LOG_DIR, 'save.json');
let save = null;
try { save = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8')); } catch { save = null; }
let saveTimerHandle = null;
function persistSave() {
  if (saveTimerHandle) return;
  saveTimerHandle = setTimeout(() => {
    saveTimerHandle = null;
    try { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.writeFileSync(SAVE_FILE, JSON.stringify(save)); } catch { /* best effort */ }
  }, 500);
}
async function handleSave(req, res) {
  if (req.method === 'GET') { send(res, 200, JSON.stringify(save || null)); return; }
  let body = null;
  try { body = JSON.parse(await readBody(req)); } catch { /* ignore */ }
  if (!body || typeof body !== 'object' || !body.clientId) { send(res, 400, JSON.stringify({ error: 'bad save' })); return; }
  const writer = save && save.writer;
  const stale = writer && writer !== body.clientId && save && Date.now() - save.savedAt < 30000;
  if (stale && !body.claim) { send(res, 409, JSON.stringify({ error: 'another window is playing', writer })); return; }
  save = { garden: body.garden, plants: body.plants, ledger: body.ledger, writer: body.clientId, savedAt: Date.now() };
  persistSave();
  broadcast({ type: 'save', writer: body.clientId, savedAt: save.savedAt });
  send(res, 200, JSON.stringify({ ok: true, writer: body.clientId }));
}

async function handleLetterDelete(req, res) {
  let body = {};
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch { /* fall through */ }
  const held = new Set([...pending.values()].map((p) => p.letterId));
  if (body.all) state.letters = state.letters.filter((l) => held.has(l.id));
  else state.letters = state.letters.filter((l) => l.id !== String(body.id || '') || held.has(l.id));
  saveLetters();
  broadcast({ type: 'letters', letters: state.letters.slice(-20), ...snapshot() });
  send(res, 200, JSON.stringify({ ok: true, count: state.letters.length }));
}

// The page calls this while the user is reading or typing so a timed hold never expires under them.
async function handleTouch(req, res) {
  let body = {};
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch { /* fall through */ }
  const p = pending.get(String(body.session_id || ''));
  if (p && HOLD_MS > 0) {
    clearTimeout(p.timer);
    p.timer = setTimeout(() => finishHold(body.session_id, null), HOLD_MS);
    p.until = Date.now() + HOLD_MS;
    broadcast({ type: 'state', ...snapshot() });
  }
  send(res, 200, JSON.stringify({ ok: Boolean(p) }));
}

// Quit from the game: end any held turn cleanly so Claude is not left blocked,
// write the save, tell every page, then stop. The relay starts the server again
// at the next SessionStart, so this is "off until next time", not "removed".
function handleQuit(req, res) {
  for (const sid of [...pending.keys()]) finishHold(sid, null);
  if (saveTimerHandle) { clearTimeout(saveTimerHandle); saveTimerHandle = null; }
  try { if (save) { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.writeFileSync(SAVE_FILE, JSON.stringify(save)); } } catch { /* best effort */ }
  broadcast({ type: 'quit' });
  send(res, 200, JSON.stringify({ ok: true }));
  setTimeout(() => {
    for (const c of clients) { try { c.end(); } catch { /* closed */ } }
    process.exit(0);
  }, 400);
}

async function handleRelease(req, res) {
  let body = {};
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch { /* fall through */ }
  const ok = finishHold(String(body.session_id || ''), null);
  send(res, 200, JSON.stringify({ ok }));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

function handleStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.normalize(path.join(GAME_DIR, rel));
  if (!file.startsWith(GAME_DIR)) { send(res, 403, 'forbidden', 'text/plain'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { send(res, 404, 'not found', 'text/plain'); return; }
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://' + HOST + ':' + PORT);
  if (req.method === 'OPTIONS') { send(res, 204, ''); return; }
  if (req.method === 'POST' && url.pathname === '/hook') return handleHook(req, res);
  if (req.method === 'GET' && url.pathname === '/events') return handleEvents(req, res);
  if (req.method === 'POST' && url.pathname === '/pause') return handlePause(req, res);
  if (req.method === 'POST' && url.pathname === '/reply') return handleReply(req, res);
  if (req.method === 'POST' && url.pathname === '/release') return handleRelease(req, res);
  if (req.method === 'POST' && url.pathname === '/quit') return handleQuit(req, res);
  if (req.method === 'POST' && url.pathname === '/hold/touch') return handleTouch(req, res);
  if (req.method === 'POST' && url.pathname === '/econ') return handleEcon(req, res);
  if (req.method === 'POST' && url.pathname === '/unqueue') return handleUnqueue(req, res);
  if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/save') return handleSave(req, res);
  if (req.method === 'POST' && url.pathname === '/letter/delete') return handleLetterDelete(req, res);
  if (req.method === 'GET' && url.pathname === '/state') {
    return send(res, 200, JSON.stringify({ ...snapshot(), recent: state.recent.slice(-20), letters: state.letters.slice(-5), notes: state.notes.slice(-10) }));
  }
  if (req.method === 'GET') return handleStatic(req, res, url.pathname);
  send(res, 405, 'method not allowed', 'text/plain');
});

loadLetters();
server.listen(PORT, HOST, () => {
  console.log('Garden of Claude listening on http://' + HOST + ':' + PORT + ' (reply hold ' + (HOLD_MS > 0 ? Math.round(HOLD_MS / 1000) + 's' : 'until you reply') + ')');
});
