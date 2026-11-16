'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = '1qXAMcNrZuqk4wlGbqZlmHydQ-cSthbIV';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPioAAAAASUVORK5CYII=';

function harness() {
  const props = new Map(), disk = new Map(), metadata = new Map(), triggers = [];
  let seq = 0, failList = false, allowLock = true, blobReads = 0;
  const pages = new Map();
  const context = vm.createContext({ console, Date, Map, Set, Object, Array, String, Number, JSON, Error, RegExp,
    MimeType: { PLAIN_TEXT: 'text/plain' },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k) || null, setProperty: (k, v) => props.set(k, v) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => allowLock, releaseLock() {} }) },
    CacheService: { getUserCache: () => ({ get: () => null, put() {} }) },
    ScriptApp: { getProjectTriggers: () => triggers, newTrigger: name => ({ timeBased() { return this; }, everyMinutes(n) { if (n !== 5) throw Error('Unexpected interval'); return this; }, create() { const t = { getHandlerFunction: () => name }; triggers.push(t); return t; } }) },
    Utilities: { base64Encode: bytes => Buffer.from(bytes).toString('base64'), parseCsv: text => text.trim().split('\n').map(row => row.split(',')) },
    DriveApp: {
      getFolderById: id => ({ getName: () => 'Figures' }),
      createFolder: name => ({ getId: () => 'storage-folder', createFile: (name, text) => { const id = 'storage-' + (++seq); disk.set(id, text); return { getId: () => id }; } }),
      getFileById: id => ({ getId: () => id,
        getBlob: () => { blobReads++; return { getDataAsString: () => disk.get(id) || '{}', getContentType: () => 'image/png', getBytes: () => [...Buffer.from(PNG, 'base64')] }; },
        setContent: text => disk.set(id, text), getMimeType: () => metadata.get(id)?.mimeType || 'image/png',
        getSize: () => metadata.get(id)?.size ?? 100, getThumbnail: () => ({ getContentType: () => 'image/png', getBytes: () => [...Buffer.from(PNG, 'base64')] }) })
    },
    Drive: { Files: {
      list: options => {
        if (failList) { failList = false; throw Error('Temporary Drive failure'); }
        const parent = options.q.match(/^'([^']+)'/)[1];
        const key = parent + ':' + (options.pageToken || '');
        if (!pages.has(key)) throw Error('Unexpected listing ' + key);
        return structuredClone(pages.get(key));
      },
      get: id => { if (!metadata.has(id)) throw Error('Unknown file ' + id); return structuredClone(metadata.get(id)); }
    } }
  });
  for (const file of ['Core.gs', 'Server.gs']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8'), context, { filename: file });
  return { context, props, disk, metadata, triggers, pages,
    failNextList: () => { failList = true; }, denyLock: () => { allowLock = false; }, getBlobReads: () => blobReads,
    readWork: () => { const db = JSON.parse(props.get('RESULTS_STORAGE')); return JSON.parse(disk.get(db.workId)); },
    readCatalog: () => { const db = JSON.parse(props.get('RESULTS_STORAGE')); return JSON.parse(disk.get(db.catalogId)); }
  };
}
function file(id, name, mimeType = 'image/png') { return { id, name, mimeType, modifiedTime: '2026-11-14T00:00:00Z', size: '1200' }; }
function folder(id, name) { return file(id, name, 'application/vnd.google-apps.folder'); }
function sampleWork() {
  return { rootId: ROOT, startedAt: '2026-11-14T00:00:00Z', completedAt: '2026-11-14T00:01:00Z', warnings: [],
    folders: [
      { id: 'group-hmdb', parentId: ROOT, name: 'ResNet HMDB51 Dataset Linear Probes', path: 'ResNet HMDB51 Dataset Linear Probes' },
      { id: 'run-hmdb', parentId: 'group-hmdb', name: 'HMDB51_video_800k_gop8-8', path: 'ResNet HMDB51 Dataset Linear Probes/HMDB51_video_800k_gop8-8' },
      { id: 'eval-hmdb', parentId: 'run-hmdb', name: 'evaluations', path: 'ResNet HMDB51 Dataset Linear Probes/HMDB51_video_800k_gop8-8/evaluations' },
      { id: 'group-wpp', parentId: ROOT, name: 'WPP UCF11 class attribution figures', path: 'WPP UCF11 class attribution figures' },
      { id: 'run-wpp', parentId: 'group-wpp', name: 'trampoline_jumping_class_attribution_export', path: 'WPP UCF11 class attribution figures/trampoline_jumping_class_attribution_export' }
    ],
    files: [], summaries: {}
  };
}
module.exports = { ROOT, PNG, harness, file, folder, sampleWork };
