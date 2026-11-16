'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSharedDashboard } = require('../lib/shared.cjs');
const { privateStore } = require('../lib/private-store.cjs');
const { PNG } = require('./harness.cjs');
const ROOT = 'shared-figures', PASSWORD = 'demo', FOLDER = 'application/vnd.google-apps.folder';
function memoryStore() {
  const disk = new Map(); let n = 0;
  return { disk, read: async key => disk.has(key) ? structuredClone(disk.get(key)) : null,
    async write(key, value, etag) {
      const old = disk.get(key);
      if (old ? old.etag !== etag : !!etag) throw Object.assign(Error('conflict'), { status: 409 });
      const result = { value: structuredClone(value), etag: String(++n) }; disk.set(key, result); return structuredClone(result);
    } };
}
function fixture(options = {}) {
  const store = options.store || memoryStore(), messages = [], calls = [];
  let failNext = false, extra = false;
  const image = id => ({ id, name: id + '.png', mimeType: 'image/png', modifiedTime: '2026-11-16T00:00:00Z', size: '2000000' });
  const drive = { call: async (action, args) => {
    calls.push({ action, args });
    if (action === 'getPreview') return { dataUrl: 'data:image/png;base64,' + PNG, original: args.original, note: '' };
    if (action === 'getFileDetail') return { text: 'detail', table: null, note: '' };
    if (failNext) { failNext = false; throw Error('Google temporary error'); }
    const pages = {
      [ROOT + ':']: { files: [{ id: 'group', name: 'ResNet HMDB51', mimeType: FOLDER }] },
      'group:': { files: [image('plot1')], nextPageToken: 'page2' },
      'group:page2': { files: [image('plot1'), image('plot2'), ...(extra ? [image('plot3')] : [])] }
    };
    return { summaries: {}, warnings: [], ...pages[args.id + ':' + args.pageToken] };
  }, thumbnail: async item => { calls.push({ action: 'thumbnail', id: item.id }); return { dataUrl: 'data:image/png;base64,' + PNG, original: false, note: '' }; } };
  const params = { rootId: ROOT, password: PASSWORD, store, drive, enqueue: async message => messages.push(message), batchPages: 1, ...options };
  return { store, calls, messages, dashboard: createSharedDashboard(params), restart: () => createSharedDashboard(params),
    failNext: () => { failNext = true; }, addImage: () => { extra = true; }, async drain() {
      let limit = 30;
      while (messages.length && limit-- > 0) await this.restart().processJob(messages.shift());
      assert(limit > 0, 'Queue must terminate');
    } };
}
async function request(app, action, body = {}, cookie) {
  const headers = {}; let response;
  const res = { setHeader(k, v) { headers[k] = v; }, end(text) { response = JSON.parse(text); } };
  await app.handler({ method: 'POST', headers: { cookie: cookie || '', 'x-forwarded-proto': 'https' }, body: { action, ...body } }, res);
  return { status: res.statusCode, body: response, headers, cookie: headers['Set-Cookie']?.split(';')[0] };
}
async function login(app) {
  const response = await request(app, 'login', { password: PASSWORD }); assert.equal(response.status, 200); return response.cookie;
}
test('shared password gate works without Google login and is retained by a secure HTTP-only cookie', async () => {
  const h = fixture();
  assert.equal((await request(h.dashboard, 'getCatalog')).status, 401);
  assert.equal((await request(h.dashboard, 'login', { password: 'wrong' })).status, 401);
  const result = await request(h.dashboard, 'login', { password: PASSWORD });
  assert.match(result.headers['Set-Cookie'], /HttpOnly/); assert.match(result.headers['Set-Cookie'], /Secure/);
  assert.equal((await request(h.restart(), 'session', {}, result.cookie)).status, 200);
  assert.equal(h.calls.length, 0); assert(!JSON.stringify(result).includes(PASSWORD));
  const changedPassword = fixture({ password: 'different-password-of-adequate-length' }).dashboard;
  assert.equal((await request(changedPassword, 'session', {}, result.cookie)).status, 401);
});
test('indexing runs through persisted queued jobs without a browser and survives cold starts', async () => {
  const h = fixture(), cookie = await login(h.dashboard);
  await request(h.dashboard, 'startIndex', {}, cookie);
  assert.equal(h.messages.length, 1);
  await h.drain();
  const result = await request(h.restart(), 'getCatalog', {}, cookie);
  assert.equal(result.body.manifest.files, 2); assert.equal(result.body.status.active, false);
  const entries = [];
  for (let page = 0; page < result.body.manifest.parts; page++) {
    const part = await request(h.restart(), 'catalogPage', { page, version: result.body.manifest.version }, cookie);
    entries.push(...(part.body.records || []));
  }
  assert.equal(new Set(entries.map(x => x.id)).size, 2);
  assert(!h.calls.some(c => c.action === 'getPreview'), 'Indexing must not download original images');
});
test('a second collaborator sees the saved index and cached thumbnail without scanning or Drive access', async () => {
  const h = fixture(); await h.dashboard.startIndex(); await h.drain();
  const before = h.calls.length, viewer = h.restart(), cookie = await login(viewer);
  const catalog = await request(viewer, 'getCatalog', {}, cookie);
  assert.equal(catalog.body.manifest.files, 2);
  const preview = await request(viewer, 'getPreview', { id: 'plot1', original: false }, cookie);
  assert.equal(preview.status, 200); assert.equal(preview.body.original, false); assert.equal(h.calls.length, before);
  const original = await request(viewer, 'getPreview', { id: 'plot1', original: true }, cookie);
  assert.equal(original.body.url, '/api/original?id=plot1');
  assert.equal(h.calls.length, before, 'Original is fetched only when the browser requests the authenticated URL');
});
test('failed refresh keeps the last complete shared snapshot until all new pages finish', async () => {
  const h = fixture(); await h.dashboard.startIndex(); await h.drain();
  const cookie = await login(h.dashboard), old = (await request(h.dashboard, 'getCatalog', {}, cookie)).body.manifest;
  h.addImage(); await h.dashboard.startIndex(); h.failNext();
  const failed = h.messages.shift(); await assert.rejects(h.restart().processJob(failed), /temporary/);
  const during = await request(h.dashboard, 'getCatalog', {}, cookie);
  assert.equal(during.body.manifest.version, old.version); assert.equal(during.body.manifest.files, 2);
  await h.restart().processJob(failed); await h.drain();
  const finished = (await request(h.dashboard, 'getCatalog', {}, cookie)).body;
  assert.equal(finished.manifest.files, 3); assert.notEqual(finished.manifest.version, old.version);
});
test('duplicate concurrent workers cannot corrupt the work checkpoint or publish duplicate IDs', async () => {
  const h = fixture(); await h.dashboard.startIndex();
  const message = h.messages.shift();
  const results = await Promise.allSettled([h.restart().processJob(message), h.restart().processJob(message)]);
  assert(results.some(r => r.status === 'fulfilled'));
  await h.drain();
  const cookie = await login(h.dashboard), catalog = await request(h.dashboard, 'getCatalog', {}, cookie);
  assert.equal(catalog.body.manifest.files, 2);
});
test('shared preview and file endpoints reject unknown IDs and stale snapshot references', async () => {
  const h = fixture(); await h.dashboard.startIndex(); await h.drain(); const cookie = await login(h.dashboard);
  for (const action of ['getPreview', 'getFileDetail']) {
    assert.equal((await request(h.dashboard, action, { id: 'outside' }, cookie)).status, 403);
    assert.equal((await request(h.dashboard, action, { id: '../private' }, cookie)).status, 400);
  }
  assert.equal((await request(h.dashboard, 'catalogPage', { version: 'old', page: 0 }, cookie)).status, 409);
  assert.equal((await request(h.dashboard, 'catalogPage', { version: 'old', page: -1 }, cookie)).status, 409);
});
test('queue submission failure is recoverable without resetting the shared scan', async () => {
  let broken = true; const messages = [];
  const h = fixture({ enqueue: async message => { if (broken) throw Error('queue unavailable'); messages.push(message); } });
  await assert.rejects(h.dashboard.startIndex(), /could not be queued/);
  assert.equal((await h.dashboard.status()).paused, true);
  const before = (await h.store.read(h.dashboard.key('work.json'))).value.id;
  broken = false; await h.dashboard.startIndex();
  assert.equal(messages[0].jobId, before); assert.equal((await h.dashboard.status()).paused, false);
});
test('cookies expire and logout clears the shared session without affecting the saved catalog', async () => {
  let clock = 0; const h = fixture({ now: () => clock }); const cookie = await login(h.dashboard);
  clock = 8 * 86400000;
  assert.equal((await request(h.dashboard, 'session', {}, cookie)).status, 401);
  const current = await login(h.dashboard), logout = await request(h.dashboard, 'logout', {}, current);
  assert.match(logout.headers['Set-Cookie'], /Max-Age=0/);
});
test('private Blob adapter requests consistent checkpoints and conditional writes, never public access', async () => {
  const calls = [];
  const store = privateStore({ sdk: async () => ({
    get: async (key, options) => { calls.push({ key, options }); return { stream: new Blob(['{"work":1}']).stream(), blob: { etag: 'etag1' } }; },
    put: async (key, text, options) => { calls.push({ key, text, options }); return { etag: 'etag2' }; }
  }) });
  const saved = await store.read('work.json'); assert.equal(saved.etag, 'etag1');
  assert.equal(calls[0].options.useCache, false); assert.equal(calls[0].options.access, 'private');
  await store.write('work.json', { work: 2 }, saved.etag);
  assert.equal(calls[1].options.ifMatch, 'etag1'); assert.equal(calls[1].options.allowOverwrite, true);
  assert.equal(calls[1].options.access, 'private'); assert.equal(calls[1].options.addRandomSuffix, false);
});
test('private Blob SDK precondition errors become retryable conflicts even when Error.name is generic', async () => {
  const { BlobPreconditionFailedError } = await import('@vercel/blob');
  const store = privateStore({ sdk: async () => ({ BlobPreconditionFailedError, put: async () => { throw new BlobPreconditionFailedError(); } }) });
  await assert.rejects(store.write('work.json', {}, 'old'), error => error.status === 409);
});
test('old queue deliveries cannot pause or replace an explicitly resumed scan', async () => {
  const h = fixture(); await h.dashboard.startIndex(); const old = h.messages.shift();
  await h.dashboard.pauseJob(old.jobId, old.run); assert.equal((await h.dashboard.status()).paused, true);
  await h.dashboard.startIndex(); const current = h.messages.shift(); assert.notEqual(current.run, old.run);
  const before = h.calls.length;
  await h.dashboard.processJob(old); await h.dashboard.pauseJob(old.jobId, old.run);
  assert.equal(h.calls.length, before); assert.equal((await h.dashboard.status()).paused, false);
  await h.dashboard.processJob(current); await h.drain();
  assert.equal((await h.dashboard.status()).active, false);
});
test('board endpoints require authentication and share saved files/metrics across collaborator sessions', async () => {
  const { randomUUID } = require('node:crypto');
  const h = fixture(); await h.dashboard.startIndex(); await h.drain();
  for (const action of ['listBoards', 'getBoard', 'saveBoard']) assert.equal((await request(h.dashboard, action)).status, 401);
  const first = await login(h.dashboard), second = await login(h.restart());
  const board = { title: 'Research board', items: [
    { id: randomUUID(), kind: 'file', fileId: 'plot1', x: 40, y: 40, width: 500, height: 360 },
    { id: randomUUID(), kind: 'run', runId: 'group', x: 580, y: 40, width: 500, height: 360 }
  ] };
  const save = await request(h.dashboard, 'saveBoard', { board, revision: 0 }, first);
  assert.equal(save.status, 200); assert.equal(save.body.board.items[1].source.name, 'ResNet HMDB51');
  const read = await request(h.restart(), 'getBoard', { id: save.body.board.id }, second);
  assert.deepEqual(read.body.board, save.body.board);
  assert.equal((await request(h.restart(), 'listBoards', {}, second)).body.boards[0].items, 2);
  assert.equal((await request(h.restart(), 'saveBoard', { board: save.body.board, revision: 0 }, second)).status, 409);
  board.items[0].fileId = 'outside';
  assert.equal((await request(h.restart(), 'saveBoard', { board, revision: 0 }, second)).status, 403);
});
