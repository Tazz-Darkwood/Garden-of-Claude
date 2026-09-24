#!/usr/bin/env node
'use strict';
// Installs (or removes) the Garden of Claude hooks in ~/.claude/settings.json.
// Works anywhere Claude Code runs: Windows, macOS, Linux, the CLI, the VS Code
// extension, the desktop app, and Agent SDK apps that load user settings.
//   node install.js            add the hooks (idempotent)
//   node install.js --remove   take them out again
//   GARDEN_PORT=47831 changes the port the hooks post to.

const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.GARDEN_PORT) || 47831;
const URL = 'http://127.0.0.1:' + PORT + '/hook';
const FILE = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
const MARK = 'claude-garden';

const curl = (secs) => 'curl -s -m ' + secs + ' -X POST ' + URL + ' -H "Content-Type: application/json" --data-binary @- || true';
// Stop waits for the game's reply; everything else is fire-and-forget.
const HOOKS = {
  PreToolUse: { command: curl(3), timeout: 5 },
  PostToolUse: { command: curl(3), timeout: 5, async: true },
  PostToolUseFailure: { command: curl(3), timeout: 5, async: true },
  Notification: { command: curl(3), timeout: 5, async: true },
  UserPromptSubmit: { command: curl(3), timeout: 5, async: true },
  Stop: { command: curl(43000), timeout: 43200 },
  SubagentStart: { command: curl(3), timeout: 5, async: true },
  SubagentStop: { command: curl(3), timeout: 5, async: true },
  SessionStart: { command: curl(3), timeout: 5, async: true },
  PreCompact: { command: curl(3), timeout: 5, async: true },
  PostCompact: { command: curl(3), timeout: 5, async: true },
  SessionEnd: { command: curl(1), timeout: 2, async: true },
};

let settings = {};
try { settings = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { if (fs.existsSync(FILE)) { console.error('Could not parse ' + FILE + ': ' + e.message); process.exit(1); } }
settings.hooks = settings.hooks || {};

const remove = process.argv.includes('--remove');
// A garden hook is one we marked, or an older hand-written one that posts to our URL.
const isGarden = (h) => h && (h.statusMessage === MARK || (typeof h.command === 'string' && h.command.includes('127.0.0.1:' + PORT + '/hook')));
let changed = 0;
for (const [event, spec] of Object.entries(HOOKS)) {
  const list = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
  const kept = list.filter((entry) => !(entry && Array.isArray(entry.hooks) && entry.hooks.some(isGarden)));
  if (kept.length !== list.length) changed++;
  if (!remove) {
    kept.push({ hooks: [{ type: 'command', statusMessage: MARK, ...spec }] });
    changed++;
  }
  if (kept.length) settings.hooks[event] = kept; else delete settings.hooks[event];
}
if (!Object.keys(settings.hooks).length) delete settings.hooks;

fs.mkdirSync(path.dirname(FILE), { recursive: true });
fs.writeFileSync(FILE, JSON.stringify(settings, null, 2) + '\n');
console.log((remove ? 'Removed' : 'Installed') + ' Garden of Claude hooks in ' + FILE);
console.log(remove ? 'Claude will no longer talk to the garden.' : 'Start the garden with: node server/server.js  then open http://127.0.0.1:' + PORT);
