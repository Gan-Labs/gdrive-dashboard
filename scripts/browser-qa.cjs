'use strict';
// UI tests use synthetic RPC responses, never Google credentials or downloaded results.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { harness, sampleWork, PNG } = require('../tests/harness.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-artifacts');

function previewHtml(mode = 'normal') {
  const h = harness(); const work = sampleWork();
  for (let i = 0; i < 57; i++) work.files.push({
    id: 'fixture-' + i, parentId: i < 53 ? 'eval-hmdb' : 'run-wpp',
    name: i < 53 ? ['accuracy_curves', 'loss_curves', 'test_confusion_matrix_normalized', 'precision_curves'][i % 4] + '_' + i + '.png' : 'class_attribution_maps_' + i + '.png',
    path: work.folders[i < 53 ? 2 : 4].path + '/figure_' + i + '.png',
    mimeType: 'image/png', modifiedTime: '2026-11-14T00:00:00Z', size: 128000
  });
  work.files.push({ id: 'fixture-json', parentId: 'run-hmdb', name: 'status.json', path: work.folders[1].path + '/status.json', mimeType: 'application/json', size: 500 },
    { id: 'fixture-csv', parentId: 'eval-hmdb', name: 'test_metrics.csv', path: work.folders[2].path + '/test_metrics.csv', mimeType: 'text/csv', size: 100 },
    { id: 'fixture-xss', parentId: 'eval-hmdb', name: '<img src=x onerror="window.injected=true">.txt', path: work.folders[2].path + '/unsafe-name.txt', mimeType: 'text/plain', size: 20 });
  work.summaries['fixture-json'] = h.context.summarizeJson_('status.json', { state: 'early_stopped', latest_validation_metrics: { accuracy: 0, macro_f1: .13 } });
  const fixture = { catalog: h.context.buildCatalog_(work),
    status: { active: false, scannedFolders: 5, files: work.files.length, pendingFolders: 0, scheduled: false } };
  if (mode === 'empty') { fixture.catalog.records = []; fixture.catalog.runs = []; fixture.catalog.groups = []; fixture.catalog.complete = false; }
  const seed = JSON.stringify(fixture).replace(/</g, '\\u003c');
  const mock = `<script>
  (function(){
  window.__ER_QA=true;
  const fixture=${seed};
  window.google={script:{history:{replace(){}},url:{getLocation(fn){fn({parameter:{}})}}}};
  Object.defineProperty(google.script,'run',{get(){let good,bad;let proxy;proxy=new Proxy({}, {get(_,name){
    if(name==='withSuccessHandler')return fn=>{good=fn;return proxy};
    if(name==='withFailureHandler')return fn=>{bad=fn;return proxy};
    return (...args)=>setTimeout(()=>{try{
      if(${JSON.stringify(mode)}==='failure'&&name==='getCatalog')throw Error('Simulated Drive outage');
      if(name==='getCatalog')return good(structuredClone(fixture));
      if(name==='getPreview')return good({dataUrl:'data:image/png;base64,${PNG}',original:true});
      if(name==='getFileDetail')return good(args[0]==='fixture-csv'?{table:{rows:[['class','accuracy'],['example','0']],totalRows:1,truncated:false}}:{text:'{"accuracy":0,"note":"<script>literal text<\\/script>"}'});
      if(name==='startIndex'){fixture.status.active=true;return good(structuredClone(fixture.status))}
      if(name==='continueIndex'){fixture.status.active=false;fixture.catalog.complete=true;fixture.catalog.indexedAt=new Date().toISOString();return good(structuredClone(fixture.status))}
      if(name==='setup'){fixture.status.scheduled=true;fixture.status.active=false;return good(structuredClone(fixture.status))}
      throw Error('Unexpected RPC '+name);
    }catch(error){bad(error)}},10);
  }});return proxy}});
  }());
  <\/script>`;
  return fs.readFileSync(path.join(root, 'src', 'Index.html'), 'utf8')
    .replace("<?!= include_('Styles'); ?>", fs.readFileSync(path.join(root, 'src', 'Styles.html'), 'utf8'))
    .replace("<?!= include_('Client'); ?>", fs.readFileSync(path.join(root, 'src', 'Client.html'), 'utf8'))
    .replace('</head>', mock + '</head>');
}

async function main() {
  const candidates = [];
  if (process.env.ENTROPY_PLAYWRIGHT_PATH) candidates.push(process.env.ENTROPY_PLAYWRIGHT_PATH);
  candidates.push(path.join(root, 'node_modules', 'playwright-core'));
  const cache = path.join(os.homedir(), '.npm', '_npx');
  if (fs.existsSync(cache)) for (const d of fs.readdirSync(cache)) candidates.push(path.join(cache, d, 'node_modules', 'playwright-core'));
  const library = candidates.find(p => fs.existsSync(path.join(p, 'package.json')));
  if (!library) throw Error('No installed Playwright library was found. UI tests were not run.');
  const { chromium } = require(library);
  const chromeCandidates = [process.env.ENTROPY_CHROME, chromium.executablePath(), '/Applications/my_applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  const pwCache = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(pwCache)) for (const d of fs.readdirSync(pwCache))
    if (d.startsWith('chromium_headless_shell-')) chromeCandidates.push(path.join(pwCache, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell'));
  const browsers = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
  if (fs.existsSync(browsers)) for (const d of fs.readdirSync(browsers)) chromeCandidates.unshift(path.join(browsers, d, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'));
  const executables = chromeCandidates.filter(p => p && fs.existsSync(p));
  if (!executables.length) throw Error('No installed test browser was found. UI tests were not run.');
  fs.mkdirSync(output, { recursive: true });
  let browser;
  for (const executablePath of executables) {
    try {
      browser = await chromium.launch({ executablePath, headless: true, timeout: 15000, args: ['--no-sandbox', '--disable-crash-reporter', '--disable-breakpad'] });
      break;
    } catch (_) {}
  }
  if (!browser) throw Error('The installed browsers could not launch in this environment. UI tests were not run. Run the launcher directly in Mac Terminal.');
  let checks = 0;
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent(previewHtml(), { waitUntil: 'load' });
    await page.waitForSelector('.figure-card');
    assert.equal(await page.locator('.figure-card').count(), 48); checks++;
    await page.locator('#loadMore').click(); assert.equal(await page.locator('.figure-card').count(), 57); checks++;
    await page.locator('#dataset').selectOption('UCF11'); assert.equal(await page.locator('.figure-card').count(), 4); checks++;
    await page.locator('#className').selectOption('trampoline jumping'); assert.equal(await page.locator('.figure-card').count(), 4); checks++;
    await page.locator('#clearFilters').click();
    await page.locator('#search').fill('confusion'); assert.equal(await page.locator('.figure-card').count(), 13); checks++;
    await page.locator('#search').fill('no such figure anywhere'); assert.equal(await page.locator('.empty h3').textContent(), 'No matching results'); checks++;
    await page.locator('#clearFilters').click();
    const firstId = await page.locator('.image-placeholder').first().getAttribute('data-file-id');
    await page.locator('.save-figure').first().click(); await page.locator('#savedResults').click(); assert.equal(await page.locator('.figure-card').count(), 1); checks++;
    await page.locator('#allResults').click();
    for (let i = 0; i < 4; i++) await page.locator('.select-figure input').nth(i).check();
    await page.locator('.select-figure input').nth(4).click(); assert.equal(await page.locator('.select-figure input:checked').count(), 4); checks++;
    await page.locator('#compare').click(); await page.waitForSelector('dialog[open]'); assert.equal(await page.locator('.compare-cell').count(), 4); checks++;
    await page.keyboard.press('Escape'); assert.equal(await page.locator('dialog[open]').count(), 0); checks++;
    await page.locator('#clearSelection').click();
    await page.locator('.open-figure').first().click(); await page.waitForSelector('.detail-info');
    const originalTitle = await page.locator('#viewerTitle').textContent();
    await page.keyboard.press('ArrowRight'); assert.notEqual(await page.locator('#viewerTitle').textContent(), originalTitle); checks++;
    await page.locator('#closeViewer').click();
    await page.locator('[data-view="runs"]').click(); assert.equal(await page.locator('#results tbody tr').count(), 2); checks++;
    await page.getByRole('button', { name: 'Inspect 2 metrics', exact: true }).click();
    assert.match(await page.locator('.run-detail').textContent(), /Latest validation/); assert.match(await page.locator('.run-detail').textContent(), /0\.00%/); checks++;
    await page.locator('#closeViewer').click();
    await page.locator('[data-view="files"]').click(); await page.locator('#search').fill('status.json');
    await page.getByRole('button', { name: 'status.json', exact: true }).click(); await page.waitForSelector('.detail-preview pre');
    assert.match(await page.locator('.detail-preview pre').textContent(), /<script>literal text/); assert.equal(await page.evaluate(() => window.injected), undefined); checks++;
    await page.locator('#closeViewer').click(); await page.locator('#search').fill('test_metrics.csv');
    await page.getByRole('button', { name: 'test_metrics.csv', exact: true }).click(); await page.waitForSelector('.detail-preview table');
    assert.equal(await page.locator('.detail-preview table tr').count(), 2); checks++;
    await page.locator('#closeViewer').click(); await page.locator('#clearFilters').click();
    await page.locator('[data-view="gallery"]').click();
    await page.locator('#refresh').click(); await page.waitForFunction(() => document.getElementById('refresh').textContent.includes('Refresh index'));
    assert.equal(await page.locator('#error').isVisible(), false); checks++;
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    for (const width of [390, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Horizontal overflow at width ' + width); checks++;
      if (width === 390) {
        await page.locator('#browseToggle').click(); assert.equal(await page.locator('.sidebar').isVisible(), true); checks++;
        await page.locator('#allResults').click(); assert.equal(await page.locator('.sidebar').isVisible(), false); checks++;
        await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
      }
    }
    await page.setContent(previewHtml('empty')); await page.waitForSelector('.empty'); assert.match(await page.locator('.empty').textContent(), /Start indexing Figures/); checks++;
    await page.setContent(previewHtml('failure')); await page.waitForSelector('#error:not([hidden])'); assert.match(await page.locator('#errorText').textContent(), /Simulated Drive outage/); checks++;
    assert.deepEqual(errors, []);
    const report = { passed: checks, scope: 'Local HTML interface with synthetic Google Apps Script RPC responses; not a live Drive/deployment test.', browser: await browser.version() };
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally { await browser.close(); }
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { previewHtml };
