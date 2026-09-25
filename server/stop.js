#!/usr/bin/env node
// Stops a running Garden of Claude server the same way the game's Quit button
// does: held turns are released, the save is written, then the process exits.
// The hooks start it again at the next Claude session; `npm run remove-hooks`
// is the way to turn the garden off for good.
const http = require('http');
const PORT = Number(process.env.GARDEN_PORT) || 47831;

const req = http.request({ host: '127.0.0.1', port: PORT, path: '/quit', method: 'POST', timeout: 3000 }, (res) => {
  res.resume();
  res.on('end', () => console.log(res.statusCode === 200 ? 'Garden of Claude stopped.' : 'Unexpected answer: ' + res.statusCode));
});
req.on('timeout', () => { req.destroy(); console.log('No answer from the garden server; it may already be stopped.'); });
req.on('error', () => console.log('No garden server is running on port ' + PORT + '.'));
req.end();
