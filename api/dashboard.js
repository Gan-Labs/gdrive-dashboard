'use strict';
const { summarizeJson_, fileKind_ } = require('../src/Core.gs');
const DEFAULT_ROOT = '1qXAMcNrZuqk4wlGbqZlmHydQ-cSthbIV';
const FOLDER = 'application/vnd.google-apps.folder';
const IMAGE = /^image\/(png|jpeg|gif|webp|bmp)$/i;
const MAX_TEXT = 512000;
// Base64 + JSON remains below Vercel's 4.5 MB function response limit.
const MAX_IMAGE = 2800000;
const SUMMARY_NAME = /^(status|summarized_metrics|metadata|ui_rendering_metadata|metrics|results)\.json$/i;

function failure(message, status = 400) { return Object.assign(new Error(message), { status }); }
function identifier(value) {
  if (typeof value !== 'string' || !/^[\w-]{1,200}$/.test(value)) throw failure('Invalid Drive identifier.');
  return value;
}
function compactSummary(summary) {
  const truncated = summary.metrics.length > 64 || summary.facts.length > 64 || summary.classes.length > 200 ||
    summary.facts.some(f => String(f.label).length > 100 || String(f.value).length > 500) ||
    summary.metrics.some(m => String(m.block).length > 200) || summary.classes.some(c => c.length > 200);
  return { truncated, state: String(summary.state || '').slice(0, 100),
    metrics: summary.metrics.slice(0, 64).map(m => ({ ...m, label: String(m.label).slice(0, 100), split: String(m.split).slice(0, 100), block: String(m.block).slice(0, 200) })),
    facts: summary.facts.slice(0, 64).map(f => ({ label: String(f.label).slice(0, 100), value: String(f.value).slice(0, 500) })),
    classes: summary.classes.slice(0, 200).map(c => c.slice(0, 200)) };
}
async function bounded(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) throw failure('File exceeds the inline preview limit.', 413);
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw failure('File exceeds the inline preview limit.', 413);
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}
function parseCsv(text) {
  const rows = []; let row = [], value = '', quoted = false, afterQuote = false, columns = 0, totalRows = 0, truncated = false;
  function field() { columns++; if (row.length < 30) row.push(value); else truncated = true; value = ''; afterQuote = false; }
  function line() { field(); totalRows++; if (rows.length < 101) rows.push(row); else truncated = true; row = []; columns = 0; }
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (c === '"') { quoted = false; afterQuote = true; }
      else value += c;
    } else if (c === '"' && !value && !afterQuote) quoted = true;
    else if (c === ',') field();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; line(); }
    else { if (afterQuote) throw failure('Malformed CSV.'); value += c; }
  }
  if (quoted) throw failure('Unterminated quoted CSV field.');
  if (value || columns || row.length || afterQuote) line();
  return { rows, totalRows: Math.max(0, totalRows - 1), truncated };
}

function createHandler({ fetchImpl = global.fetch, rootId = process.env.GOOGLE_DRIVE_ROOT_ID || DEFAULT_ROOT } = {}) {
  identifier(rootId);
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (code, body) => {
      let json = JSON.stringify(body);
      if (Buffer.byteLength(json) > 4000000) { code = 413; json = JSON.stringify({ error: 'This preview is too large. Open the original in Drive.' }); }
      res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(json);
    };
    try {
      const deadline = AbortSignal.timeout(45000);
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw failure('Use POST.', 405); }
      const authorization = req.headers.authorization || '';
      if (!/^Bearer [A-Za-z0-9._~+\/-]+=*$/.test(authorization) || authorization.length > 8192)
        throw failure('Connect your Google account to open the dashboard.', 401);
      const raw = req.body;
      const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!body || Buffer.byteLength(JSON.stringify(body)) > 16000) throw failure('Invalid request body.');
      const actions = ['session', 'listFolder', 'getPreview', 'getFileDetail'];
      if (!actions.includes(body.action)) throw failure('Unknown dashboard action.');
      const metadata = new Map();
      async function google(url) {
        const response = await fetchImpl(url, { headers: { Authorization: authorization }, redirect: 'error', signal: AbortSignal.any([deadline, AbortSignal.timeout(12000)]) });
        if (!response.ok) {
          if (response.status === 401) throw failure('Google authorization expired. Connect again to continue.', 401);
          if (response.status === 403 || response.status === 404) throw failure('Your Google account cannot access this Figures file or folder.', 403);
          if (response.status === 429) throw failure('Google Drive is rate limiting requests. Resume the scan shortly.', 429);
          if (response.status === 400) throw failure('Google Drive rejected this request.', 400);
          throw failure('Google Drive is temporarily unavailable. Try again.', 502);
        }
        return response;
      }
      const drive = (path, params) => google('https://www.googleapis.com/drive/v3/' + path + '?' + new URLSearchParams(params));
      async function get(id) {
        identifier(id);
        if (!metadata.has(id)) metadata.set(id, await (await drive('files/' + id, {
          fields: 'id,name,mimeType,size,modifiedTime,parents,trashed,thumbnailLink', supportsAllDrives: 'true'
        })).json());
        return metadata.get(id);
      }
      async function withinRoot(id) {
        const file = await get(id); let next = [file]; const seen = new Set();
        for (let steps = 0; next.length && steps < 40; steps++) {
          const current = next.shift();
          if (current.trashed) throw failure('This file or folder is in the trash. Refresh the index.', 403);
          if (current.id === rootId) return file;
          if (seen.has(current.id)) continue;
          seen.add(current.id);
          for (const parent of current.parents || []) next.push(await get(parent));
        }
        throw failure('This file is outside the configured Figures folder.', 403);
      }
      const download = async (id, max) => bounded(await drive('files/' + id, { alt: 'media', supportsAllDrives: 'true' }), max);
      if (body.action === 'session') {
        await withinRoot(rootId);
        const about = await (await drive('about', { fields: 'user(emailAddress,permissionId,displayName)' })).json();
        return send(200, { rootId, user: about.user });
      }
      const id = identifier(body.id);
      const file = await withinRoot(id);
      if (body.action === 'listFolder') {
        if (file.mimeType !== FOLDER) throw failure('This item is not a folder.');
        if (body.pageToken && (typeof body.pageToken !== 'string' || body.pageToken.length > 4096)) throw failure('Invalid page token.');
        let page;
        try { page = await (await drive('files', {
          q: "'" + id + "' in parents and trashed = false", pageSize: '40',
          fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,size,modifiedTime)',
          supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...(body.pageToken ? { pageToken: body.pageToken } : {})
        })).json(); }
        catch (error) {
          if (body.pageToken && error.status === 400) return send(409, { error: 'This Drive page expired. Resume to list the folder again.', code: 'PAGE_EXPIRED' });
          throw error;
        }
        if (page.incompleteSearch) throw failure('Drive returned an incomplete listing. Resume this page to retry.', 503);
        const summaries = {}, warnings = [];
        // A bounded concurrency batch; every requested page finishes before returning.
        const items = page.files || []; let offset = 0;
        await Promise.all(Array.from({ length: 4 }, async () => {
          while (offset < items.length) {
            const item = items[offset++];
            if (!SUMMARY_NAME.test(item.name) || Number(item.size) > MAX_TEXT) continue;
            try {
              summaries[item.id] = compactSummary(summarizeJson_(item.name, JSON.parse((await download(item.id, MAX_TEXT)).toString('utf8'))));
              if (summaries[item.id].truncated) warnings.push({ id: item.id, message: 'Summary display was shortened to fit preview limits. Open the source file for the complete metadata.' });
            }
            catch (error) {
              // Authentication/rate failures must retain the whole page for retry.
              if ([401, 429, 502, 503].includes(error.status)) throw error;
              warnings.push({ id: item.id, message: 'Metadata could not be parsed or read.' });
            }
          }
        }));
        return send(200, { files: items, nextPageToken: page.nextPageToken || '', summaries, warnings });
      }
      if (body.action === 'getPreview') {
        let bytes, mime, original = false;
        if (body.original === true && IMAGE.test(file.mimeType) && Number(file.size) <= MAX_IMAGE) {
          bytes = await download(id, MAX_IMAGE); mime = file.mimeType; original = true;
        } else if (file.thumbnailLink) {
          const url = new URL(file.thumbnailLink);
          // Never forward a Google bearer token to an arbitrary metadata URL.
          if (url.protocol === 'https:' && /(^|\.)(googleusercontent\.com|googleapis\.com)$/.test(url.hostname)) {
            const response = await google(url.href); mime = response.headers.get('content-type')?.split(';')[0];
            bytes = await bounded(response, MAX_IMAGE);
          }
        }
        if (!bytes && IMAGE.test(file.mimeType) && Number(file.size) <= MAX_IMAGE) {
          bytes = await download(id, MAX_IMAGE); mime = file.mimeType; original = true;
        }
        if (!bytes || !IMAGE.test(mime)) return send(200, { dataUrl: '', original: false, note: 'Preview unavailable. Open the original in Drive.' });
        return send(200, { dataUrl: 'data:' + mime + ';base64,' + bytes.toString('base64'), original,
          note: body.original && !original ? 'Thumbnail preview. Open in Drive for the full-resolution original.' : '' });
      }
      const response = { record: { ...file, thumbnailLink: undefined, fileKind: fileKind_(file.name, file.mimeType) }, text: '', table: null, note: '' };
      if (/^(json|csv|text)$/.test(response.record.fileKind)) {
        if (Number(file.size) > MAX_TEXT) response.note = 'This file is too large for an inline preview. Open it in Drive.';
        else {
          response.text = (await download(id, MAX_TEXT)).toString('utf8');
          if (response.record.fileKind === 'json') {
            try { response.text = JSON.stringify(JSON.parse(response.text), null, 2); }
            catch (_) { response.note = 'The original file is not valid JSON; its text is shown below.'; }
          }
          if (response.record.fileKind === 'csv') {
            try { response.table = parseCsv(response.text); response.text = ''; }
            catch (_) { response.note = 'CSV could not be parsed; the original text is shown.'; }
          }
        }
      }
      return send(200, response);
    } catch (error) {
      // Never return upstream response bodies, URLs, or credentials.
      const status = error.status || (error instanceof SyntaxError ? 400 : 502);
      send(status, { error: error.status ? error.message : status === 400 ? 'Invalid JSON request.' : 'Request failed. Please try again.' });
    }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.parseCsv = parseCsv;
module.exports.MAX_IMAGE = MAX_IMAGE;
