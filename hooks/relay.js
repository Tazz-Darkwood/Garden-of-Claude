#!/usr/bin/env node
'use strict';
// The hook relay. Claude Code runs this for every event (see install.js): it
// reads the event from stdin, posts it to the garden server, and prints the
// server's answer, which is how the pause gate and the mailbox talk back.
// It needs no shell and no curl, and it always exits 0, so Claude never sees
// an error when the garden is not running. On SessionStart it also starts the
// server if nothing is listening, so opening Claude opens the garden.

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.GARDEN_PORT) || 47831;
const SERVER = path.join(__dirname, '..', 'server', 'server.js');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
    setTimeout(() => resolve(data), 2000);
  });
}

function post(body, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/hook', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve(out));
      res.on('error', () => resolve(''));
    });
    req.on('error', () => resolve(''));
    if (timeoutMs > 0) req.setTimeout(timeoutMs, () => { req.destroy(); resolve(''); });
    req.end(body);
  });
}

function alive() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/state' }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(700, () => { req.destroy(); resolve(false); });
  });
}

async function ensureServer() {
  if (await alive()) return true;
  try {
    const child = spawn(process.execPath, [SERVER], { cwd: path.dirname(SERVER), detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  } catch { return false; }
  for (let i = 0; i < 10; i++) { await new Promise((r) => setTimeout(r, 300)); if (await alive()) return true; }
  return false;
}

(async () => {
  const raw = await readStdin();
  let event = '';
  try { event = JSON.parse(raw).hook_event_name || ''; } catch { /* not ours to judge */ }
  if (event === 'SessionStart') await ensureServer();
  // Stop is held open by the server while the user reads and replies; everything else is quick.
  const timeout = event === 'Stop' ? 0 : event === 'PreToolUse' ? 3000 : 2500;
  const answer = raw ? await post(raw, timeout) : '';
  if (answer) process.stdout.write(answer);
  process.exit(0);
})();
