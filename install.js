#!/usr/bin/env node
'use strict';
// Installs (or removes) the Garden of Claude hooks in ~/.claude/settings.json.
// Works anywhere Claude Code runs: Windows, macOS, Linux, the CLI, the VS Code
// extension, the desktop app, and Agent SDK apps that load user settings.
//   node install.js            add the hooks (idempotent)
//   node install.js --remove   take them out again
//   GARDEN_PORT=47831 changes the port the hooks post to.
//
// The hooks run hooks/relay.js with this same Node binary, directly, with no
// shell: nothing to install beyond Node, nothing that differs per platform.

const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.GARDEN_PORT) || 47831;
const FILE = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
const MARK = 'claude-garden';
const RELAY = path.join(__dirname, 'hooks', 'relay.js');

// Stop waits for the game's reply; PreToolUse waits for the pause gate; everything else is fire-and-forget.
const EVENTS = {
  PreToolUse: { timeout: 5 },
  PostToolUse: { timeout: 5, async: true },
  PostToolUseFailure: { timeout: 5, async: true },
  Notification: { timeout: 5, async: true },
  UserPromptSubmit: { timeout: 5, async: true },
  Stop: { timeout: 43200 },
  SubagentStart: { timeout: 5, async: true },
  SubagentStop: { timeout: 5, async: true },
  SessionStart: { timeout: 15, async: true },
  PreCompact: { timeout: 5, async: true },
  PostCompact: { timeout: 5, async: true },
  SessionEnd: { timeout: 2, async: true },
};

let settings = {};
try { settings = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { if (fs.existsSync(FILE)) { console.error('Could not parse ' + FILE + ': ' + e.message); process.exit(1); } }
settings.hooks = settings.hooks || {};

const remove = process.argv.includes('--remove');
// A garden hook is one we marked, or an older hand-written one that posts to our URL.
const isGarden = (h) => h && (h.statusMessage === MARK || (typeof h.command === 'string' && h.command.includes('127.0.0.1:' + PORT + '/hook')));
for (const [event, spec] of Object.entries(EVENTS)) {
  const list = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
  const kept = list.filter((entry) => !(entry && Array.isArray(entry.hooks) && entry.hooks.some(isGarden)));
  if (!remove) {
    const hook = { type: 'command', statusMessage: MARK, command: process.execPath, args: [RELAY], ...spec };
    kept.push({ hooks: [hook] });
  }
  if (kept.length) settings.hooks[event] = kept; else delete settings.hooks[event];
}
if (!Object.keys(settings.hooks).length) delete settings.hooks;

fs.mkdirSync(path.dirname(FILE), { recursive: true });
fs.writeFileSync(FILE, JSON.stringify(settings, null, 2) + '\n');
if (remove) {
  console.log('Removed Garden of Claude hooks from ' + FILE + '. Claude will no longer talk to the garden.');
} else {
  console.log('Installed Garden of Claude hooks in ' + FILE);
  console.log('The garden starts itself whenever a Claude session begins. Open http://127.0.0.1:' + PORT + ' to play,');
  console.log('or start it by hand any time with: node server/server.js');
}
