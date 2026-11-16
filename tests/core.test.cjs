'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, sampleWork } = require('./harness.cjs');

test('infer dataset, model, bitrate, GOP and class from the observed folder conventions', () => {
  const { context: c } = harness();
  const r = c.describePath_('ResNet HMDB51 Dataset Linear Probes/HMDB51_video_800k_gop8-8/evaluations', 'accuracy_curves.png');
  assert.equal(r.dataset, 'HMDB51'); assert.equal(r.model, 'ResNet');
  assert.equal(r.bitrate, '800k'); assert.equal(r.gop, '8-8'); assert.equal(r.analysis, 'Linear probes');
  const a = c.describePath_('WPP UCF11 class attribution figures/trampoline_jumping_class_attribution_export', 'class_attribution_maps.png');
  assert.equal(a.className, 'trampoline jumping'); assert.equal(a.model, 'WPP Transformer');
  assert.equal(c.describePath_('WPP DeepAction class attribution figures/CogVideoX5Bclass_attribution_export', '').className, 'CogVideoX5B');
  assert.equal(c.describePath_('Transformer CASIA-B Silhouette Dataset Train and Evaluate/2026-09-16-001', '').modality, 'Silhouette');
});

test('validation, final test, and block metrics retain their evaluation context, including zero', () => {
  const { context: c } = harness();
  const status = c.summarizeJson_('status.json', { state: 'early_stopped', latest_validation_metrics: { accuracy: 0, macro_f1: 0.13 }, best_epoch: 0 });
  assert.equal(status.metrics[0].value, 0); assert.equal(status.metrics[0].split, 'Latest validation');
  assert.equal(status.facts.find(f => f.label === 'Best epoch').value, '0');
  const summary = c.summarizeJson_('summarized_metrics.json', { accuracy: .16, evaluation_kind: 'original_test', blocks: { block1: { final_train_validation_refit_test_metrics: { accuracy: .17 } } } });
  assert.equal(summary.metrics[0].split, 'Test'); assert.equal(summary.metrics[1].split, 'Test after refit'); assert.equal(summary.metrics[1].block, 'block1');
  assert.equal(c.summarizeJson_('metrics.json', { accuracy: .8 }).metrics[0].split, 'Reported (split unspecified)');
});

test('attribution summaries preserve empty splits and numerical class IDs are not presented as class names', () => {
  const { context: c } = harness();
  const r = c.summarizeJson_('metadata.json', { groups: [{ split: 'test', count: 0 }], metadata: { settings: { classes: [8] }, missing_videos: 0 } });
  assert.equal(r.classes.length, 0);
  assert.equal(r.facts.find(f => f.label === 'test videos').value, '0');
  assert.equal(r.facts.find(f => f.label === 'Missing videos').value, '0');
});

test('catalog associates nested figures with the correct run and does not mix another run’s metrics', () => {
  const { context: c } = harness(); const work = sampleWork();
  work.files.push({ id: 'plot', parentId: 'eval-hmdb', name: 'accuracy_curves.png', path: work.folders[2].path + '/accuracy_curves.png', mimeType: 'image/png' },
    { id: 'status', parentId: 'run-hmdb', name: 'status.json', path: work.folders[1].path + '/status.json', mimeType: 'application/json' },
    { id: 'attr', parentId: 'run-wpp', name: 'class_attribution_maps.png', path: work.folders[4].path + '/class_attribution_maps.png', mimeType: 'image/png' });
  work.summaries.status = c.summarizeJson_('status.json', { state: 'early_stopped', latest_validation_metrics: { accuracy: .15 } });
  const cat = c.buildCatalog_(work);
  assert.equal(cat.records.find(r => r.id === 'plot').runId, 'run-hmdb');
  assert.equal(cat.records.find(r => r.id === 'plot').state, 'early_stopped');
  assert.equal(cat.records.find(r => r.id === 'attr').state, '');
  assert.equal(cat.runs.find(r => r.id === 'run-wpp').metrics.length, 0);
  assert.equal(cat.runs.find(r => r.id === 'run-hmdb').metrics[0].sourceId, 'status');
  assert.equal(cat.groups.find(r => r.id === 'group-hmdb').figures, 1);
  assert.equal(cat.complete, true);
});
