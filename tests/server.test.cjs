'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ROOT, harness, file, folder } = require('./harness.cjs');

function populate(h, count = 2) {
  h.pages.set(ROOT + ':', { files: [folder('group', 'ResNet HMDB51 Dataset Linear Probes')] });
  h.pages.set('group:', { files: [folder('run', 'HMDB51_video_800k_gop8-8')] });
  for (let i = 0; i < count; i++) h.pages.set('run:' + (i ? 'p' + i : ''), {
    files: [file('plot-' + i, 'accuracy_' + i + '.png')], ...(i < count - 1 ? { nextPageToken: 'p' + (i + 1) } : {})
  });
  h.metadata.set('group', { parents: [ROOT] }); h.metadata.set('run', { parents: ['group'] });
  for (let i = 0; i < count; i++) h.metadata.set('plot-' + i, { parents: ['run'], mimeType: 'image/png', size: 100 });
}

test('first load returns an empty serializable catalog and setup installs one refresh trigger', () => {
  const h = harness(); populate(h);
  const first = h.context.getCatalog(); assert.equal(first.catalog.records.length, 0); assert.equal(first.catalog.complete, false);
  h.context.setup(); h.context.setup(); assert.equal(h.triggers.length, 1);
  assert.equal(h.readCatalog().complete, true); assert.doesNotThrow(() => JSON.stringify(h.context.getCatalog()));
});

test('pagination checkpoints persist across batches without duplicate records', () => {
  const h = harness(); populate(h, 20); h.context.startIndex();
  const first = h.context.continueIndex(); assert.equal(first.active, true); assert.equal(h.readWork().pages, 12);
  const second = h.context.continueIndex(); assert.equal(second.active, false);
  const cat = h.readCatalog(); assert.equal(cat.records.length, 20); assert.equal(new Set(cat.records.map(r => r.id)).size, 20);
});

test('failed Drive requests retain the current page and resume without silently skipping results', () => {
  const h = harness(); populate(h); h.context.startIndex(); h.failNextList();
  assert.throws(() => h.context.continueIndex(), /Index paused/);
  assert.equal(h.readWork().queue[0].id, ROOT); assert.equal(h.readWork().queue[0].attempts, 1);
  h.context.continueIndex(); assert.equal(h.readCatalog().records.length, 2);
});

test('an in-progress refresh preserves the last completed snapshot', () => {
  const h = harness(); populate(h); h.context.startIndex(); h.context.continueIndex();
  const old = h.readCatalog().indexedAt;
  populate(h, 25); h.context.startIndex(); h.context.continueIndex();
  const loaded = h.context.getCatalog(); assert.equal(loaded.catalog.indexedAt, old);
  assert.equal(loaded.catalog.records.length, 2); assert.equal(loaded.status.active, true);
  h.context.continueIndex(); h.context.continueIndex(); assert.equal(h.readCatalog().records.length, 25);
});

test('duplicate IDs from Drive pages are indexed only once', () => {
  const h = harness(); populate(h); h.pages.get('run:p1').files.push(file('plot-0', 'accuracy_0.png'));
  h.context.startIndex(); h.context.continueIndex(); assert.equal(h.readCatalog().records.length, 2);
});

test('preview access rejects unknown files and files moved outside Figures before reading their blobs', () => {
  const h = harness(); populate(h); h.context.startIndex(); h.context.continueIndex();
  assert.throws(() => h.context.getPreview('unknown', true), /not in the Figures catalog/);
  h.metadata.set('plot-0', { parents: ['outside'] }); h.metadata.set('outside', { parents: [] });
  const before = h.getBlobReads(); assert.throws(() => h.context.getPreview('plot-0', true), /no longer inside Figures/);
  // Only the two catalog reads happen; the original image blob is never read.
  assert.equal(h.getBlobReads() - before, 1);
});

test('preview returns a safe image data URL and reports when the original is too large', () => {
  const h = harness(); populate(h); h.context.startIndex(); h.context.continueIndex();
  const r = h.context.getPreview('plot-0', true); assert.match(r.dataUrl, /^data:image\/png;base64,/); assert.equal(r.original, true);
  h.metadata.set('plot-0', { parents: ['run'], mimeType: 'image/png', size: 6000000 });
  const large = h.context.getPreview('plot-0', true); assert.equal(large.original, false); assert.match(large.note, /Thumbnail preview/);
});

test('script lock prevents a second indexing operation from corrupting a scan', () => {
  const h = harness(); populate(h); h.context.startIndex(); h.denyLock();
  assert.throws(() => h.context.continueIndex(), /already being updated/);
  assert.equal(h.readWork().pages, 0);
});

test('a malformed JSON sidecar is reported as a warning without dropping its original file or figures', () => {
  const h = harness(); populate(h);
  h.pages.get('run:').files.push(file('bad-json', 'metadata.json', 'application/json'));
  h.disk.set('bad-json', '{ not JSON');
  h.context.startIndex(); h.context.continueIndex();
  const cat = h.readCatalog(); assert.equal(cat.records.length, 3); assert.equal(cat.warnings.length, 1);
  assert.match(cat.warnings[0].message, /could not be parsed/);
});

test('large data files remain linked without being read for inline text previews', () => {
  const h = harness(); populate(h);
  h.pages.get('run:').files.push(file('large-csv', 'pairwise_symmetric_kl.csv', 'text/csv'));
  h.metadata.set('large-csv', { parents: ['run'], mimeType: 'text/csv', size: 357775414 });
  h.context.startIndex(); h.context.continueIndex();
  const before = h.getBlobReads(); const detail = h.context.getFileDetail('large-csv');
  assert.match(detail.note, /too large/); assert.equal(detail.text, '');
  assert.equal(h.getBlobReads() - before, 1);
});

test('filenames with markup remain literal JSON strings in catalog responses', () => {
  const h = harness(); populate(h);
  h.pages.get('run:').files.push(file('markup', '<script>alert(1)</script>.png'));
  h.context.startIndex(); h.context.continueIndex();
  assert.equal(h.readCatalog().records.find(r => r.id === 'markup').name, '<script>alert(1)</script>.png');
  assert.throws(() => h.context.getPreview('../../outside', true), /Invalid file identifier/);
});
