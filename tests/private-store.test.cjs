'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { privateStore } = require('../lib/private-store.cjs');
test('work polls validate the origin ETag without downloading unchanged checkpoints or sharing mutable cached objects', async () => {
  const calls = []; let version = 'v1';
  const store = privateStore({ sdk: async () => ({ get: async (key, options) => {
    calls.push({ key, options });
    if (options.ifNoneMatch === version) return { statusCode: 304, stream: null, blob: { etag: version } };
    return { statusCode: 200, stream: new Blob([JSON.stringify({ pages: version === 'v1' ? 1 : 2 })]).stream(), blob: { etag: version } };
  } }) });
  const first = await store.read('dashboard/root/work.json'); first.value.pages = 999;
  assert.equal((await store.read('dashboard/root/work.json')).value.pages, 1);
  assert.equal(calls[1].options.ifNoneMatch, 'v1'); assert.equal(calls[1].options.useCache, false);
  version = 'v2'; assert.equal((await store.read('dashboard/root/work.json')).value.pages, 2);
  await store.read('dashboard/root/preview.json'); assert.equal(calls.at(-1).options.ifNoneMatch, undefined);
});
test('conditional work cache follows successful writes and is invalidated after a competing write', async () => {
  let current = { pages: 1 }, etag = 'v1', forceConflict = false;
  const store = privateStore({ sdk: async () => ({
    get: async (_, options) => options.ifNoneMatch === etag ? { statusCode: 304, stream: null, blob: { etag } } :
      { statusCode: 200, stream: new Blob([JSON.stringify(current)]).stream(), blob: { etag } },
    put: async (_, json) => {
      if (forceConflict) throw Object.assign(Error('competing write'), { status: 409 });
      current = JSON.parse(json); etag = 'v2'; return { etag };
    }
  }) });
  const input = { pages: 2 }; await store.write('work.json', input, 'v1'); input.pages = 999;
  assert.equal((await store.read('work.json')).value.pages, 2);
  forceConflict = true; current = { pages: 3 }; etag = 'v3';
  await assert.rejects(store.write('work.json', { pages: 4 }, 'v2'));
  assert.equal((await store.read('work.json')).value.pages, 3);
});
