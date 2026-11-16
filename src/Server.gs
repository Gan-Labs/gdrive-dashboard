const RESULTS = Object.freeze({
  rootId: '1qXAMcNrZuqk4wlGbqZlmHydQ-cSthbIV',
  parentId: '120nqRb8f5dfpMJ9-1CjBWZJ2YS5GU0eH',
  name: 'Entropy Results Dashboard',
  batchMs: 20000, maxPages: 12, pageSize: 100,
  maxTextBytes: 512000, maxImageBytes: 5000000,
  refreshHours: 6
});

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle(RESULTS.name).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include_(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

/* Run setup once in the Apps Script editor to authorize Drive and the refresh trigger. */
function setup() {
  DriveApp.getFolderById(RESULTS.rootId).getName();
  const status = withLock_(function () {
    storage_();
    startWork_();
    if (!ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'refreshScheduled'; }))
      ScriptApp.newTrigger('refreshScheduled').timeBased().everyMinutes(5).create();
    return status_();
  });
  const scanned = continueIndex();
  console.log(JSON.stringify({ setup: 'complete', status: scanned || status }));
  return scanned || status;
}

function getCatalog() {
  return withLock_(function () {
    const db = storage_();
    const catalog = readJsonFile_(db.catalogId);
    const work = readJsonFile_(db.workId);
    return { catalog: catalog || (work ? buildCatalog_(work) : emptyCatalog_()), status: status_(work, db) };
  });
}

function startIndex() {
  return withLock_(function () { startWork_(); return status_(); });
}

function continueIndex() {
  return withLock_(function () {
    const db = storage_();
    const work = readJsonFile_(db.workId);
    if (!work || work.completedAt) return status_(work, db);
    const deadline = Date.now() + RESULTS.batchMs;
    let pages = 0;
    while (work.queue.length && Date.now() < deadline && pages < RESULTS.maxPages) {
      const job = work.queue[0];
      try {
        const options = { q: "'" + job.id + "' in parents and trashed = false",
          pageSize: RESULTS.pageSize, fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime)',
          supportsAllDrives: true, includeItemsFromAllDrives: true };
        if (job.pageToken) options.pageToken = job.pageToken;
        const page = Drive.Files.list(options);
        (page.files || []).forEach(function (item) {
          if (work.seen[item.id]) return;
          const entry = { id: item.id, name: item.name, mimeType: item.mimeType,
            size: Number(item.size || 0), modifiedTime: item.modifiedTime || '',
            parentId: job.id, path: job.path ? job.path + '/' + item.name : item.name };
          if (item.mimeType === 'application/vnd.google-apps.folder') {
            work.folders.push(entry);
            work.queue.push({ id: item.id, path: entry.path, attempts: 0 });
          } else {
            work.files.push(entry);
            if (/^(status|summarized_metrics|metadata|ui_rendering_metadata|metrics|results)\.json$/i.test(item.name) && entry.size <= RESULTS.maxTextBytes) {
              try {
                work.summaries[item.id] = summarizeJson_(item.name,
                  JSON.parse(DriveApp.getFileById(item.id).getBlob().getDataAsString('UTF-8')));
              } catch (error) {
                work.warnings.push({ path: entry.path, message: 'Metadata could not be parsed: ' + String(error.message || error).slice(0, 220) });
              }
            }
          }
          work.seen[item.id] = true;
        });
        work.pages++;
        if (page.nextPageToken) job.pageToken = page.nextPageToken;
        else { work.queue.shift(); work.scannedFolders++; }
        job.attempts = 0;
      } catch (error) {
        job.attempts = (job.attempts || 0) + 1;
        work.lastError = String(error.message || error).slice(0, 300);
        // Keep the current page queued. A failed request must never become a silent omission.
        writeJsonFile_(db.workId, work);
        throw new Error('Index paused at ' + (job.path || 'Figures') + ': ' + work.lastError + '. Use Resume index to retry.');
      }
      pages++;
    }
    work.lastError = '';
    if (!work.queue.length) {
      work.completedAt = new Date().toISOString();
      // Publish only a finished snapshot; readers keep the previous one during a refresh.
      writeJsonFile_(db.catalogId, buildCatalog_(work));
    }
    writeJsonFile_(db.workId, work);
    return status_(work, db);
  });
}

function refreshScheduled() {
  const db = storage_();
  const work = readJsonFile_(db.workId);
  const age = work && work.completedAt ? Date.now() - Date.parse(work.completedAt) : Infinity;
  if (!work || (work.completedAt && age > RESULTS.refreshHours * 3600000)) startIndex();
  return continueIndex();
}

function getPreview(id, original) {
  const record = knownRecord_(id);
  assertWithinRoot_(id);
  const key = 'preview:' + id + ':' + record.modifiedTime + ':' + !!original;
  const cache = CacheService.getUserCache();
  const cached = cache.get(key);
  if (cached) return { dataUrl: cached, original: !!original };
  const file = DriveApp.getFileById(id);
  const mime = file.getMimeType();
  const safeImage = /^(image\/(png|jpeg|gif|webp|bmp))$/i.test(mime);
  let blob = null;
  let isOriginal = false;
  if (original && safeImage && file.getSize() <= RESULTS.maxImageBytes) {
    blob = file.getBlob(); isOriginal = true;
  } else {
    blob = file.getThumbnail();
    if (!blob && safeImage && file.getSize() <= RESULTS.maxImageBytes) { blob = file.getBlob(); isOriginal = true; }
  }
  if (!blob) return { dataUrl: '', original: false, note: 'Preview unavailable. Open the original in Drive.' };
  if (!/^image\/(png|jpeg|gif|webp|bmp)$/i.test(blob.getContentType()))
    return { dataUrl: '', original: false, note: 'Open this format in Drive.' };
  const dataUrl = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  if (dataUrl.length < 90000) cache.put(key, dataUrl, 900);
  return { dataUrl: dataUrl, original: isOriginal,
    note: original && !isOriginal ? 'Thumbnail preview. Open in Drive for the full-resolution original.' : '' };
}

function getFileDetail(id) {
  const record = knownRecord_(id);
  assertWithinRoot_(id);
  const response = { record: record, text: '', table: null, note: '' };
  const file = DriveApp.getFileById(id);
  if (/^(json|csv|text)$/.test(record.fileKind)) {
    if (file.getSize() > RESULTS.maxTextBytes) response.note = 'This file is too large for an inline preview. Open it in Drive.';
    else {
      response.text = file.getBlob().getDataAsString('UTF-8');
      if (record.fileKind === 'json') {
        try { response.text = JSON.stringify(JSON.parse(response.text), null, 2); }
        catch (_) { response.note = 'The original file is not valid JSON; its text is shown below.'; }
      }
      if (record.fileKind === 'csv') {
        try {
          const rows = Utilities.parseCsv(response.text);
          response.table = { rows: rows.slice(0, 101).map(function (row) { return row.slice(0, 30); }),
            totalRows: Math.max(0, rows.length - 1), truncated: rows.length > 101 || rows.some(function (row) { return row.length > 30; }) };
          response.text = '';
        } catch (_) { response.note = 'CSV could not be parsed; the original text is shown.'; }
      }
    }
  }
  return response;
}

function knownRecord_(id) {
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('Invalid file identifier.');
  const db = storage_();
  const saved = readJsonFile_(db.catalogId);
  let record = saved && saved.records.find(function (r) { return r.id === id; });
  if (!record) {
    const work = readJsonFile_(db.workId);
    if (work) record = buildCatalog_(work).records.find(function (r) { return r.id === id; });
  }
  if (!record) throw new Error('This file is not in the Figures catalog. Refresh the index and try again.');
  return record;
}

function assertWithinRoot_(id) {
  let next = [id];
  const seen = {};
  for (let depth = 0; depth < 40 && next.length; depth++) {
    const current = next.shift();
    if (current === RESULTS.rootId) return;
    if (seen[current]) continue;
    seen[current] = true;
    const file = Drive.Files.get(current, { fields: 'id,parents,trashed', supportsAllDrives: true });
    if (file.trashed) throw new Error('This file or its folder is in the trash. Refresh the index.');
    next = next.concat(file.parents || []);
  }
  throw new Error('This file is no longer inside Figures. Refresh the index.');
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('The index is already being updated. Please try again shortly.');
  try { return fn(); } finally { lock.releaseLock(); }
}

function storage_() {
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty('RESULTS_STORAGE');
  if (existing) return JSON.parse(existing);
  // A private app-data folder in My Drive; never write inside the research results.
  const folder = DriveApp.createFolder(RESULTS.name + ' — app data');
  const db = { folderId: folder.getId(),
    catalogId: folder.createFile('catalog.json', 'null', MimeType.PLAIN_TEXT).getId(),
    workId: folder.createFile('index-work.json', 'null', MimeType.PLAIN_TEXT).getId() };
  props.setProperty('RESULTS_STORAGE', JSON.stringify(db));
  return db;
}

function readJsonFile_(id) { return JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8')); }
function writeJsonFile_(id, value) { DriveApp.getFileById(id).setContent(JSON.stringify(value)); }

function startWork_() {
  const db = storage_();
  const old = readJsonFile_(db.workId);
  if (old && !old.completedAt) return old;
  const work = { schema: 1, rootId: RESULTS.rootId, startedAt: new Date().toISOString(),
    queue: [{ id: RESULTS.rootId, path: '', attempts: 0 }], seen: {},
    folders: [], files: [], summaries: {}, warnings: [], pages: 0, scannedFolders: 0, lastError: '' };
  writeJsonFile_(db.workId, work);
  return work;
}

function status_(work, db) {
  if (work === undefined) { db = storage_(); work = readJsonFile_(db.workId); }
  return { active: !!(work && !work.completedAt), scannedFolders: work ? work.scannedFolders : 0,
    pendingFolders: work ? work.queue.length : 0, files: work ? work.files.length : 0,
    startedAt: work ? work.startedAt : null, completedAt: work ? work.completedAt || null : null,
    lastError: work ? work.lastError || '' : '', warnings: work ? work.warnings : [],
    scheduled: ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'refreshScheduled'; }) };
}

function emptyCatalog_() {
  return { schema: 1, rootId: RESULTS.rootId, indexedAt: null, complete: false,
    groups: [], records: [], runs: [], warnings: [] };
}
