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

// Shared by Apps Script, the Vercel function, and the browser indexer.
if (typeof module !== 'undefined' && module.exports)
  module.exports = { buildCatalog_, summarizeJson_, fileKind_, describePath_ };
if (typeof window !== 'undefined')
  window.EntropyCore = { buildCatalog_, summarizeJson_, fileKind_, describePath_ };
