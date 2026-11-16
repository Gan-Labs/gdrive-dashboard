'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, parseCsv, MAX_IMAGE } = require('../api/dashboard.js');
const { createIndexer } = require('../web/indexer.js');
const core = require('../src/Core.gs');
const ROOT = 'figures-root', FOLDER = 'application/vnd.google-apps.folder';
const item = (id, mimeType = 'image/png', parents = [ROOT]) => ({ id, name: id + '.png', mimeType, parents, size: '12' });
function fixture(overrides = {}) {
  const metadata = { [ROOT]: item(ROOT, FOLDER, []), plot: item('plot'), ...overrides };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const u = new URL(url), id = u.pathname.split('/').pop();
    if (u.pathname.endsWith('/about')) return Response.json({ user: { permissionId: 'user-1', emailAddress: 'owner@example.com' } });
    if (u.pathname.endsWith('/files')) return Response.json({ files: [metadata.plot], nextPageToken: '' });
    if (u.searchParams.get('alt') === 'media') return new Response('image-bytes', { headers: { 'content-type': 'image/png' } });
    return metadata[id] ? Response.json(metadata[id]) : new Response('', { status: 404 });
  };
  return { handler: createHandler({ rootId: ROOT, fetchImpl }), calls, metadata };
}
async function invoke(handler, body, { token = 'test-token', method = 'POST' } = {}) {
  const headers = {}; let text;
  const res = { setHeader: (k, v) => { headers[k] = v; }, end: s => { text = s; } };
  await handler({ method, body, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}) } }, res);
  return { status: res.statusCode, body: JSON.parse(text), headers, bytes: Buffer.byteLength(text) };
}
test('Vercel API requires authorization and enforces its action allowlist', async () => {
  const h = fixture();
  assert.equal((await invoke(h.handler, { action: 'session' }, { token: '' })).status, 401);
  assert.equal((await invoke(h.handler, {}, { method: 'GET' })).status, 405);
  assert.equal((await invoke(h.handler, { action: 'delete' })).status, 400);
  assert.equal(h.calls.length, 0);
  const response = await invoke(h.handler, { action: 'session' });
  assert.equal(response.status, 200); assert.equal(response.body.rootId, ROOT);
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
});
test('Vercel API rejects files and folder listings outside the root, including moved or trashed files', async () => {
  for (const action of ['getPreview', 'getFileDetail', 'listFolder']) {
    const h = fixture({ plot: item('plot', action === 'listFolder' ? FOLDER : 'image/png', ['outside']), outside: item('outside', FOLDER, []) });
    assert.equal((await invoke(h.handler, { action, id: 'plot', original: true })).status, 403);
    assert(!h.calls.some(c => c.url.includes('alt=media') || new URL(c.url).pathname.endsWith('/files')));
  }
  const h = fixture({ plot: { ...item('plot'), trashed: true } });
  assert.equal((await invoke(h.handler, { action: 'getPreview', id: 'plot' })).status, 403);
  assert.equal((await invoke(h.handler, { action: 'getPreview', id: '../x' })).status, 400);
});
test('Vercel previews respect payload limits and never expose Google bearer tokens or thumbnail URLs', async () => {
  const h = fixture();
  const original = await invoke(h.handler, { action: 'getPreview', id: 'plot', original: true });
  assert.equal(original.body.original, true); assert.match(original.body.dataUrl, /^data:image\/png;base64,/);
  const large = fixture({ plot: { ...item('plot'), size: MAX_IMAGE + 1 } });
  assert.equal((await invoke(large.handler, { action: 'getPreview', id: 'plot', original: true })).body.dataUrl, '');
  assert(!large.calls.some(c => c.url.includes('alt=media')));
  const hostile = fixture({ plot: { ...item('plot'), size: MAX_IMAGE + 1, thumbnailLink: 'https://attacker.example/steal' } });
  await invoke(hostile.handler, { action: 'getPreview', id: 'plot' });
  assert(!hostile.calls.some(c => c.url.includes('attacker')));
  assert(!JSON.stringify(original.body).includes('test-token'));
});
test('Vercel upstream auth failures and malformed requests produce bounded, credential-free errors', async () => {
  const handler = createHandler({ rootId: ROOT, fetchImpl: async () => new Response('secret-upstream-token', { status: 401 }) });
  const response = await invoke(handler, { action: 'session' });
  assert.equal(response.status, 401); assert(!JSON.stringify(response).includes('secret-upstream-token'));
  assert.equal((await invoke(handler, '{')).status, 400);
});
test('CSV previews handle quoted commas/newlines and cap rows/columns', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x,y","one\ntwo"\r\n').rows, [['a', 'b'], ['x,y', 'one\ntwo']]);
  assert.equal(parseCsv('header\n' + Array(200).fill('value').join('\n')).totalRows, 200);
  assert.equal(parseCsv('header\n' + Array(200).fill('value').join('\n')).rows.length, 101);
  assert.equal(parseCsv(Array(40).fill('a').join(',')).rows[0].length, 30);
  assert.throws(() => parseCsv('"unterminated'));
});
function browserIndexer() {
  let saved = null, fail = false;
  const pages = { [ROOT + ':']: { files: [{ ...item('group', FOLDER), name: 'ResNet HMDB51' }], summaries: {} },
    'group:': { files: [item('a')], nextPageToken: 'page2', summaries: {} },
    'group:page2': { files: [item('a'), item('b')], summaries: {} } };
  const create = () => createIndexer({ rootId: ROOT, core,
    api: async (_, args) => { if (fail) { fail = false; throw Error('Drive unavailable'); } return structuredClone(pages[args.id + ':' + args.pageToken]); },
    store: { get: async () => structuredClone(saved), set: async v => { saved = structuredClone(v); } } });
  return { create, failNext: () => { fail = true; }, saved: () => saved };
}
test('browser index checkpoints survive process replacement and failures, preserving the prior snapshot', async () => {
  const h = browserIndexer(); let index = h.create();
  await index.startIndex(); await index.continueIndex(); await index.continueIndex();
  index = h.create(); h.failNext(); await assert.rejects(index.continueIndex(), /Index paused/);
  assert.equal(h.saved().work.queue[0].pageToken, 'page2');
  await index.continueIndex();
  assert.equal((await index.getCatalog()).catalog.records.length, 2);
  await index.startIndex(); await index.continueIndex();
  assert.equal((await index.getCatalog()).catalog.complete, true);
  assert.equal((await index.getCatalog()).catalog.records.length, 2);
  assert.equal((await index.getCatalog()).status.active, true);
});
test('completed index publishes distinct IDs with original metrics and categories', async () => {
  const h = browserIndexer(), index = h.create();
  await index.startIndex(); for (let i = 0; i < 3; i++) await index.continueIndex();
  const loaded = await index.getCatalog();
  assert.equal(loaded.status.active, false); assert.equal(loaded.catalog.groups.length, 1);
  assert.equal(new Set(loaded.catalog.records.map(r => r.id)).size, 2);
  assert.equal(loaded.catalog.records[0].dataset, 'HMDB51');
});
test('Drive listing is paginated and rejects incomplete results instead of publishing them', async () => {
  const handler = createHandler({ rootId: ROOT, fetchImpl: async url => {
    if (new URL(url).pathname.endsWith('/files')) return Response.json({ incompleteSearch: true, files: [] });
    return Response.json(item(ROOT, FOLDER, []));
  } });
  assert.equal((await invoke(handler, { action: 'listFolder', id: ROOT })).status, 503);
});
test('Drive metadata summaries preserve zero-valued metrics and report malformed sidecars', async () => {
  const handler = createHandler({ rootId: ROOT, fetchImpl: async url => {
    const u = new URL(url);
    if (u.pathname.endsWith('/files')) return Response.json({ nextPageToken: 'next', files: [
      { ...item('summary', 'application/json'), name: 'status.json' },
      { ...item('broken', 'application/json'), name: 'metrics.json' }
    ] });
    if (u.searchParams.get('alt') === 'media') return u.pathname.endsWith('/summary') ?
      Response.json({ latest_validation_metrics: { accuracy: 0 }, completed_epochs: 0 }) : new Response('{bad');
    return Response.json(item(ROOT, FOLDER, []));
  } });
  const response = await invoke(handler, { action: 'listFolder', id: ROOT });
  assert.equal(response.status, 200); assert.equal(response.body.nextPageToken, 'next');
  assert.equal(response.body.summaries.summary.metrics[0].value, 0);
  assert.equal(response.body.summaries.summary.metrics[0].split, 'Latest validation');
  assert.equal(response.body.warnings[0].id, 'broken');
});
test('an expired page token resets only that folder cursor and retains ID deduplication', async () => {
  const handler = createHandler({ rootId: ROOT, fetchImpl: async url => new URL(url).pathname.endsWith('/files') ?
    new Response('', { status: 400 }) : Response.json(item(ROOT, FOLDER, [])) });
  const response = await invoke(handler, { action: 'listFolder', id: ROOT, pageToken: 'expired' });
  assert.equal(response.status, 409); assert.equal(response.body.code, 'PAGE_EXPIRED');
  let saved = { work: { rootId: ROOT, queue: [{ id: ROOT, pageToken: 'expired', attempts: 0 }], files: [], folders: [], seen: {}, pages: 0, summaries: {} } };
  const index = createIndexer({ rootId: ROOT, core, api: async () => { throw Object.assign(Error('expired'), { code: 'PAGE_EXPIRED' }); },
    store: { get: async () => structuredClone(saved), set: async v => { saved = v; } } });
  await assert.rejects(index.continueIndex(), /expired/);
  assert.equal(saved.work.queue[0].pageToken, undefined); assert.equal(saved.work.queue.length, 1);
});
test('an image that exceeds its declared size is stopped before reaching the response payload limit', async () => {
  const handler = createHandler({ rootId: ROOT, fetchImpl: async url => new URL(url).searchParams.get('alt') === 'media' ?
    new Response(Buffer.alloc(MAX_IMAGE + 1)) : Response.json(new URL(url).pathname.endsWith('/' + ROOT) ? item(ROOT, FOLDER, []) : item('plot')) });
  const response = await invoke(handler, { action: 'getPreview', id: 'plot', original: true });
  assert.equal(response.status, 413); assert(response.bytes < 1000);
});
