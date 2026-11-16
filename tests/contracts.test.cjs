'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = path.join(__dirname, '..', 'src');

test('every client DOM reference resolves to a real element in the page', () => {
  const index = fs.readFileSync(path.join(src, 'Index.html'), 'utf8');
  const client = fs.readFileSync(path.join(src, 'Client.html'), 'utf8');
  const ids = [...index.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size, 'HTML IDs must be unique');
  for (const m of client.matchAll(/\$\('([^']+)'\)/g)) assert(ids.includes(m[1]), 'Missing element #' + m[1]);
});

test('all expected RPC endpoints exist and internal functions remain private', () => {
  const text = fs.readFileSync(path.join(src, 'Server.gs'), 'utf8');
  const functions = [...text.matchAll(/^function (\w+)\(/gm)].map(m => m[1]);
  for (const name of ['getCatalog', 'getPreview', 'getFileDetail', 'startIndex', 'continueIndex', 'setup', 'refreshScheduled', 'doGet'])
    assert(functions.includes(name), 'Missing RPC endpoint ' + name);
  for (const name of functions.filter(n => !['getCatalog', 'getPreview', 'getFileDetail', 'startIndex', 'continueIndex', 'setup', 'refreshScheduled', 'doGet'].includes(n)))
    assert(name.endsWith('_'), 'Internal function exposed to the client: ' + name);
});

test('HTML templates and all generated inline JavaScript parse without template delimiters', () => {
  const { previewHtml } = require('../scripts/browser-qa.cjs');
  for (const mode of ['normal', 'empty', 'failure']) {
    const html = previewHtml(mode); assert(!html.includes('<?'));
    for (const [i, match] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries())
      new vm.Script(match[1], { filename: mode + '-inline-' + i });
  }
});

test('production UI never inserts Drive names or metadata as HTML', () => {
  const client = fs.readFileSync(path.join(src, 'Client.html'), 'utf8');
  assert(!/\.innerHTML\s*=|insertAdjacentHTML|document\.write\(/.test(client));
  assert(!/eval\(|new Function\(/.test(client));
});
