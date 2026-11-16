'use strict';
const crypto = require('node:crypto');
const fail = (message, status = 400) => Object.assign(Error(message), { status });
const ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
function text(value, limit, label) {
  if (typeof value !== 'string' || value.length > limit) throw fail('Invalid ' + label + '.');
  return value;
}
function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) throw fail('Invalid ' + label + '.');
  return value;
}
function createBoards({ store, key, resolveFile, resolveRun, now = () => Date.now() }) {
  const path = key('boards.json');
  const metadata = b => ({ id: b.id, title: b.title, description: b.description, revision: b.revision,
    items: b.items.length, createdAt: b.createdAt, updatedAt: b.updatedAt });
  async function read() { return await store.read(path) || { value: { schema: 1, boards: [] }, etag: undefined }; }
  async function list() {
    const saved = await read();
    return saved.value.boards.map(metadata).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async function get(id) {
    if (typeof id !== 'string' || !ID.test(id)) throw fail('Invalid board identifier.');
    const board = (await read()).value.boards.find(b => b.id === id);
    if (!board) throw fail('Board not found.', 404);
    return board;
  }
  async function save(input, revision, copyFrom) {
    if (!input || typeof input !== 'object') throw fail('Invalid board.');
    const id = input.id === undefined ? crypto.randomUUID() : input.id;
    if (typeof id !== 'string' || !ID.test(id)) throw fail('Invalid board identifier.');
    const title = text(input.title, 120, 'board title').trim();
    if (!title) throw fail('Name your board before saving.');
    const description = text(input.description ?? '', 4000, 'board description');
    if (!Array.isArray(input.items) || input.items.length > 100) throw fail('A board can contain up to 100 tiles.');
    integer(revision, 0, 1000000000, 'board revision');
    if (copyFrom && (typeof copyFrom !== 'string' || !ID.test(copyFrom))) throw fail('Invalid source board.');
    for (let attempt = 0; attempt < 3; attempt++) {
      const saved = await read(), book = saved.value;
      const existing = book.boards.find(b => b.id === id);
      if ((existing ? existing.revision : 0) !== revision)
        throw fail('Someone saved a newer version of this board. Reload it, or save your draft as a copy.', 409);
      if (!existing && book.boards.length >= 50) throw fail('This workspace can contain up to 50 boards.');
      const template = existing || (copyFrom && book.boards.find(b => b.id === copyFrom));
      if (copyFrom && !template) throw fail('Source board not found.', 404);
      const ids = new Set(), items = [];
      for (const item of input.items) {
        if (!item || typeof item.id !== 'string' || !ID.test(item.id) || ids.has(item.id)) throw fail('Invalid or duplicate tile identifier.');
        ids.add(item.id);
        const kind = item.kind;
        if (!['file', 'run', 'note'].includes(kind)) throw fail('Unsupported board tile.');
        const tile = { id: item.id, kind, x: integer(item.x, 0, 19600, 'tile position'), y: integer(item.y, 0, 19600, 'tile position'),
          width: integer(item.width, 240, 2400, 'tile width'), height: integer(item.height, 180, 2000, 'tile height') };
        if (tile.x + tile.width > 20000 || tile.y + tile.height > 20000) throw fail('Keep tiles inside the 20,000 × 20,000 board area.');
        if (kind === 'note') tile.text = text(item.text ?? '', 8000, 'note');
        else {
          const ref = kind === 'file' ? 'fileId' : 'runId';
          if (typeof item[ref] !== 'string' || !/^[\w-]{1,200}$/.test(item[ref])) throw fail('Invalid result reference.');
          tile[ref] = item[ref];
          try {
            const source = await (kind === 'file' ? resolveFile(item[ref]) : resolveRun(item[ref]));
            tile.source = { name: String(source.name).slice(0, 500), path: String(source.path || '').slice(0, 4000),
              ...(kind === 'file' ? { mimeType: source.mimeType } : {}) };
          } catch (error) {
            const previous = template?.items.find(t => t.id === tile.id && t.kind === kind && t[ref] === tile[ref]);
            // Keep missing linked results visible as unavailable tiles, without accepting new out-of-scope IDs.
            if (!previous || ![403, 404].includes(error.status)) throw error;
            tile.source = previous.source;
          }
        }
        items.push(tile);
      }
      const board = { schema: 1, id, title, description, items, revision: revision + 1,
        createdAt: existing?.createdAt || new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString() };
      const next = { schema: 1, boards: [...book.boards.filter(b => b.id !== id), board] };
      if (Buffer.byteLength(JSON.stringify(next)) > 4000000) throw fail('Board storage is full. Reduce the number of tiles or note text.');
      try { await store.write(path, next, saved.etag); return board; }
      catch (error) { if (error.status !== 409 || attempt === 2) throw error; }
    }
  }
  return { list, get, save };
}
module.exports = { createBoards };
