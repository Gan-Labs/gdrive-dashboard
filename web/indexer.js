/* Browser-owned checkpoints survive Vercel cold starts and page reloads. */
(function (scope) {
  'use strict';
  function createIndexer({ rootId, api, store, core, now = () => new Date().toISOString() }) {
    const empty = () => ({ schema: 1, rootId, indexedAt: null, complete: false, records: [], groups: [], runs: [], warnings: [] });
    const status = work => ({ active: !!(work && !work.completedAt), scannedFolders: work?.scannedFolders || 0,
      pendingFolders: work?.queue.length || 0, files: work?.files.length || 0, startedAt: work?.startedAt || null,
      completedAt: work?.completedAt || null, lastError: work?.lastError || '', warnings: work?.warnings || [], scheduled: false });
    return {
      async getCatalog() {
        const saved = await store.get() || {};
        return { catalog: saved.catalog || (saved.work ? core.buildCatalog_(saved.work) : empty()), status: status(saved.work) };
      },
      async startIndex() {
        const saved = await store.get() || {};
        if (!saved.work || saved.work.completedAt) saved.work = {
          schema: 1, rootId, startedAt: now(), queue: [{ id: rootId, path: '', attempts: 0 }],
          seen: {}, files: [], folders: [], summaries: {}, warnings: [], pages: 0, scannedFolders: 0, lastError: ''
        };
        await store.set(saved);
        return status(saved.work);
      },
      async continueIndex() {
        const saved = await store.get() || {}, work = saved.work;
        if (!work || work.completedAt) return status(work);
        const job = work.queue[0];
        let page;
        try { page = await api('listFolder', { id: job.id, pageToken: job.pageToken || '' }); }
        catch (error) {
          if (error.code === 'PAGE_EXPIRED') delete job.pageToken;
          job.attempts++; work.lastError = error.message; await store.set(saved);
          throw new Error('Index paused at ' + (job.path || 'Figures') + ': ' + error.message + ' Use Resume index to retry.');
        }
        for (const item of page.files) {
          if (Object.hasOwn(work.seen, item.id)) continue;
          const entry = { id: item.id, name: item.name, mimeType: item.mimeType, size: Number(item.size || 0),
            modifiedTime: item.modifiedTime || '', parentId: job.id, path: job.path ? job.path + '/' + item.name : item.name };
          if (item.mimeType === 'application/vnd.google-apps.folder') {
            work.folders.push(entry); work.queue.push({ id: item.id, path: entry.path, attempts: 0 });
          } else work.files.push(entry);
          work.seen[item.id] = true;
        }
        Object.assign(work.summaries, page.summaries);
        for (const warning of page.warnings || []) {
          const entry = work.files.find(f => f.id === warning.id);
          work.warnings.push({ path: entry?.path || job.path, message: warning.message });
        }
        work.pages++; work.lastError = ''; job.attempts = 0;
        if (page.nextPageToken) job.pageToken = page.nextPageToken;
        else { work.queue.shift(); work.scannedFolders++; }
        if (!work.queue.length) {
          work.completedAt = now(); saved.catalog = core.buildCatalog_(work);
        }
        // A single IndexedDB transaction atomically publishes completed work.
        await store.set(saved);
        return status(work);
      }
    };
  }
  if (typeof module !== 'undefined') module.exports = { createIndexer };
  else scope.EntropyIndexer = { createIndexer };
}(typeof window === 'undefined' ? globalThis : window));
