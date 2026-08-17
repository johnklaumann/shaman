'use strict';
const http = require('node:http');
const { createStore } = require('./lib/store');
const { validateNotePayload } = require('./lib/validate');
const { toPublicNote } = require('./lib/format');

const store = createStore();

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/notes') {
    return json(res, 200, store.list().map(toPublicNote));
  }

  if (req.method === 'POST' && url.pathname === '/notes') {
    let payload;
    try { payload = await readBody(req); } catch { return json(res, 400, { error: 'invalid json' }); }
    const errors = validateNotePayload(payload);
    if (errors.length) return json(res, 400, { error: errors.join('; ') });
    const note = store.add(payload);
    return json(res, 201, toPublicNote(note));
  }

  return json(res, 404, { error: 'not found' });
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`notes-api listening on ${server.address().port}`);
});

module.exports = { server, store };
