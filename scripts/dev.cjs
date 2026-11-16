'use strict';
// Local equivalent of Vercel static hosting + the Node function. No Google mocks.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const name of ['.env.local', '.env']) {
  const file = path.join(root, name);
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
require('./build.cjs');
const handler = require('../api/dashboard.js');
const types = { '.html': 'text/html', '.js': 'text/javascript' };
const files = new Set(['index.html', 'core.js', 'config.js', 'indexer.js', 'vercel.js']);
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/dashboard') {
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16000) { res.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    req.body = Buffer.concat(chunks).toString('utf8');
    return handler(req, res);
  }
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (!['GET', 'HEAD'].includes(req.method) || !files.has(name)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(name)] + '; charset=utf-8', 'Cache-Control': 'no-store',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups', 'X-Content-Type-Options': 'nosniff' });
  res.end(req.method === 'HEAD' ? '' : fs.readFileSync(path.join(root, 'public', name)));
}).listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log('Dashboard: http://localhost:' + (process.env.PORT || 3000)));
