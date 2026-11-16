// Entropy Results Dashboard — standalone manual installation.
// Paste this entire file into Code.gs. The interface is embedded below.
// Source files are bundled locally; Google Drive data is loaded only at runtime.

/* Pure catalog transformations. No Google services or browser APIs here. */
function describePath_(path, name) {
  const p = String(path || '');
  const n = String(name || '');
  const dataset = /ucf11/i.test(p) ? 'UCF11' : /hmdb51/i.test(p) ? 'HMDB51' :
    /deepaction/i.test(p) ? 'DeepAction' : /casia[ -]?b/i.test(p) ? 'CASIA-B' :
    /youtube/i.test(p) ? 'YouTube' : 'Other';
  const model = /resnet/i.test(p) ? 'ResNet' : /wpp/i.test(p) ? 'WPP Transformer' :
    /transformer/i.test(p) ? 'Transformer' : 'Other';
  const analysis = /attribution/i.test(p) ? 'Class attribution' :
    /linear[_ ]?probes?/i.test(p) ? 'Linear probes' :
    /divergence|payload_kl/i.test(p) ? 'Divergence' : 'Train & evaluate';
  const bitrate = p.match(/(?:^|[_/ -])(\d+)k(?=[_/ -]|$)/i);
  const gop = p.match(/gop(\d+(?:-\d+)?)/i);
  const cls = p.match(/\/([^/]+?)(?:_?class_attribution_export)(?:\/|$)/i);
  let kind = /confusion/i.test(n) ? 'Confusion matrix' : /attribution/i.test(n) ? 'Attribution map' :
    /accuracy/i.test(n) ? 'Accuracy' : /precision/i.test(n) ? 'Precision' :
    /recall/i.test(n) ? 'Recall' : /f1/i.test(n) ? 'F1 score' :
    /loss/i.test(n) ? 'Loss' : /heatmap/i.test(n) ? 'Heatmap' : 'Figure';
  if (/final_test_metrics_by_block/i.test(n)) kind = 'Probe comparison';
  return { dataset: dataset, model: model, analysis: analysis,
    bitrate: bitrate ? bitrate[1] + 'k' : '', gop: gop ? gop[1] : '',
    className: cls ? cls[1].replace(/_/g, ' ') : '',
    modality: /silhouette/i.test(p) ? 'Silhouette' : /\brgb\b/i.test(p) ? 'RGB' : '', kind: kind };
}

function fileKind_(name, mime) {
  if (/^image\//.test(mime)) return 'image';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (/\.json$/i.test(name)) return 'json';
  if (/\.csv$/i.test(name)) return 'csv';
  if (/\.(txt|md|log|yaml|yml)$/i.test(name)) return 'text';
  return 'file';
}

function summarizeJson_(name, data) {
  const result = { metrics: [], facts: [], state: '', classes: [] };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return result;
  function fact(label, value) {
    if (value !== undefined && value !== null && typeof value !== 'object')
      result.facts.push({ label: label, value: String(value) });
  }
  function metrics(obj, split, block) {
    if (!obj || typeof obj !== 'object') return;
    const keys = { accuracy: 'Accuracy', macro_f1: 'Macro F1', weighted_f1: 'Weighted F1',
      loss: 'Loss', test_loss: 'Loss', multinomial_log_loss: 'Log loss' };
    Object.keys(keys).forEach(function (key) {
      if (typeof obj[key] === 'number' && Number.isFinite(obj[key]))
        result.metrics.push({ label: keys[key], split: split, block: block || '', value: obj[key] });
    });
  }
  if (name === 'status.json') {
    result.state = String(data.state || '');
    metrics(data.latest_validation_metrics, 'Latest validation');
    fact('Completed epochs', data.completed_epochs);
    fact('Best epoch', data.best_epoch);
    fact('Best validation loss', data.best_validation_loss);
    fact('Parameters', data.parameter_count);
  }
  if (name === 'summarized_metrics.json' || name === 'metrics.json' || name === 'results.json') {
    const split = /test/i.test(String(data.evaluation_kind || '')) ? 'Test' : 'Reported (split unspecified)';
    metrics(data, split);
    metrics(data.test_metrics, 'Test');
    metrics(data.validation_metrics, 'Validation');
    Object.keys(data.blocks || {}).forEach(function (block) {
      metrics(data.blocks[block].final_train_validation_refit_test_metrics, 'Test after refit', block);
    });
    fact('Evaluation', data.evaluation_kind);
    fact('Samples', data.sample_count);
  }
  const m = data.metadata || {};
  const opts = data.ui_options || m.settings || {};
  const names = opts.classes || (m.cache_fingerprint || {}).class_names || [];
  result.classes = names.filter(function (x) { return typeof x === 'string'; });
  fact('Grouping', opts.grouping || opts.group_by);
  fact('Correctness', opts.correctness);
  fact('IG target', opts.ig_target);
  fact('Magnitude', opts.magnitude);
  fact('Sign', opts.sign);
  fact('Available videos', m.available_videos);
  fact('Expected videos', m.expected_videos);
  fact('Missing videos', m.missing_videos);
  if (Array.isArray(data.groups)) data.groups.forEach(function (g) {
    if (typeof g.count === 'number') fact(String(g.split || 'Group') + ' videos', g.count);
  });
  return result;
}

function buildCatalog_(work) {
  const folders = work.folders || [];
  const files = work.files || [];
  const byFolder = {};
  const byParent = {};
  folders.forEach(function (f) { byFolder[f.id] = f; });
  files.forEach(function (f) { (byParent[f.parentId] || (byParent[f.parentId] = [])).push(f); });
  const groups = folders.filter(function (f) { return f.parentId === work.rootId; });
  const runMap = {};
  const records = files.map(function (f) {
    const inferred = describePath_(f.path, f.name);
    let current = byFolder[f.parentId];
    let run = current;
    let group = null;
    let status = null;
    const summaries = [];
    const relatedIds = [];
    const visited = {};
    while (current && !visited[current.id]) {
      visited[current.id] = true;
      (byParent[current.id] || []).forEach(function (item) {
        const summary = (work.summaries || {})[item.id];
        if (summary) {
          summaries.push({ id: item.id, name: item.name, summary: summary });
          if (!status && summary.state) status = summary;
        }
        if (/^(metadata|ui_rendering_metadata|status|config|summarized_metrics|data)\.(json|yaml)$/i.test(item.name))
          relatedIds.push(item.id);
      });
      if (current.parentId === work.rootId) { group = current; break; }
      run = current;
      current = byFolder[current.parentId];
    }
    if (!group) group = { id: work.rootId, name: 'Other results' };
    if (!run || run.id === work.rootId) run = group;
    const record = Object.assign({}, f, inferred, {
      groupId: group.id, groupName: group.name,
      runId: run.id, runName: run.name,
      fileKind: fileKind_(f.name, f.mimeType),
      state: status ? status.state : '', relatedIds: Array.from(new Set(relatedIds)),
      summaries: summaries
    });
    if (!runMap[run.id]) runMap[run.id] = {
      id: run.id, name: run.name, path: run.path || group.name, groupId: group.id,
      groupName: group.name, dataset: inferred.dataset, model: inferred.model,
      analysis: describePath_(run.path || f.path, '').analysis,
      bitrate: inferred.bitrate, gop: inferred.gop, className: inferred.className, modality: inferred.modality, state: '',
      figures: 0, files: 0, metrics: [], modifiedTime: ''
    };
    const r = runMap[run.id];
    r.files++;
    if (record.fileKind === 'image' || record.fileKind === 'pdf') r.figures++;
    if (f.name === 'status.json' && (work.summaries || {})[f.id]) r.state = work.summaries[f.id].state;
    if ((work.summaries || {})[f.id]) {
      work.summaries[f.id].metrics.forEach(function (metric) {
        r.metrics.push(Object.assign({}, metric, { sourceId: f.id, sourcePath: f.path }));
      });
    }
    if ((f.modifiedTime || '') > r.modifiedTime) r.modifiedTime = f.modifiedTime;
    return record;
  });
  groups.forEach(function (g) {
    g.figures = records.filter(function (r) { return r.groupId === g.id && /^(image|pdf)$/.test(r.fileKind); }).length;
    g.files = records.filter(function (r) { return r.groupId === g.id; }).length;
  });
  return { schema: 1, rootId: work.rootId, startedAt: work.startedAt,
    indexedAt: work.completedAt || null, complete: !!work.completedAt,
    warnings: work.warnings || [], groups: groups, records: records,
    runs: Object.keys(runMap).map(function (id) { return runMap[id]; }) };
}

const RESULTS = Object.freeze({
  rootId: '1qXAMcNrZuqk4wlGbqZlmHydQ-cSthbIV',
  parentId: '120nqRb8f5dfpMJ9-1CjBWZJ2YS5GU0eH',
  name: 'Entropy Results Dashboard',
  batchMs: 20000, maxPages: 12, pageSize: 100,
  maxTextBytes: 512000, maxImageBytes: 5000000,
  refreshHours: 6
});

function doGet() {
  return HtmlService.createHtmlOutput(getDashboardHtml_())
    .setTitle(RESULTS.name).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}


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

function getDashboardHtml_() {
  return "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <base target=\"_top\">\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n  <style>\n:root{--ink:#172c3b;--muted:#647580;--line:#e2e8e8;--paper:#f5f7f6;--teal:#14675d;--teal-light:#e6f2ed;--nav:#102b35;--nav-muted:#9eb6bb;--radius:12px;--shadow:0 14px 40px #102b3512;font-family:Inter,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;color:var(--ink);font-synthesis:none}\n*{box-sizing:border-box}body{margin:0;background:var(--paper);font-size:14px}button,input,select{font:inherit}button,a,select,input{touch-action:manipulation}button{cursor:pointer}button:disabled{cursor:wait;opacity:.65}a{color:var(--teal);text-decoration:none}a:hover{text-decoration:underline}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #4eafa3;outline-offset:3px}[hidden]{display:none!important}.skip{position:fixed;z-index:100;left:12px;top:-70px;background:white;padding:12px}.skip:focus{top:12px}.sidebar{position:fixed;left:0;top:0;bottom:0;width:250px;background:var(--nav);color:#eff6f5;padding:30px 17px 100px;overflow-y:auto}.brand{display:flex;gap:13px;align-items:center;padding:0 9px 37px;font-size:17px;font-weight:700;letter-spacing:2.2px}.brand span:not(.brand-mark){display:block;font-size:9px;letter-spacing:1.8px;color:var(--nav-muted);margin-top:7px;font-weight:500}.brand .brand-mark{font:italic 35px Georgia,serif;letter-spacing:0;color:#8fd6c3}.nav-label{font-size:10px;letter-spacing:1.6px;color:var(--nav-muted);font-weight:600;margin:13px 10px}.nav-item{background:transparent;border:0;color:#c9d9dc;display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:left;border-radius:7px;padding:12px 11px;margin:3px 0;line-height:1.45}.nav-item span:first-child{overflow-wrap:anywhere}.nav-item:hover{background:#ffffff0b}.nav-item.active{background:#245149;color:white}.nav-count{font-size:11px;color:#a8c9c3;border-radius:4px;background:#ffffff0b;padding:2px 6px;flex-shrink:0}.nav-heading{display:flex;align-items:center;justify-content:space-between;margin-top:28px}.nav-heading>span{font-size:11px;color:#9eb6bb;padding-right:11px}.nav-placeholder{padding:0 10px}.group-item{font-size:12px;padding-top:11px;padding-bottom:11px}.sidebar-bottom{position:fixed;bottom:0;left:0;width:250px;display:flex;gap:10px;align-items:center;padding:21px 24px;background:var(--nav);border-top:1px solid #ffffff12;font-size:12px}.sidebar-bottom div{flex:1}.sidebar-bottom div>span{display:block;font-size:10px;color:var(--nav-muted);margin-top:5px}.sidebar-bottom>a{color:#b7d7d1;font-size:20px}.status-dot{width:7px;height:7px;border-radius:50%;background:#82cdb5}.workspace{margin-left:250px}.topbar{height:72px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 38px;background:#fff;gap:14px}.breadcrumbs,.top-actions{display:flex;gap:14px;align-items:center}.breadcrumbs{font-size:12px;color:var(--muted)}.breadcrumbs strong{color:var(--ink);font-weight:500}.private-label{font-size:9px;letter-spacing:1px;font-weight:700;color:var(--teal);background:var(--teal-light);border-radius:4px;padding:5px 7px}.button{border:1px solid #d2dcda;border-radius:7px;background:white;color:var(--ink);padding:10px 14px;display:inline-flex;align-items:center;justify-content:center;gap:12px;font-size:12px;font-weight:600;text-decoration:none;white-space:nowrap}.button:hover{background:#f3f7f5;text-decoration:none}.button.primary{background:var(--teal);color:white;border-color:var(--teal)}.button.primary:hover{background:#0d564d}.button.subtle{background:transparent;border-color:transparent}.text-button{border:0;background:transparent;color:var(--teal);font-size:12px;font-weight:600;padding:9px 3px;white-space:nowrap}.text-button:hover{text-decoration:underline}.icon-button{border:1px solid var(--line);background:#fff;color:var(--ink);width:34px;height:34px;border-radius:7px;font-size:22px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}.icon-button.saved{color:#a16c1d;background:#fff5df;border-color:#ead19f}main{max-width:1880px;margin:0 auto;padding:38px}.page-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:28px}.eyebrow{font-size:10px;font-weight:700;letter-spacing:1.8px;color:var(--teal);margin:0 0 11px}h1{font-size:31px;line-height:1.25;font-weight:600;letter-spacing:-.8px;margin:0 0 10px}h2{font-size:22px;line-height:1.3;margin:0;overflow-wrap:anywhere}.subtitle{color:var(--muted);font-size:13px;line-height:1.6;margin:0}.refresh-area{display:flex;flex-direction:column;align-items:flex-end;gap:9px;flex-shrink:0}.muted{font-size:11px;color:var(--muted);line-height:1.55}.statistics{display:grid;grid-template-columns:repeat(4,1fr);background:#fff;border:1px solid var(--line);border-radius:var(--radius);margin-bottom:28px;padding:22px 0}.statistics>div{padding:0 25px;border-right:1px solid var(--line)}.statistics>div:last-child{border:0}.statistics span{font-size:11px;color:var(--muted);display:block;margin-bottom:10px}.statistics strong{font-size:27px;letter-spacing:-.8px;font-weight:600}.explorer{background:white;border:1px solid var(--line);border-radius:var(--radius);padding:0 23px 18px}.explorer-toolbar{display:flex;align-items:center;justify-content:space-between;gap:24px;border-bottom:1px solid var(--line);min-height:74px}.tabs{display:flex;gap:23px;align-self:stretch}.tab{background:transparent;border:0;border-bottom:2px solid transparent;color:var(--muted);font-size:12px;font-weight:600;padding:0 0 2px}.tab.active{color:var(--teal);border-bottom-color:var(--teal)}.search{display:flex;align-items:center;border:1px solid var(--line);border-radius:7px;width:340px;padding:8px 10px;gap:8px}.search>span{font-size:24px;line-height:18px;color:var(--muted)}.search input{border:0;outline:none;background:transparent;min-width:0;flex:1;font-size:12px;color:var(--ink)}kbd{border:1px solid var(--line);color:var(--muted);padding:1px 5px;border-radius:3px;font-size:10px}.filters{display:flex;gap:12px;flex-wrap:wrap;padding:19px 0;border-bottom:1px solid var(--line);align-items:flex-end}.filters>label{display:flex;flex-direction:column;gap:7px;color:var(--muted);font-size:10px;flex:1;min-width:95px}.filters select{width:100%;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink);font-size:11px;padding:9px 22px 9px 9px;max-width:210px}.filters>.text-button{margin-left:auto;margin-bottom:1px}.results-heading{display:flex;gap:14px;justify-content:space-between;align-items:center;min-height:65px;font-size:12px}.results-heading strong{font-weight:500}.sort-label{color:var(--muted);display:flex;gap:8px;align-items:center;font-size:11px;white-space:nowrap}.sort-label select{border:0;background:transparent;color:var(--ink);font-size:11px;max-width:155px}.filter-chip{margin-left:10px;border:1px solid #b9d4cc;border-radius:20px;color:var(--teal);background:var(--teal-light);font-size:10px;padding:5px 10px;max-width:260px;overflow:hidden;text-overflow:ellipsis;vertical-align:middle}.gallery{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:19px}.figure-card{border:1px solid var(--line);border-radius:9px;overflow:hidden;background:#fff;transition:border-color .15s,box-shadow .15s}.figure-card:hover{border-color:#b6ccc5;box-shadow:0 5px 18px #102b3509}.figure-card.selected{border-color:var(--teal);box-shadow:0 0 0 1px var(--teal)}.figure-image{position:relative;background:#f8faf9;border-bottom:1px solid #e9eeee;aspect-ratio:1.55}.open-figure{display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:18px;border:0;background:transparent}.open-figure img{max-width:100%;max-height:100%;object-fit:contain;display:block}.image-placeholder{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;color:#7a8d91;font-size:11px}.image-placeholder>span:first-child{font-size:25px;opacity:.5}.select-figure{position:absolute;top:9px;left:9px;width:25px;height:25px;display:grid;place-items:center;background:#ffffffed;border:1px solid var(--line);border-radius:5px;z-index:1}.select-figure input{margin:0;accent-color:var(--teal);cursor:pointer;width:14px;height:14px}.figure-image>.save-figure{position:absolute;right:9px;top:9px;width:26px;height:26px;font-size:15px;background:#ffffffed}.figure-info{padding:14px 14px 13px}.figure-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}.figure-info h3{font-size:12px;line-height:1.5;font-weight:600;margin:7px 0 5px;overflow-wrap:anywhere}.figure-info h3 button{padding:0;background:transparent;border:0;color:inherit;font:inherit;text-align:left}.figure-info h3 button:hover{color:var(--teal)}.figure-path{font-size:10px;color:var(--muted);line-height:1.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:12px}.tags{display:flex;flex-wrap:wrap;gap:5px}.tag{background:#eef3f1;border-radius:4px;font-size:9px;padding:4px 6px;color:#4d6764;line-height:1.3}.tag.dataset{color:var(--teal);background:var(--teal-light);font-weight:600;font-size:9px;letter-spacing:.3px}.figure-date{font-size:9px;color:var(--muted)}.empty{text-align:center;padding:65px 20px 75px;max-width:570px;margin:auto}.empty-symbol{display:inline-grid;place-items:center;width:54px;height:54px;border-radius:12px;background:#eef4f1;color:var(--teal);font-size:27px;margin-bottom:18px}.empty h3{font-size:18px;font-weight:500;margin:0 0 10px}.empty p{font-size:12px;line-height:1.8;color:var(--muted);margin:0 0 18px}.table-wrap{overflow:auto;max-width:100%}table{border-collapse:collapse;width:100%;font-size:11px;text-align:left}th{background:#f6f8f7;color:var(--muted);font-weight:500;padding:12px;white-space:nowrap;border-bottom:1px solid var(--line)}td{padding:15px 12px;border-bottom:1px solid #edf0ef;vertical-align:top;line-height:1.5}td:first-child{min-width:195px}td small{display:block;color:var(--muted);font-size:10px;max-width:390px;overflow-wrap:anywhere;margin-top:4px}td .text-button{padding:0;white-space:normal;text-align:left;font-size:11px}tr:last-child td{border-bottom:0}.load-more{text-align:center;padding-top:23px}.load-more:has([hidden]){padding-top:0}.notice,.error{border-radius:9px;padding:15px 18px;margin-bottom:22px;font-size:12px;line-height:1.7;display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap}.notice{background:#eaf3ee;border:1px solid #cfdfd5;color:#28594a}.error{background:#fff2ed;border:1px solid #eed0c5;color:#8d3923}.notice .button,.error .button{padding:7px 11px}.notice details{width:100%}.notice pre{max-height:200px;overflow:auto;white-space:pre-wrap}.compare-tray{position:fixed;bottom:23px;left:calc(50% + 125px);transform:translateX(-50%);z-index:15;display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #d0ddd7;padding:13px 16px;border-radius:12px;box-shadow:0 10px 45px #0c302f2b;max-width:calc(100vw - 300px)}.compare-tray>div{margin-right:28px;white-space:nowrap}.compare-tray strong{display:block;font-size:12px}.compare-tray span{display:block;font-size:10px;color:var(--muted);margin-top:4px}footer{display:flex;justify-content:space-between;gap:20px;align-items:center;font-size:10px;color:var(--muted);padding:22px 2px 60px;line-height:1.6}dialog{width:min(1260px,94vw);max-height:93vh;overflow:auto;border:1px solid var(--line);border-radius:14px;padding:0;color:var(--ink);box-shadow:0 25px 100px #0b222b33}dialog::backdrop{background:#09202b94;backdrop-filter:blur(3px)}.dialog-header{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--line);padding:22px 26px;display:flex;justify-content:space-between;align-items:flex-start;gap:24px}.dialog-header .eyebrow{margin-bottom:7px}.detail-layout{display:grid;grid-template-columns:minmax(0,1fr) 295px;min-height:450px}.detail-preview{min-width:0;background:#f6f8f7;padding:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}.detail-preview img{display:block;max-width:100%;max-height:65vh;object-fit:contain}.detail-preview pre{white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto;width:100%;max-height:65vh;font:11px/1.7 ui-monospace,SFMono-Regular,monospace;margin:0;background:#fff;padding:18px;border:1px solid var(--line);border-radius:7px}.detail-preview .table-wrap{width:100%;max-height:65vh;background:white}.detail-info{padding:24px;border-left:1px solid var(--line);overflow-wrap:anywhere}.detail-info h3,.run-detail h3{font-size:10px;letter-spacing:1.3px;text-transform:uppercase;margin:24px 0 13px;color:var(--muted)}.detail-info h3:first-child{margin-top:0}.detail-info dl{margin:0;font-size:11px}.detail-info dt{color:var(--muted);margin-top:13px}.detail-info dd{margin:4px 0 0;line-height:1.6}.detail-info .button{margin-top:18px;width:100%}.related-file{display:block;border:0;background:transparent;padding:6px 0;color:var(--teal);font-size:11px;text-align:left;overflow-wrap:anywhere}.detail-nav{display:flex;align-items:center;justify-content:space-between;width:100%;gap:12px}.detail-nav>span{font-size:10px;color:var(--muted)}.preview-note{font-size:11px;color:var(--muted);line-height:1.7;text-align:center;max-width:650px}.compare-grid{display:grid;gap:1px;background:var(--line);grid-template-columns:repeat(2,minmax(0,1fr))}.compare-cell{background:#fff;padding:22px;min-width:0}.compare-cell h3{font-size:12px;margin:0 0 6px;overflow-wrap:anywhere}.compare-cell>p{font-size:11px;color:var(--muted);margin:0 0 16px;line-height:1.6;overflow-wrap:anywhere}.compare-image{height:320px;display:flex;align-items:center;justify-content:center;background:#f8faf9;padding:12px;margin:15px 0}.compare-image img{max-width:100%;max-height:100%;object-fit:contain}.run-detail{padding:25px}.run-detail>p{overflow-wrap:anywhere;color:var(--muted);font-size:12px;line-height:1.7}.run-detail table td:first-child{min-width:130px}.toast{position:fixed;bottom:95px;left:50%;transform:translateX(-50%);background:var(--nav);color:#fff;border-radius:8px;padding:13px 20px;box-shadow:var(--shadow);z-index:100;font-size:12px;max-width:90vw;text-align:center}.mobile-only{display:none}\n@media(min-width:1650px){.gallery{grid-template-columns:repeat(4,minmax(0,1fr))}}\n@media(max-width:1180px){.sidebar{width:220px}.sidebar-bottom{width:220px;padding:18px}.workspace{margin-left:220px}main{padding:28px}.topbar{padding:0 28px}.gallery{grid-template-columns:repeat(2,minmax(0,1fr))}.search{width:285px}.compare-tray{left:calc(50% + 110px);max-width:calc(100vw - 260px)}.filters{gap:9px}.filters>label{min-width:90px}}\n@media(max-width:800px){.sidebar{display:none;top:64px;width:270px;z-index:25;box-shadow:15px 15px 40px #0c252c22}.sidebar-open .sidebar{display:block}.sidebar-bottom{display:none}.workspace{margin-left:0}.mobile-only{display:inline-flex}.topbar{height:64px;padding:0 18px}.breadcrumbs{gap:10px}.breadcrumbs>span{display:none}.breadcrumbs strong{font-size:11px}.top-actions{gap:7px}.top-actions .button{font-size:10px;padding:8px}main{padding:25px 18px}.page-heading{align-items:flex-start}h1{font-size:25px}.subtitle{font-size:12px}.refresh-area .button{font-size:11px;padding:9px}.refresh-area>span{max-width:150px;text-align:right;font-size:10px}.eyebrow{font-size:9px}.statistics>div{padding:0 17px}.statistics strong{font-size:24px}.explorer{padding:0 15px 18px}.explorer-toolbar{gap:15px;flex-wrap:wrap;padding:15px 0}.tabs{height:33px;gap:20px}.search{width:100%}.filters>label{min-width:calc(33% - 12px)}.filters select{max-width:100%}.filters>.text-button{margin-left:0}.compare-tray{left:50%;max-width:calc(100vw - 30px);gap:7px;padding:10px;bottom:15px}.compare-tray>div{margin-right:5px}.compare-tray span{display:none}.compare-tray .button{font-size:11px;padding:9px}.detail-layout{grid-template-columns:minmax(0,1fr)}.detail-info{border-left:0;border-top:1px solid var(--line)}.detail-info dl{display:grid;grid-template-columns:100px minmax(0,1fr);gap:8px}.detail-info dt,.detail-info dd{margin:0}.dialog-header{padding:18px}h2{font-size:18px}.detail-preview{padding:15px}.compare-image{height:260px}.filter-chip{max-width:150px;font-size:9px}footer{align-items:flex-start}.results-heading{font-size:11px}.sort-label{font-size:10px;gap:0}.sort-label select{font-size:10px;max-width:135px}}\n@media(max-width:470px){.gallery{grid-template-columns:minmax(0,1fr)}.page-heading{gap:10px}.page-heading .eyebrow{font-size:8px;letter-spacing:1px}.refresh-area{max-width:130px}h1{font-size:23px}.subtitle{font-size:11px;max-width:230px}.statistics{padding:17px 0}.statistics>div{padding:0 10px}.statistics span{font-size:9px}.statistics strong{font-size:22px}.compare-grid{grid-template-columns:minmax(0,1fr)}.private-label{display:none}.results-heading{align-items:flex-start;padding:18px 0;min-height:60px;gap:6px}.results-heading>div{min-width:0}.filter-chip{margin:8px 0 0;display:block}.compare-tray strong{font-size:10px}.compare-tray .button{font-size:10px;padding:8px}.filters>label{min-width:calc(50% - 8px)}.notice,.error{padding:13px;font-size:11px}footer{flex-direction:column;gap:4px}}\n@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}\n</style>\n\n</head>\n<body>\n  <a class=\"skip\" href=\"#main\">Skip to results</a>\n  <aside class=\"sidebar\" aria-label=\"Result collections\">\n    <div class=\"brand\"><span class=\"brand-mark\" aria-hidden=\"true\">∑</span><div>ENTROPY<span>RESEARCH RESULTS</span></div></div>\n    <p class=\"nav-label\">WORKSPACE</p>\n    <button class=\"nav-item active\" id=\"allResults\"><span>All results</span><span class=\"nav-count\" id=\"allCount\">—</span></button>\n    <button class=\"nav-item\" id=\"savedResults\"><span>Saved figures</span><span class=\"nav-count\" id=\"savedCount\">0</span></button>\n    <div class=\"nav-heading\"><p class=\"nav-label\">COLLECTIONS</p><span id=\"groupCount\"></span></div>\n    <nav id=\"groups\" aria-label=\"Experiment groups\"><p class=\"muted nav-placeholder\">Loading collections…</p></nav>\n    <div class=\"sidebar-bottom\"><span class=\"status-dot\"></span><div>Google Drive<span id=\"scheduleLabel\">Private research workspace</span></div><a href=\"https://drive.google.com/drive/folders/1qXAMcNrZuqk4wlGbqZlmHydQ-cSthbIV\" target=\"_blank\" rel=\"noopener noreferrer\" aria-label=\"Open Figures in Drive\">↗</a></div>\n  </aside>\n  <div class=\"workspace\">\n    <header class=\"topbar\"><div class=\"breadcrumbs\"><button id=\"browseToggle\" class=\"button subtle mobile-only\" aria-expanded=\"false\">Collections</button><span>Research</span><span aria-hidden=\"true\">/</span><strong>Results explorer</strong></div><div class=\"top-actions\"><span class=\"private-label\">PRIVATE</span><a class=\"button subtle\" href=\"https://drive.google.com/drive/folders/1qXAMcNrZuqk4wlGbqZlmHydQ-cSthbIV\" target=\"_blank\" rel=\"noopener noreferrer\">Open Drive ↗</a></div></header>\n    <main id=\"main\" tabindex=\"-1\">\n      <div class=\"page-heading\"><div><p class=\"eyebrow\">THE EXPERIMENT LIBRARY</p><h1 id=\"pageTitle\">All results</h1><p class=\"subtitle\" id=\"pageSubtitle\">Find a figure. Inspect an experiment. Compare what changed.</p></div><div class=\"refresh-area\"><button id=\"refresh\" class=\"button primary\">Refresh index <span aria-hidden=\"true\">↻</span></button><span id=\"indexedAt\" class=\"muted\">Connecting to Drive…</span></div></div>\n      <section id=\"notice\" class=\"notice\" role=\"status\" hidden></section>\n      <section id=\"error\" class=\"error\" role=\"alert\" hidden><span id=\"errorText\"></span><button id=\"retry\" class=\"button\">Try again</button></section>\n      <section class=\"statistics\" aria-label=\"Catalog overview\"><div><span>Figures</span><strong id=\"statFigures\">—</strong></div><div><span>Experiments</span><strong id=\"statRuns\">—</strong></div><div><span>Collections</span><strong id=\"statGroups\">—</strong></div><div><span>Indexed files</span><strong id=\"statFiles\">—</strong></div></section>\n      <section class=\"explorer\" aria-label=\"Search and browse results\">\n        <div class=\"explorer-toolbar\"><div class=\"tabs\" role=\"tablist\" aria-label=\"Result view\"><button role=\"tab\" aria-selected=\"true\" class=\"tab active\" data-view=\"gallery\">Figures</button><button role=\"tab\" aria-selected=\"false\" class=\"tab\" data-view=\"runs\">Experiments</button><button role=\"tab\" aria-selected=\"false\" class=\"tab\" data-view=\"files\">All files</button></div><label class=\"search\"><span aria-hidden=\"true\">⌕</span><input id=\"search\" type=\"search\" placeholder=\"Search figures, experiments, classes…\" aria-label=\"Search results\"><kbd>/</kbd></label></div>\n        <div class=\"filters\"><label>Dataset<select id=\"dataset\"><option value=\"\">All datasets</option></select></label><label>Model<select id=\"model\"><option value=\"\">All models</option></select></label><label>Analysis<select id=\"analysis\"><option value=\"\">All analyses</option></select></label><label>Bitrate<select id=\"bitrate\"><option value=\"\">Any bitrate</option></select></label><label>GOP<select id=\"gop\"><option value=\"\">Any GOP</option></select></label><label>Class<select id=\"className\"><option value=\"\">All classes</option></select></label><button id=\"clearFilters\" class=\"text-button\">Clear filters</button></div>\n        <div class=\"results-heading\"><div><strong id=\"resultCount\" aria-live=\"polite\">Loading results…</strong><button id=\"runFilter\" class=\"filter-chip\" hidden></button></div><label class=\"sort-label\">Sort<select id=\"sort\" aria-label=\"Sort results\"><option value=\"newest\">Recently updated</option><option value=\"name\">Name A–Z</option><option value=\"path\">Experiment path</option></select></label></div>\n        <div id=\"results\" class=\"results\" role=\"tabpanel\" aria-label=\"Results\"></div>\n        <div class=\"load-more\"><button id=\"loadMore\" class=\"button\" hidden>Show more results</button></div>\n      </section>\n      <footer><span id=\"footerStatus\">Original files and experiment data stay in Google Drive.</span><button id=\"enableSchedule\" class=\"text-button\" hidden>Enable automatic refresh</button></footer>\n    </main>\n  </div>\n  <div id=\"compareTray\" class=\"compare-tray\" hidden><div><strong id=\"selectedCount\"></strong><span>Choose up to four figures</span></div><button id=\"clearSelection\" class=\"button subtle\">Clear</button><button id=\"compare\" class=\"button primary\">Compare figures →</button></div>\n  <dialog id=\"viewer\" aria-labelledby=\"viewerTitle\"><div class=\"dialog-header\"><div><p class=\"eyebrow\" id=\"viewerEyebrow\">FIGURE DETAIL</p><h2 id=\"viewerTitle\"></h2></div><button class=\"icon-button\" id=\"closeViewer\" aria-label=\"Close viewer\">×</button></div><div id=\"viewerBody\"></div></dialog>\n  <div id=\"toast\" class=\"toast\" role=\"status\" hidden></div>\n  <script>\n'use strict';\n(function () {\n  const $ = function (id) { return document.getElementById(id); };\n  const filterKeys = ['dataset', 'model', 'analysis', 'bitrate', 'gop', 'className'];\n  const state = { catalog: null, status: null, view: 'gallery', group: '', savedOnly: false,\n    runId: '', query: '', sort: 'newest', filters: {}, limit: 48, selected: new Set(),\n    saved: new Set(), scanning: false, modalToken: 0, matches: [] };\n  const previewCache = new Map();\n  const previewQueue = [];\n  let previewActive = 0;\n  let observer = null;\n  let toastTimer;\n  let currentRecord = null;\n  let loadToken = 0;\n  try { state.saved = new Set(JSON.parse(localStorage.getItem('entropy-saved-figures') || '[]')); } catch (_) {}\n\n  function element(tag, className, text) {\n    const node = document.createElement(tag);\n    if (className) node.className = className;\n    if (text !== undefined && text !== null) node.textContent = String(text);\n    return node;\n  }\n  function button(text, className, fn) {\n    const node = element('button', className, text);\n    node.type = 'button'; node.addEventListener('click', fn); return node;\n  }\n  function link(text, url, className) {\n    const node = element('a', className, text);\n    node.href = url; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node;\n  }\n  function driveUrl(id, folder) {\n    return 'https://drive.google.com/' + (folder ? 'drive/folders/' : 'file/d/') + encodeURIComponent(id) + (folder ? '' : '/view');\n  }\n  function rpc(name) {\n    const args = Array.prototype.slice.call(arguments, 1);\n    return new Promise(function (resolve, reject) {\n      if (!window.google || !google.script || !google.script.run) {\n        reject(new Error('Open the deployed Apps Script URL to connect to your Drive.')); return;\n      }\n      const runner = google.script.run.withSuccessHandler(resolve).withFailureHandler(function (error) {\n        reject(new Error(error && error.message ? error.message : String(error || 'Request failed.')));\n      });\n      runner[name].apply(runner, args);\n    });\n  }\n  function showError(error) {\n    $('errorText').textContent = error && error.message ? error.message : String(error);\n    $('error').hidden = false;\n  }\n  function toast(message) {\n    clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;\n    toastTimer = setTimeout(function () { $('toast').hidden = true; }, 4000);\n  }\n  function dateLabel(value, detailed) {\n    const d = new Date(value || '');\n    if (!Number.isFinite(d.getTime())) return '—';\n    return detailed ? d.toLocaleString() : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });\n  }\n  function bytes(value) {\n    if (!Number.isFinite(Number(value))) return '—';\n    if (value < 1000) return value + ' B';\n    if (value < 1000000) return (value / 1000).toFixed(1) + ' KB';\n    if (value < 1000000000) return (value / 1000000).toFixed(1) + ' MB';\n    return (value / 1000000000).toFixed(2) + ' GB';\n  }\n  function metricValue(metric) {\n    return /accuracy|f1/i.test(metric.label) ? (metric.value * 100).toFixed(2) + '%' : metric.value.toFixed(4);\n  }\n  function prettyName(name) { return String(name || '').replace(/\\.[^.]+$/, '').replace(/_/g, ' '); }\n  function tag(text, special) { return element('span', special ? 'tag dataset' : 'tag', text); }\n  function makeTags(record) {\n    const tags = element('div', 'tags');\n    [record.model, record.bitrate, record.gop ? 'GOP ' + record.gop : '', record.className || record.kind]\n      .filter(Boolean).forEach(function (text) { tags.append(tag(text)); });\n    return tags;\n  }\n  function remember() {\n    const params = { view: state.view };\n    if (state.query) params.q = state.query;\n    if (state.group) params.group = state.group;\n    if (state.runId) params.run = state.runId;\n    if (state.savedOnly) params.saved = '1';\n    filterKeys.forEach(function (key) { if (state.filters[key]) params[key] = state.filters[key]; });\n    try {\n      if (window.google && google.script && google.script.history) google.script.history.replace({}, params, '');\n      else history.replaceState({}, '', '?' + new URLSearchParams(params).toString());\n    } catch (_) {}\n  }\n  function restore(params) {\n    params = params || {};\n    state.view = ['gallery', 'runs', 'files'].includes(params.view) ? params.view : 'gallery';\n    state.query = String(params.q || ''); state.group = String(params.group || '');\n    state.runId = String(params.run || ''); state.savedOnly = params.saved === '1';\n    filterKeys.forEach(function (key) { state.filters[key] = String(params[key] || ''); });\n    $('search').value = state.query;\n  }\n  function saveFavorite(id) {\n    if (state.saved.has(id)) state.saved.delete(id); else state.saved.add(id);\n    try { localStorage.setItem('entropy-saved-figures', JSON.stringify(Array.from(state.saved))); } catch (_) {}\n    render();\n  }\n\n  async function load() {\n    const token = ++loadToken;\n    $('error').hidden = true;\n    try {\n      const response = await rpc('getCatalog');\n      if (token !== loadToken) return;\n      if (!response || !response.catalog || !Array.isArray(response.catalog.records)) throw new Error('The catalog response was incomplete. Please try again.');\n      state.catalog = response.catalog; state.status = response.status;\n      hydrateFilters(); render(); updateStatus();\n    } catch (error) {\n      if (token !== loadToken) return;\n      $('indexedAt').textContent = 'Connection needs attention';\n      $('resultCount').textContent = 'Could not load results';\n      showError(error);\n    }\n  }\n\n  function hydrateFilters() {\n    filterKeys.forEach(function (key) {\n      const values = Array.from(new Set(state.catalog.records.map(function (r) { return r[key]; }).filter(Boolean)))\n        .sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });\n      const select = $(key);\n      const first = select.options[0].textContent;\n      select.replaceChildren(element('option', '', first)); select.options[0].value = '';\n      values.forEach(function (value) { const opt = element('option', '', value); opt.value = value; select.append(opt); });\n      if (state.filters[key] && !values.includes(state.filters[key])) {\n        const opt = element('option', '', state.filters[key]); opt.value = state.filters[key]; select.append(opt);\n      }\n      select.value = state.filters[key] || '';\n    });\n  }\n\n  function updateStatus() {\n    const s = state.status || {};\n    const c = state.catalog;\n    $('refresh').disabled = state.scanning;\n    $('refresh').textContent = state.scanning ? 'Indexing…' : s.active ? 'Resume index ↻' : 'Refresh index ↻';\n    $('indexedAt').textContent = c && c.indexedAt ? 'Indexed ' + dateLabel(c.indexedAt, true) : 'First index pending';\n    $('scheduleLabel').textContent = s.scheduled ? 'Automatic refresh every 6 hours' : 'Private research workspace';\n    $('enableSchedule').hidden = !!s.scheduled || state.scanning;\n    const notice = $('notice'); notice.replaceChildren(); notice.hidden = true;\n    if (s.active || state.scanning) {\n      notice.hidden = false;\n      notice.append(element('span', '', 'Indexing Figures · ' + (s.scannedFolders || 0) + ' folders scanned · ' + (s.files || 0) + ' files found · ' + (s.pendingFolders || 0) + ' folders queued. ' +\n        (c && c.complete ? 'Showing the last completed catalog.' : 'Results appear as the scan progresses.')));\n      if (!state.scanning) notice.append(button('Resume index', 'button', function () { scan(false); }));\n    }\n    const warnings = c && c.warnings || [];\n    if (warnings.length) {\n      notice.hidden = false;\n      const details = element('details');\n      details.append(element('summary', '', warnings.length + ' metadata files need attention. Original files remain available.'));\n      details.append(element('pre', '', warnings.map(function (w) { return w.path + ': ' + w.message; }).join('\\n')));\n      notice.append(details);\n    }\n  }\n\n  async function scan(schedule) {\n    if (state.scanning) return;\n    state.scanning = true; $('error').hidden = true; updateStatus();\n    try {\n      state.status = await rpc(schedule ? 'setup' : 'startIndex');\n      updateStatus();\n      let batches = 0;\n      while (state.status.active) {\n        state.status = await rpc('continueIndex');\n        updateStatus(); batches++;\n        if (batches % 2 === 0 || !state.status.active) await load();\n      }\n      await load(); toast('Results catalog is up to date.');\n    } catch (error) { showError(error); }\n    finally { state.scanning = false; updateStatus(); }\n  }\n\n  function matches(record) {\n    if (state.group && record.groupId !== state.group) return false;\n    if (state.runId && (record.runId || record.id) !== state.runId) return false;\n    if (filterKeys.some(function (key) { return state.filters[key] && record[key] !== state.filters[key]; })) return false;\n    const text = [record.name, record.path, record.groupName, record.runName, record.dataset, record.model,\n      record.analysis, record.bitrate, record.gop, record.className, record.modality, record.kind].join(' ').toLowerCase();\n    return state.query.toLowerCase().trim().split(/\\s+/).filter(Boolean).every(function (word) { return text.includes(word); });\n  }\n  function sorted(records) {\n    return records.sort(function (a, b) {\n      if (state.sort === 'name') return a.name.localeCompare(b.name, undefined, { numeric: true });\n      if (state.sort === 'path') return (a.path || '').localeCompare(b.path || '', undefined, { numeric: true });\n      return (b.modifiedTime || '').localeCompare(a.modifiedTime || '') || a.name.localeCompare(b.name);\n    });\n  }\n  function selectCollection(id, saved) {\n    state.group = id; state.savedOnly = !!saved; state.runId = ''; state.limit = 48;\n    if (saved) state.view = 'gallery';\n    document.body.classList.remove('sidebar-open'); $('browseToggle').setAttribute('aria-expanded', 'false');\n    render(); remember();\n  }\n\n  function render() {\n    if (!state.catalog) return;\n    if (observer) observer.disconnect();\n    const c = state.catalog;\n    const group = c.groups.find(function (g) { return g.id === state.group; });\n    $('pageTitle').textContent = state.savedOnly ? 'Saved figures' : group ? group.name : 'All results';\n    $('pageSubtitle').textContent = state.savedOnly ? 'Your saved figures, ready to revisit and compare.' :\n      group ? 'Explore figures, metrics, and source files in this collection.' : 'Find a figure. Inspect an experiment. Compare what changed.';\n    const inGroup = c.records.filter(function (r) { return !state.group || r.groupId === state.group; });\n    $('statFigures').textContent = inGroup.filter(function (r) { return /^(image|pdf)$/.test(r.fileKind); }).length.toLocaleString();\n    $('statRuns').textContent = c.runs.filter(function (r) { return !state.group || r.groupId === state.group; }).length.toLocaleString();\n    $('statGroups').textContent = (state.group ? group ? 1 : 0 : c.groups.length).toLocaleString();\n    $('statFiles').textContent = inGroup.length.toLocaleString();\n    $('allCount').textContent = c.records.filter(function (r) { return /^(image|pdf)$/.test(r.fileKind); }).length;\n    $('savedCount').textContent = c.records.filter(function (r) { return state.saved.has(r.id); }).length;\n    $('groupCount').textContent = c.groups.length;\n    $('allResults').classList.toggle('active', !state.group && !state.savedOnly);\n    $('savedResults').classList.toggle('active', state.savedOnly);\n    $('groups').replaceChildren();\n    c.groups.forEach(function (g) {\n      const b = button('', 'nav-item group-item' + (state.group === g.id ? ' active' : ''), function () { selectCollection(g.id, false); });\n      b.append(element('span', '', g.name), element('span', 'nav-count', g.figures || 0)); $('groups').append(b);\n    });\n    if (!c.groups.length) $('groups').append(element('p', 'muted nav-placeholder', 'Collections appear after indexing.'));\n    document.querySelectorAll('[data-view]').forEach(function (b) {\n      const active = b.dataset.view === state.view;\n      b.classList.toggle('active', active); b.setAttribute('aria-selected', String(active)); b.tabIndex = active ? 0 : -1;\n    });\n    const run = c.runs.find(function (r) { return r.id === state.runId; });\n    $('runFilter').hidden = !state.runId;\n    $('runFilter').textContent = (run ? run.name : 'Selected experiment') + ' ×';\n    $('runFilter').title = 'Clear the experiment filter';\n    let records = state.view === 'runs' ? c.runs.filter(matches) : c.records.filter(matches);\n    if (state.view === 'gallery') records = records.filter(function (r) { return /^(image|pdf)$/.test(r.fileKind); });\n    if (state.savedOnly) records = records.filter(function (r) { return state.saved.has(r.id); });\n    state.matches = sorted(records);\n    const noun = state.view === 'runs' ? 'experiments' : state.view === 'files' ? 'files' : 'figures';\n    $('resultCount').textContent = records.length.toLocaleString() + ' ' + noun + (!c.complete ? ' · index incomplete' : '');\n    $('results').replaceChildren(); $('results').className = 'results';\n    const shown = state.matches.slice(0, state.limit);\n    if (!shown.length) renderEmpty();\n    else if (state.view === 'gallery') renderGallery(shown);\n    else renderTable(shown, state.view);\n    $('loadMore').hidden = records.length <= state.limit;\n    $('loadMore').textContent = 'Show more (' + Math.max(0, records.length - state.limit).toLocaleString() + ' remaining)';\n    updateTray();\n  }\n\n  function renderEmpty() {\n    const box = element('div', 'empty'); box.append(element('span', 'empty-symbol', '▧'));\n    const first = !state.catalog.complete && !state.catalog.records.length;\n    box.append(element('h3', '', first ? 'Your results, one view away' : 'No matching results'));\n    box.append(element('p', '', first ? 'Build a catalog of the Figures folder to browse plots, inspect experiment metadata, and compare results.' :\n      state.savedOnly ? 'Save a figure using its star, or adjust your filters to find saved results.' : 'Try fewer filters or a different search. You can also refresh the index to pick up new results.'));\n    box.append(button(first ? 'Start indexing Figures' : 'Clear filters', 'button primary', first ? function () { scan(false); } : clearFilters));\n    $('results').append(box);\n  }\n\n  function renderGallery(records) {\n    const grid = element('div', 'gallery');\n    observer = new IntersectionObserver(function (entries) {\n      entries.forEach(function (entry) {\n        if (!entry.isIntersecting) return;\n        observer.unobserve(entry.target);\n        loadImage(entry.target, entry.target.dataset.fileId, false);\n      });\n    }, { rootMargin: '200px' });\n    records.forEach(function (r) {\n      const card = element('article', 'figure-card' + (state.selected.has(r.id) ? ' selected' : ''));\n      const image = element('div', 'figure-image');\n      const select = element('label', 'select-figure');\n      const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = state.selected.has(r.id);\n      checkbox.setAttribute('aria-label', 'Select ' + r.name + ' from ' + r.runName + ' for comparison');\n      checkbox.addEventListener('change', function () {\n        if (checkbox.checked && state.selected.size >= 4) { checkbox.checked = false; toast('Select up to four figures at a time.'); return; }\n        if (checkbox.checked) state.selected.add(r.id); else state.selected.delete(r.id);\n        card.classList.toggle('selected', checkbox.checked); updateTray();\n      });\n      select.append(checkbox); image.append(select);\n      const favorite = button(state.saved.has(r.id) ? '★' : '☆', 'icon-button save-figure' + (state.saved.has(r.id) ? ' saved' : ''), function () { saveFavorite(r.id); });\n      favorite.setAttribute('aria-label', (state.saved.has(r.id) ? 'Unsave ' : 'Save ') + r.name);\n      favorite.setAttribute('aria-pressed', String(state.saved.has(r.id))); image.append(favorite);\n      const open = button('', 'open-figure', function () { openFile(r); });\n      open.setAttribute('aria-label', 'View ' + r.name + ' from ' + r.runName);\n      const holder = element('div', 'image-placeholder'); holder.dataset.fileId = r.id;\n      holder.append(element('span', '', '▧'), element('span', '', 'Loading preview')); open.append(holder); image.append(open);\n      const info = element('div', 'figure-info');\n      const heading = element('div', 'figure-heading'); heading.append(tag(r.dataset, true), element('span', 'figure-date', dateLabel(r.modifiedTime)));\n      const title = element('h3'); title.append(button(prettyName(r.name), '', function () { openFile(r); }));\n      const path = element('div', 'figure-path', r.runName + (r.className ? ' / ' + r.className : '') + ' · ' + r.analysis); path.title = r.path;\n      info.append(heading, title, path, makeTags(r)); card.append(image, info); grid.append(card); observer.observe(holder);\n    });\n    $('results').append(grid);\n  }\n\n  function renderTable(records, view) {\n    const wrap = element('div', 'table-wrap'); const table = element('table');\n    const head = element('thead'); const row = element('tr');\n    (view === 'runs' ? ['Experiment', 'Dataset / Model', 'Settings', 'Figures', 'Metrics', 'Updated'] : ['File', 'Collection', 'Type', 'Size', 'Updated'])\n      .forEach(function (name) { const th = element('th', '', name); th.scope = 'col'; row.append(th); });\n    head.append(row); table.append(head); const body = element('tbody');\n    records.forEach(function (r) {\n      const tr = element('tr'); const first = element('td');\n      first.append(button(r.name, 'text-button', function () { view === 'runs' ? openRun(r) : openFile(r); }), element('small', '', r.path)); tr.append(first);\n      if (view === 'runs') {\n        const context = element('td'); context.append(tag(r.dataset, true), element('small', '', r.model)); tr.append(context);\n        const settings = element('td', '', [r.bitrate, r.gop ? 'GOP ' + r.gop : ''].filter(Boolean).join(' · ') || '—');\n        if (r.state) settings.append(element('small', '', r.state.replace(/_/g, ' '))); tr.append(settings);\n        const figures = element('td'); figures.append(button(String(r.figures), 'text-button', function () { showRunFigures(r); })); tr.append(figures);\n        const metrics = element('td');\n        metrics.append(r.metrics.length ? button('Inspect ' + r.metrics.length + ' metrics', 'text-button', function () { openRun(r); }) : element('span', 'muted', 'Not reported'));\n        tr.append(metrics);\n      } else {\n        tr.append(element('td', '', r.groupName), element('td', '', r.fileKind.toUpperCase()), element('td', '', bytes(r.size)));\n      }\n      tr.append(element('td', '', dateLabel(r.modifiedTime))); body.append(tr);\n    });\n    table.append(body); wrap.append(table); $('results').append(wrap);\n  }\n\n  function preview(id, original) {\n    const key = id + ':' + !!original;\n    if (!previewCache.has(key)) {\n      const promise = new Promise(function (resolve, reject) { previewQueue.push({ id: id, original: original, resolve: resolve, reject: reject }); pumpPreviews(); });\n      previewCache.set(key, promise);\n      if (previewCache.size > 80) previewCache.delete(previewCache.keys().next().value);\n      promise.catch(function () { previewCache.delete(key); });\n    }\n    return previewCache.get(key);\n  }\n  function pumpPreviews() {\n    while (previewActive < 3 && previewQueue.length) {\n      const item = previewQueue.shift(); previewActive++;\n      rpc('getPreview', item.id, item.original).then(item.resolve, item.reject).finally(function () { previewActive--; pumpPreviews(); });\n    }\n  }\n  async function loadImage(holder, id, original, token) {\n    try {\n      const response = await preview(id, original);\n      if (!holder.isConnected || (token !== undefined && token !== state.modalToken)) return;\n      holder.replaceChildren();\n      if (response.dataUrl && /^data:image\\/(png|jpeg|gif|webp|bmp);base64,/i.test(response.dataUrl)) {\n        const image = element('img'); image.alt = state.catalog.records.find(function (r) { return r.id === id; })?.name || 'Result figure';\n        image.addEventListener('error', function () { holder.replaceChildren(element('span', 'preview-note', 'Preview could not be displayed. Open the original in Drive.')); });\n        image.src = response.dataUrl; holder.append(image);\n      } else holder.append(element('span', 'preview-note', response.note || 'Preview unavailable. Open the original in Drive.'));\n      if (response.note && response.dataUrl && original) holder.append(element('p', 'preview-note', response.note));\n    } catch (_) {\n      if (!holder.isConnected || (token !== undefined && token !== state.modalToken)) return;\n      holder.replaceChildren(element('span', 'preview-note', 'Preview unavailable. Open the original in Drive.'));\n    }\n  }\n  function updateTray() {\n    $('compareTray').hidden = state.selected.size === 0;\n    $('selectedCount').textContent = state.selected.size + ' figure' + (state.selected.size === 1 ? '' : 's') + ' selected';\n    $('compare').disabled = state.selected.size < 2;\n  }\n\n  function openDialog(title, eyebrow) {\n    state.modalToken++; $('viewerTitle').textContent = title; $('viewerEyebrow').textContent = eyebrow;\n    $('viewerBody').replaceChildren(); if (!$('viewer').open) $('viewer').showModal(); return state.modalToken;\n  }\n  function closeDialog() { state.modalToken++; currentRecord = null; $('viewer').close(); }\n  function addDescription(list, label, value) {\n    if (value === undefined || value === null || value === '') return;\n    list.append(element('dt', '', label), element('dd', '', value));\n  }\n  async function openFile(record) {\n    currentRecord = record;\n    const token = openDialog(prettyName(record.name), record.fileKind === 'image' ? 'FIGURE DETAIL' : 'FILE DETAIL');\n    const layout = element('div', 'detail-layout'); const content = element('div', 'detail-preview');\n    const info = element('aside', 'detail-info'); info.append(element('h3', '', 'Experiment context'));\n    const dl = element('dl');\n    [['Dataset', record.dataset], ['Model', record.model], ['Analysis', record.analysis], ['Experiment', record.runName],\n      ['Class', record.className], ['Bitrate', record.bitrate], ['GOP', record.gop], ['State', record.state],\n      ['Updated', dateLabel(record.modifiedTime, true)], ['File size', bytes(record.size)], ['Path', record.path]]\n      .forEach(function (pair) { addDescription(dl, pair[0], pair[1]); });\n    info.append(dl, link('Open original in Drive ↗', driveUrl(record.id), 'button primary'), link('Open experiment folder ↗', driveUrl(record.parentId, true), 'button'));\n    const related = (record.relatedIds || []).map(function (id) { return state.catalog.records.find(function (r) { return r.id === id; }); }).filter(Boolean);\n    if (related.length) {\n      info.append(element('h3', '', 'Metadata & source files'));\n      related.forEach(function (r) { if (r.id !== record.id) info.append(button(r.name, 'related-file', function () { openFile(r); })); });\n    }\n    const facts = (record.summaries || []).find(function (s) { return s.summary.facts.length; });\n    if (facts) {\n      info.append(element('h3', '', facts.name)); const factList = element('dl');\n      facts.summary.facts.slice(0, 12).forEach(function (f) { addDescription(factList, f.label, f.value); }); info.append(factList);\n    }\n    layout.append(content, info); $('viewerBody').append(layout);\n    if (/^(image|pdf)$/.test(record.fileKind)) {\n      const navigation = element('div', 'detail-nav');\n      navigation.append(button('← Previous', 'button', function () { navigateFigure(-1); }), element('span', '', 'Use ← → to browse'), button('Next →', 'button', function () { navigateFigure(1); }));\n      content.append(navigation);\n      const holder = element('div', 'detail-preview'); holder.style.padding = '0'; holder.append(element('p', 'preview-note', 'Loading figure…')); content.append(holder);\n      loadImage(holder, record.id, true, token);\n      return;\n    }\n    content.append(element('p', 'preview-note', 'Loading file…'));\n    try {\n      const detail = await rpc('getFileDetail', record.id);\n      if (token !== state.modalToken || !content.isConnected) return;\n      content.replaceChildren();\n      if (detail.note) content.append(element('p', 'preview-note', detail.note));\n      if (detail.table) {\n        const wrap = element('div', 'table-wrap'); const table = element('table');\n        detail.table.rows.forEach(function (row, i) {\n          const tr = element('tr'); row.forEach(function (value) { tr.append(element(i ? 'td' : 'th', '', value)); }); table.append(tr);\n        }); wrap.append(table); content.append(wrap);\n        content.append(element('p', 'preview-note', detail.table.totalRows + ' data rows' + (detail.table.truncated ? ' · showing the first 100 rows and up to 30 columns' : '')));\n      } else if (detail.text) content.append(element('pre', '', detail.text));\n      else if (!detail.note) content.append(element('p', 'preview-note', 'Open this file in Drive to view or download it.'));\n    } catch (error) {\n      if (token === state.modalToken) content.replaceChildren(element('p', 'preview-note', error.message));\n    }\n  }\n\n  function navigateFigure(delta) {\n    if (!currentRecord) return;\n    const figures = state.matches.filter(function (r) { return /^(image|pdf)$/.test(r.fileKind); });\n    const i = figures.findIndex(function (r) { return r.id === currentRecord.id; });\n    if (i < 0 || !figures.length) return;\n    openFile(figures[(i + delta + figures.length) % figures.length]);\n  }\n\n  function showRunFigures(run) {\n    state.runId = run.id; state.view = 'gallery'; state.limit = 48; state.savedOnly = false;\n    if ($('viewer').open) closeDialog(); render(); remember();\n  }\n  function openRun(run) {\n    currentRecord = null; openDialog(run.name, 'EXPERIMENT DETAIL');\n    const content = element('div', 'run-detail'); content.append(element('p', '', run.path), makeTags(run));\n    const actions = element('p'); actions.append(button('Browse ' + run.figures + ' figures', 'button primary', function () { showRunFigures(run); }), document.createTextNode(' '), link('Open experiment folder ↗', driveUrl(run.id, true), 'button')); content.append(actions);\n    content.append(element('h3', '', 'Reported metrics'));\n    if (!run.metrics.length) content.append(element('p', '', 'No recognized summary metrics were found. Inspect the experiment’s source files for further details.'));\n    else {\n      const wrap = element('div', 'table-wrap'); const table = element('table'); const head = element('tr');\n      ['Metric', 'Value', 'Split / evaluation', 'Block', 'Source'].forEach(function (x) { const th = element('th', '', x); th.scope = 'col'; head.append(th); });\n      const thead = element('thead'); thead.append(head); table.append(thead); const body = element('tbody');\n      run.metrics.forEach(function (metric) {\n        const tr = element('tr'); tr.append(element('td', '', metric.label), element('td', '', metricValue(metric)), element('td', '', metric.split), element('td', '', metric.block || '—'));\n        const source = element('td'); source.append(link(metric.sourcePath, driveUrl(metric.sourceId))); tr.append(source); body.append(tr);\n      }); table.append(body); wrap.append(table); content.append(wrap);\n    }\n    $('viewerBody').append(content);\n  }\n\n  function compare() {\n    const records = Array.from(state.selected).map(function (id) { return state.catalog.records.find(function (r) { return r.id === id; }); }).filter(Boolean);\n    if (records.length < 2) { toast('Select at least two figures to compare.'); return; }\n    currentRecord = null; const token = openDialog('Compare figures', 'SIDE BY SIDE');\n    const note = element('p', 'preview-note', 'Original figures retain their own axes and color scales. Experiment settings are shown with each result.'); note.style.margin = '18px auto'; $('viewerBody').append(note);\n    const grid = element('div', 'compare-grid'); $('viewerBody').append(grid);\n    records.forEach(function (r) {\n      const cell = element('section', 'compare-cell'); cell.append(element('h3', '', prettyName(r.name)), element('p', '', r.path), makeTags(r));\n      const holder = element('div', 'compare-image'); holder.append(element('p', 'preview-note', 'Loading figure…')); cell.append(holder, link('Open original ↗', driveUrl(r.id), 'text-button')); grid.append(cell);\n      loadImage(holder, r.id, true, token);\n    });\n  }\n\n  function clearFilters() {\n    state.query = ''; state.filters = {}; state.runId = ''; state.limit = 48; $('search').value = '';\n    filterKeys.forEach(function (key) { $(key).value = ''; }); render(); remember();\n  }\n  $('allResults').addEventListener('click', function () { selectCollection('', false); });\n  $('savedResults').addEventListener('click', function () { selectCollection('', true); });\n  $('refresh').addEventListener('click', function () { scan(false); });\n  $('enableSchedule').addEventListener('click', function () { scan(true); });\n  $('retry').addEventListener('click', function () { state.status && state.status.active ? scan(false) : load(); });\n  $('clearFilters').addEventListener('click', clearFilters);\n  $('search').addEventListener('input', function () { state.query = $('search').value; state.limit = 48; render(); remember(); });\n  filterKeys.forEach(function (key) { $(key).addEventListener('change', function () { state.filters[key] = $(key).value; state.limit = 48; render(); remember(); }); });\n  $('sort').addEventListener('change', function () { state.sort = $('sort').value; render(); });\n  $('runFilter').addEventListener('click', function () { state.runId = ''; render(); remember(); });\n  $('loadMore').addEventListener('click', function () { state.limit += 48; render(); });\n  $('compare').addEventListener('click', compare);\n  $('clearSelection').addEventListener('click', function () { state.selected.clear(); render(); });\n  $('closeViewer').addEventListener('click', closeDialog);\n  $('viewer').addEventListener('cancel', function () { state.modalToken++; currentRecord = null; });\n  $('viewer').addEventListener('click', function (event) { if (event.target === $('viewer')) { const r = $('viewer').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeDialog(); } });\n  $('browseToggle').addEventListener('click', function () { const open = document.body.classList.toggle('sidebar-open'); $('browseToggle').setAttribute('aria-expanded', String(open)); });\n  document.querySelectorAll('[data-view]').forEach(function (b) {\n    b.addEventListener('click', function () { state.view = b.dataset.view; state.savedOnly = false; state.limit = 48; render(); remember(); });\n    b.addEventListener('keydown', function (event) {\n      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;\n      event.preventDefault(); const tabs = Array.from(document.querySelectorAll('[data-view]')); const i = tabs.indexOf(b);\n      const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]; next.click(); next.focus();\n    });\n  });\n  document.addEventListener('keydown', function (event) {\n    const editing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);\n    if (event.key === '/' && !editing && !$('viewer').open) { event.preventDefault(); $('search').focus(); }\n    if (!editing && $('viewer').open && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); navigateFigure(event.key === 'ArrowRight' ? 1 : -1); }\n    if (event.key === 'Escape') { document.body.classList.remove('sidebar-open'); $('browseToggle').setAttribute('aria-expanded', 'false'); }\n  });\n  if (window.google && google.script && google.script.url) google.script.url.getLocation(function (location) { restore(location.parameter); load(); });\n  else { restore(Object.fromEntries(new URLSearchParams(location.search))); load(); }\n}());\n</script>\n\n</body>\n</html>\n";
}
