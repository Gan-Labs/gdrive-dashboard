'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createBoards } = require('../lib/boards.cjs');
function fixture() {
  const disk = new Map(); let serial = 0, missing = false;
  const store = {
    async read(key) { return disk.has(key) ? structuredClone(disk.get(key)) : null; },
    async write(key, value, etag) {
      const old = disk.get(key);
      if (old ? old.etag !== etag : !!etag) throw Object.assign(Error('conflict'), { status: 409 });
      disk.set(key, { value: structuredClone(value), etag: String(++serial) });
    }
  };
  const resolve = async id => {
    if (missing || !['figure', 'metrics', 'experiment'].includes(id)) throw Object.assign(Error('Unknown source'), { status: 403 });
    return { id, name: id + '.png', path: 'Figures/run/' + id, mimeType: 'image/png' };
  };
  const make = () => createBoards({ store, key: k => 'test/' + k, resolveFile: resolve, resolveRun: resolve });
  return { make, missing: () => { missing = true; } };
}
const tile = (kind, extra = {}) => ({ id: randomUUID(), kind, x: 40, y: 40, width: 500, height: 360, ...extra });
const draft = (items = []) => ({ title: 'Experiment comparison', description: 'Shared observations', items });
test('saved board layouts, notes and canonical source references survive a new server instance', async () => {
  const h = fixture(), input = draft([tile('file', { fileId: 'figure', source: { name: 'untrusted', url: 'https://example.com' } }),
    tile('run', { runId: 'experiment', x: 600 }), tile('note', { text: '<script>literal note</script>', y: 440 })]);
  const saved = await h.make().save(input, 0);
  assert.equal(saved.revision, 1); assert.equal(saved.items[0].source.name, 'figure.png'); assert.equal(saved.items[0].source.url, undefined);
  assert.deepEqual(await h.make().get(saved.id), saved);
  const list = await h.make().list(); assert.equal(list[0].items, 3); assert.equal(list[0].title, input.title);
  assert.equal(list[0].items instanceof Array, false);
  saved.items[0].x = 800;
  const updated = await h.make().save(saved, 1); assert.equal(updated.revision, 2); assert.equal(updated.items[0].x, 800);
  assert.equal(updated.createdAt, saved.createdAt);
});
test('stale concurrent edits are rejected without overwriting the saved board, and drafts can be copied', async () => {
  const h = fixture(), saved = await h.make().save(draft([tile('note', { text: 'initial' })]), 0);
  const newer = structuredClone(saved); newer.items[0].text = 'collaborator edit';
  await h.make().save(newer, 1);
  saved.items[0].text = 'my draft';
  await assert.rejects(h.make().save(saved, 1), error => error.status === 409);
  assert.equal((await h.make().get(saved.id)).items[0].text, 'collaborator edit');
  const source = saved.id; delete saved.id;
  const copy = await h.make().save(saved, 0, source);
  assert.notEqual(copy.id, source); assert.equal(copy.items[0].text, 'my draft');
  assert.equal((await h.make().list()).length, 2);
});
test('concurrent saves to different boards preserve both through conditional-write retries', async () => {
  const h = fixture();
  const saved = await Promise.all([h.make().save(draft(), 0), h.make().save({ ...draft(), title: 'Other board' }, 0)]);
  assert.equal((await h.make().list()).length, 2);
  for (const board of saved) assert.equal((await h.make().get(board.id)).revision, 1);
});
test('invalid references, layout bounds, duplicate tiles and oversized notes are rejected', async () => {
  const h = fixture(), valid = tile('note', { text: 'ok' });
  const invalid = [tile('file', { fileId: 'outside' }), tile('file', { fileId: '../private' }),
    tile('note', { x: 19999 }), tile('note', { x: 19000, width: 2000 }), tile('note', { width: 0 }),
    tile('note', { y: 1.2 }), tile('note', { text: 'a'.repeat(8001) }), tile('note', { text: 0 }), tile('unknown')];
  for (const item of invalid) await assert.rejects(h.make().save(draft([item]), 0));
  await assert.rejects(h.make().save(draft([valid, valid]), 0));
  await assert.rejects(h.make().save({ ...draft(), id: 0 }, 0));
  await assert.rejects(h.make().save({ ...draft(), title: ' ' }, 0));
  await assert.rejects(h.make().save(draft(), -1));
  assert.equal((await h.make().list()).length, 0);
});
test('missing sources preserve existing tiles and copies but cannot introduce new out-of-scope references', async () => {
  const h = fixture(), saved = await h.make().save(draft([tile('file', { fileId: 'figure' })]), 0);
  h.missing(); saved.title = 'Still preserved';
  const updated = await h.make().save(saved, 1); assert.equal(updated.items[0].source.name, 'figure.png');
  const copy = structuredClone(updated); delete copy.id;
  assert.equal((await h.make().save(copy, 0, updated.id)).items.length, 1);
  updated.items[0].fileId = 'outside';
  await assert.rejects(h.make().save(updated, 2), error => error.status === 403);
  await assert.rejects(h.make().save(draft([tile('file', { fileId: 'figure' })]), 0), error => error.status === 403);
});
