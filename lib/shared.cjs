'use strict';
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const core = require('../src/Core.gs');
const { createIndexer } = require('../web/indexer.js');
const { createBoards } = require('./boards.cjs');
const COOKIE = 'entropy_session';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const problem = (message, status = 400) => Object.assign(Error(message), { status });
const safeEqual = (a, b) => crypto.timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
// Only controlled adapter messages may cross into browser-visible diagnostics.
const DRIVE_FAILURES = new Map([
  ['GOOGLE_SERVICE_ACCOUNT_JSON is invalid.', 'The backend service-account JSON is invalid. Set GOOGLE_SERVICE_ACCOUNT_JSON to the complete downloaded JSON key, then redeploy.'],
  ['Configure the backend Google service account.', 'The backend service-account credentials are missing or incomplete. Configure GOOGLE_SERVICE_ACCOUNT_JSON, then redeploy.'],
  ['Backend Google authorization failed. Check the service-account key and Drive API setup.', 'Backend Google authorization failed. Check the service-account key and Drive API setup.'],
  ['Backend Google authorization failed.', 'Backend Google authorization failed. Check the service-account key and Drive API setup.'],
  ['Google authorization expired. Connect again to continue.', 'Backend Google authorization failed. Check the service-account key, then resume the index.'],
  ['Your Google account cannot access this Figures file or folder.', 'The backend service account cannot access this Figures file or folder. Check its Drive sharing and confirm Google Drive API is enabled.'],
  ['Google Drive API is disabled for the project that owns these credentials. Enable Google Drive API in that Google Cloud project, then resume the index.', 'Google Drive API is disabled for the project that owns these credentials. Enable Google Drive API in that Google Cloud project, then resume the index.'],
  ['Google Drive is rate limiting requests. Resume the scan shortly.', 'Google Drive is rate limiting requests. Background indexing will retry shortly.'],
  ['Google Drive rejected this request.', 'Google Drive rejected the folder request. Check the configured Figures folder, then resume the index.'],
  ['Google Drive is temporarily unavailable. Try again.', 'Google Drive is temporarily unavailable. Background indexing will retry shortly.'],
  ['Drive returned an incomplete listing. Resume this page to retry.', 'Drive returned an incomplete listing. Background indexing will retry this page.'],
  ['This Drive page expired. Resume to list the folder again.', 'This Drive page expired. Background indexing will restart this folder page.'],
  ['This file is outside the configured Figures folder.', 'The requested folder is outside the configured Figures folder. Check GOOGLE_DRIVE_ROOT_ID.'],
  ['This file or folder is in the trash. Refresh the index.', 'The Figures file or folder is in the trash. Restore it or check GOOGLE_DRIVE_ROOT_ID.'],
  ['This item is not a folder.', 'The configured Figures item is not a folder. Check GOOGLE_DRIVE_ROOT_ID.'],
  ['Request failed. Please try again.', 'The backend Drive request failed. Background indexing will retry shortly.']
]);
function driveFailure(message) {
  return (typeof message === 'string' && message.length <= 500 && DRIVE_FAILURES.get(message)) ||
    'The backend Drive connection failed. Check the service-account key, Google Drive API setup, and Figures folder sharing.';
}
function chunks(catalog) {
  const result = [];
  for (const key of ['records', 'runs', 'groups', 'warnings']) {
    let values = [], size = 0;
    for (const value of catalog[key] || []) {
      const bytes = Buffer.byteLength(JSON.stringify(value));
      if (bytes > 3500000) throw problem('A catalog record is too large to publish. The previous catalog is preserved.', 413);
      if (values.length && size + bytes > 500000) { result.push({ [key]: values }); values = []; size = 0; }
      values.push(value); size += bytes;
    }
    if (values.length) result.push({ [key]: values });
  }
  return result;
}
function createSharedDashboard({ rootId, password, store, drive, enqueue,
  now = () => Date.now(), batchPages = 8, batchMs = 150000 }) {
  if (!/^[\w-]+$/.test(rootId)) throw Error('Invalid shared root.');
  const prefix = 'dashboard/' + hash(rootId).slice(0, 20) + '/';
  const key = suffix => prefix + suffix;
  const timestamp = () => new Date(now()).toISOString();
  function folderDiagnostic(folder) {
    return folder ? { id: String(folder.id || '').slice(0, 200), path: String(folder.path || '').slice(0, 1000), attempts: Number.isSafeInteger(folder.attempts) ? folder.attempts : 0 } : null;
  }
  const secret = () => {
    if (typeof password !== 'string' || password.length === 0) throw problem('Set DASHBOARD_PASSWORD.', 503);
    return password;
  };
  function sign(value) { return crypto.createHmac('sha256', secret()).update(rootId + ':' + value).digest('base64url'); }
  function session() {
    const value = Buffer.from(JSON.stringify({ expires: now() + 7 * 86400000, nonce: crypto.randomBytes(16).toString('hex') })).toString('base64url');
    return value + '.' + sign(value);
  }
  function authenticated(req) {
    const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
    if (!cookie || cookie.length > 1000) return false;
    const parts = cookie.split('.'); if (parts.length !== 2) return false;
    const [value, signature] = parts;
    try { return signature && safeEqual(signature, sign(value)) && JSON.parse(Buffer.from(value, 'base64url')).expires > now(); }
    catch (_) { return false; }
  }
  async function status() {
    const saved = await store.read(key('work.json'));
    return saved ? progress(saved.value) : { active: false, files: 0, pendingFolders: 0, scannedFolders: 0, serverManaged: true, scheduled: false };
  }
  function progress(state) {
    const work = state.work;
    return { active: !!work && (!work.completedAt || !state.published) && !state.paused, paused: !!state.paused,
      files: work?.files.length || 0, pendingFolders: work?.queue.length || 0, scannedFolders: work?.scannedFolders || 0,
      startedAt: work?.startedAt || null, completedAt: work?.completedAt || null, lastError: state.error || '',
      serverManaged: true, scheduled: false, publishing: !!work?.completedAt && !state.published };
  }
  async function startIndex() {
    for (let attempt = 0; attempt < 8; attempt++) {
      const old = await store.read(key('work.json'));
      let state = old?.value;
      if (!state || state.published) {
        state = { id: crypto.randomUUID(), run: 0, work: null, published: false, paused: false, error: '' };
        const indexer = createIndexer({ rootId, core, api: drive.call, store: {
          get: async () => ({ work: state.work }), set: async saved => { state.work = saved.work; }
        } });
        await indexer.startIndex();
      }
      state.paused = false; state.error = ''; state.run = (state.run || 0) + 1;
      state.stage = 'queued'; state.queuedAt = timestamp();
      state.lastWorkerStartedAt = null; state.currentFolder = null;
      let written;
      try { written = await store.write(key('work.json'), state, old?.etag); }
      catch (error) {
        if (error.status === 409) continue;
        throw error;
      }
      // The checkpoint is also the visible status: no second write can orphan
      // this generation between saving it and submitting its queue message.
      let receipt;
      try { receipt = await enqueue({ jobId: state.id, run: state.run }); }
      catch (_) {
        state.error = 'Background indexing could not be queued. Check Vercel Queues and click Resume index.'; state.paused = true; state.stage = 'paused';
        try { await store.write(key('work.json'), state, written.etag); }
        catch (error) {
          if (error.status === 409) return status();
          throw error;
        }
        throw problem(state.error, 503);
      }
      return { ...progress(state), queueReceipt: { jobId: state.id, run: state.run, messageId: typeof receipt?.messageId === 'string' ? receipt.messageId.slice(0, 200) : null } };
    }
    const latest = await status();
    if (latest.active) return latest;
    throw problem('The shared checkpoint is busy. Try Resume index again shortly.', 409);
  }
  const cacheKey = (record, original = false) => key('previews/' + hash(record.id + ':' + (record.modifiedTime || '')) + (original ? '-original' : '-thumb') + '.json');
  async function cacheThumbnail(item) {
    if (!/^image\//.test(item.mimeType) && item.mimeType !== 'application/pdf') return;
    const path = cacheKey(item);
    if (await store.read(path)) return;
    const preview = await drive.thumbnail(item);
    if (!preview.dataUrl) return;
    try { await store.write(path, preview); } catch (error) { if (error.status !== 409) throw error; }
  }
  async function publish(state) {
    const catalog = core.buildCatalog_(state.work), parts = chunks(catalog);
    const version = state.id;
    // Immutable parts allow large catalogs without oversized function responses.
    let position = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (position < parts.length) {
        const i = position++, path = key('snapshots/' + version + '/part-' + i + '.json');
        if (!(await store.read(path))) {
          try { await store.write(path, parts[i]); } catch (error) { if (error.status !== 409) throw error; }
        }
      }
    }));
    const lookup = Object.fromEntries(state.work.files.map(f => [f.id, { id: f.id, name: f.name, path: f.path, mimeType: f.mimeType, size: f.size, modifiedTime: f.modifiedTime }]));
    lookup.$runs = Object.fromEntries(catalog.runs.map(r => [r.id, { id: r.id, name: r.name, path: r.path }]));
    const lookupPath = key('snapshots/' + version + '/lookup.json');
    if (!(await store.read(lookupPath))) {
      try { await store.write(lookupPath, lookup); } catch (error) { if (error.status !== 409) throw error; }
    }
    const latest = await store.read(key('work.json'));
    if (latest.value.id !== version || latest.value.run !== state.run) return;
    const current = await store.read(key('current.json'));
    if (current?.value.version !== version) {
      await store.write(key('current.json'), { version, parts: parts.length, rootId, schema: catalog.schema,
        indexedAt: catalog.indexedAt, startedAt: catalog.startedAt, complete: true, files: catalog.records.length }, current?.etag);
    }
    state.published = true; state.stage = 'complete'; state.currentFolder = null;
    await store.write(key('work.json'), state, latest.etag);
  }
  async function processJob({ jobId, run }) {
    const saved = await store.read(key('work.json'));
    if (!saved || saved.value.id !== jobId || saved.value.run !== run || saved.value.published || saved.value.paused) return;
    const state = saved.value, deadline = now() + batchMs;
    state.lastWorkerStartedAt = timestamp();
    let checkpointEtag = saved.etag;
    async function checkpoint() {
      try {
        const written = await store.write(key('work.json'), state, checkpointEtag);
        checkpointEtag = written.etag;
        return true;
      } catch (error) {
        if (error.status === 409) return false;
        throw error;
      }
    }
    const indexer = createIndexer({ rootId, core, api: async (action, args) => {
      state.stage = 'reading folder'; state.currentFolder = folderDiagnostic(state.work.queue[0]);
      if (!(await checkpoint())) throw problem('This worker was superseded by a newer checkpoint.', 409);
      const page = await drive.call(action, args);
      state.stage = 'caching thumbnails';
      if (!(await checkpoint())) throw problem('This worker was superseded by a newer checkpoint.', 409);
      let offset = 0;
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (offset < page.files.length) {
          const item = page.files[offset++];
          try { await cacheThumbnail(item); }
          catch (_) { (page.warnings ||= []).push({ id: item.id, message: 'Thumbnail caching failed; opening the figure will retry.' }); }
        }
      }));
      return page;
    }, store: { get: async () => ({ work: state.work }), set: async value => { state.work = value.work; } } });
    for (let pages = 0; pages < batchPages && now() < deadline && !state.work.completedAt; pages++) {
      try { await indexer.continueIndex(); }
      catch (error) {
        state.error = driveFailure(state.work.lastError) + ' Background retry is pending; the previous completed catalog is preserved.'; state.stage = 'retry pending';
        if (!(await checkpoint())) return;
        throw error;
      }
      state.error = '';
      if (state.work.completedAt) state.stage = 'publishing';
      // Publish progress before the next page's Drive reads and thumbnail work.
      // A stale worker's ETag fails before it can replace a resumed checkpoint.
      if (!(await checkpoint())) return;
    }
    if (state.work.completedAt) return publish(state);
    state.stage = 'queued'; state.queuedAt = timestamp();
    if (!(await checkpoint())) return;
    await enqueue({ jobId, run });
  }
  async function pauseJob(jobId, run) {
    const saved = await store.read(key('work.json'));
    if (!saved || saved.value.id !== jobId || saved.value.run !== run || saved.value.published) return;
    saved.value.paused = true; saved.value.stage = 'paused'; saved.value.error = 'Index paused after repeated backend errors. ' + driveFailure(saved.value.work?.lastError) + ' Fix the connection, then click Resume index.';
    try { await store.write(key('work.json'), saved.value, saved.etag); }
    catch (error) { if (error.status !== 409) throw error; }
  }
  let lookupCache;
  async function lookup() {
    const current = (await store.read(key('current.json')))?.value;
    if (!current) throw problem('Build the shared index first.', 409);
    if (lookupCache?.version !== current.version) lookupCache = {
      version: current.version, value: (await store.read(key('snapshots/' + current.version + '/lookup.json'), false))?.value || {}
    };
    return lookupCache.value;
  }
  async function record(id) {
    if (typeof id !== 'string' || !/^[\w-]{1,200}$/.test(id)) throw problem('Invalid file identifier.');
    const values = await lookup();
    const value = Object.hasOwn(values, id) && values[id];
    if (!value) throw problem('This file is not in the shared catalog. Refresh the index.', 403);
    return value;
  }
  async function runRecord(id) {
    if (typeof id !== 'string' || !/^[\w-]{1,200}$/.test(id)) throw problem('Invalid experiment identifier.');
    const values = (await lookup()).$runs || {};
    if (!Object.hasOwn(values, id)) throw problem('This experiment is unavailable. Refresh the shared index before pinning it.', 403);
    return values[id];
  }
  const boards = createBoards({ store, key, resolveFile: record, resolveRun: runRecord, now });
  async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    function send(code, body) {
      let text = JSON.stringify(body);
      if (Buffer.byteLength(text) > 4000000) { code = 413; text = JSON.stringify({ error: 'This preview is too large. Open the original in Drive.' }); }
      res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(text);
    }
    try {
      secret();
      if (req.method !== 'POST') throw problem('Use POST.', 405);
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || Buffer.byteLength(JSON.stringify(body)) > (body.action === 'saveBoard' ? 512000 : 16000)) throw problem('Request is too large. Reduce board tiles or note text.');
      const secure = req.headers['x-forwarded-proto'] === 'https' || !!process.env.VERCEL;
      const cookie = value => COOKIE + '=' + value + '; Path=/; HttpOnly; SameSite=Strict' + (secure ? '; Secure' : '');
      if (body.action === 'login') {
        if (typeof body.password !== 'string' || !safeEqual(body.password, password)) throw problem('Incorrect dashboard password.', 401);
        res.setHeader('Set-Cookie', cookie(session()) + '; Max-Age=604800'); return send(200, { connected: true });
      }
      if (!authenticated(req)) throw problem('Enter the shared dashboard password.', 401);
      if (body.action === 'logout') { res.setHeader('Set-Cookie', cookie('') + '; Max-Age=0'); return send(200, { connected: false }); }
      if (body.action === 'session') return send(200, { connected: true, mode: 'shared', rootId });
      if (body.action === 'getIndexDiagnostics') {
        const state = (await store.read(key('work.json')))?.value;
        const validTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value) ? value.slice(0, 40) : null;
        return send(200, { jobId: typeof state?.id === 'string' ? state.id.slice(0, 200) : null,
          run: Number.isSafeInteger(state?.run) ? state.run : null, pages: Number.isSafeInteger(state?.work?.pages) ? state.work.pages : 0,
          nextFolder: folderDiagnostic(state?.work?.queue?.[0]), currentFolder: folderDiagnostic(state?.currentFolder),
          published: !!state?.published, paused: !!state?.paused,
          stage: ['queued', 'reading folder', 'caching thumbnails', 'publishing', 'complete', 'retry pending', 'paused'].includes(state?.stage) ? state.stage : 'unknown',
          queuedAt: validTime(state?.queuedAt), lastWorkerStartedAt: validTime(state?.lastWorkerStartedAt) });
      }
      if (body.action === 'checkConnection') {
        let folder;
        try { folder = await drive.call('getMetadata', { id: rootId }); }
        catch (error) {
          throw problem(driveFailure(error.message), [400, 403, 404, 409, 429, 502, 503].includes(error.status) ? error.status : 503);
        }
        if (folder.mimeType !== 'application/vnd.google-apps.folder') throw problem(driveFailure('This item is not a folder.'), 400);
        return send(200, { connected: true, folder: { id: rootId, name: typeof folder.name === 'string' ? folder.name.slice(0, 500) : 'Figures' } });
      }
      if (body.action === 'listBoards') return send(200, { boards: await boards.list() });
      if (body.action === 'getBoard') return send(200, { board: await boards.get(body.id) });
      if (body.action === 'saveBoard') return send(200, { board: await boards.save(body.board, body.revision, body.copyFrom) });
      if (body.action === 'getCatalog') return send(200, {
        manifest: (await store.read(key('current.json')))?.value || null, status: await status()
      });
      if (body.action === 'catalogPage') {
        const current = (await store.read(key('current.json')))?.value;
        if (!current || body.version !== current.version) throw problem('Catalog changed. Reload the current catalog.', 409);
        if (!Number.isInteger(body.page) || body.page < 0 || body.page >= current.parts) throw problem('Invalid catalog page.');
        const part = await store.read(key('snapshots/' + current.version + '/part-' + body.page + '.json'), false);
        if (!part) throw problem('Catalog publication is incomplete. Try again.', 503);
        return send(200, part.value);
      }
      if (body.action === 'startIndex') return send(200, await startIndex());
      if (body.action === 'continueIndex') return send(200, await status());
      if (['getPreview', 'getFileDetail'].includes(body.action)) {
        const file = await record(body.id);
        if (body.action === 'getFileDetail') return send(200, await drive.call('getFileDetail', { id: file.id }));
        const original = body.original === true, path = cacheKey(file, original);
        if (original && /^image\/(png|jpeg|gif|webp|bmp)$/i.test(file.mimeType))
          return send(200, { url: '/api/original?id=' + encodeURIComponent(file.id), original: true, note: '' });
        let preview = (await store.read(path, false))?.value;
        if (!preview) {
          preview = await drive.call('getPreview', { id: file.id, original, thumbnailOnly: !original });
          // Missing thumbnails are retried later; never fetch full originals for gallery tiles.
          if (preview.dataUrl) {
            try { await store.write(path, preview); } catch (error) { if (error.status !== 409) throw error; }
          }
        }
        return send(200, preview);
      }
      throw problem('Unknown shared dashboard action.');
    } catch (error) {
      const status = error.status || (error instanceof SyntaxError ? 400 : 503);
      send(status, { error: error.status ? error.message : status === 400 ? 'Invalid JSON request.' : 'Shared dashboard unavailable. Check backend credentials and private storage.' });
    }
  }
  async function fileHandler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (req.method !== 'GET') throw problem('Use GET.', 405);
      secret();
      if (!authenticated(req)) throw problem('Enter the shared dashboard password.', 401);
      const id = new URL(req.url, 'http://localhost').searchParams.get('id');
      await record(id);
      const { file, response } = await drive.open(id);
      const inline = /^image\/(png|jpeg|gif|webp|bmp)$/i.test(file.mimeType);
      res.statusCode = 200; res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Disposition', (inline ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(file.name));
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
      // Streaming avoids buffering large originals into base64 JSON responses.
      await pipeline(Readable.fromWeb(response.body), res);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      res.statusCode = error.status || 503; res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(error.status ? error.message : 'Original unavailable. Check the backend Drive connection.');
    }
  }
  return { handler, fileHandler, processJob, pauseJob, startIndex, key, status };
}
module.exports = { createSharedDashboard, chunks };
