'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { createSharedDashboard } = require('../lib/shared.cjs');
const { ROOT, PNG } = require('../tests/harness.cjs');
const root = path.resolve(__dirname, '..'), PASSWORD = 'demo';
async function main() {
  const disk = new Map(), queue = []; let etag = 0, working = false, listCalls = 0, originalCalls = 0;
  const store = { async read(key) { return disk.has(key) ? structuredClone(disk.get(key)) : null; },
    async write(key, value, match) {
      const previous = disk.get(key);
      if (previous ? previous.etag !== match : !!match) throw Object.assign(Error('conflict'), { status: 409 });
      const saved = { value: structuredClone(value), etag: String(++etag) }; disk.set(key, saved); return structuredClone(saved);
    } };
  const previews = { dataUrl: 'data:image/png;base64,' + PNG, original: false, note: '' };
  const drive = { async call(action, args) {
    if (action === 'getMetadata') return { id: ROOT, name: 'Figures', mimeType: 'application/vnd.google-apps.folder' };
    if (action === 'getPreview') { if (args.original) originalCalls++; return { ...previews, original: !!args.original }; }
    if (action === 'getFileDetail') return args.id === 'scores' ? { text: '', table: { rows: [['Method', 'Score'], ['Fixture model', '0.75']], totalRows: 1, truncated: false }, note: '' } : { text: '{"fixture":true}', table: null, note: '' };
    listCalls++;
    await new Promise(resolve => setTimeout(resolve, 150));
    if (args.id === ROOT) return { files: [{ id: 'group', name: 'ResNet HMDB51', mimeType: 'application/vnd.google-apps.folder' }], summaries: {}, warnings: [] };
    return { files: [...Array.from({ length: 3 }, (_, i) => ({ id: 'plot' + i, name: 'accuracy_' + i + '.png',
      mimeType: 'image/png', size: '6000000', modifiedTime: '2026-11-16T00:00:00Z' })),
      { id: 'scores', name: 'scores.csv', mimeType: 'text/csv' }, { id: 'metrics', name: 'metrics.json', mimeType: 'application/json' }],
    summaries: { metrics: { metrics: [{ label: 'Accuracy', value: .75, split: 'Test', block: '' }], facts: [], classes: [], state: '' } }, warnings: [] };
  }, async thumbnail() { return previews; }, async open(id) {
    originalCalls++;
    return { file: { id, name: 'figure.png', mimeType: 'image/png' }, response: new Response(Buffer.from(PNG, 'base64')) };
  } };
  const make = () => createSharedDashboard({ rootId: ROOT, password: PASSWORD, store, drive, batchPages: 1,
    enqueue: async message => { queue.push(message); if (!working) setTimeout(drain, 50); } });
  async function drain() {
    if (working) return; working = true;
    try { while (queue.length) await make().processJob(queue.shift()); }
    finally { working = false; }
  }
  const app = make();
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/api/original?')) return app.fileHandler(req, res);
    if (req.url === '/api/dashboard') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      req.body = Buffer.concat(chunks).toString('utf8'); return app.handler(req, res);
    }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const name = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!['index.html', 'core.js', 'config.js', 'indexer.js', 'shared.js', 'boards.js', 'boards.css'].includes(name)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(path.join(root, 'public', name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let executablePath = process.env.ENTROPY_CHROME;
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  if (!executablePath && fs.existsSync(cache)) for (const entry of fs.readdirSync(cache)) {
    const candidate = path.join(cache, entry, 'chrome-headless-shell-linux64/chrome-headless-shell');
    if (fs.existsSync(candidate)) executablePath = candidate;
  }
  let browser, checks = 0; const errors = [], googleRequests = [];
  try {
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    context.on('page', page => {
      page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
      page.on('request', req => { if (/accounts\.google\.com|googleapis\.com/.test(req.url())) googleRequests.push(req.url()); });
    });
    let page = await context.newPage(); await page.goto(origin);
    await page.locator('#sharedAuth[open]').waitFor();
    assert.equal(await page.locator('#googleAuth').count(), 0); checks++;
    await page.getByLabel('Dashboard password').fill('wrong'); await page.getByRole('button', { name: 'Open dashboard' }).click();
    await page.waitForFunction(() => document.querySelector('#sharedAuth').textContent.includes('Incorrect')); checks++;
    await page.getByLabel('Dashboard password').fill(PASSWORD); await page.getByRole('button', { name: 'Open dashboard' }).click();
    await page.getByRole('button', { name: 'Start indexing Figures' }).waitFor(); checks++;
    assert.deepEqual(await page.evaluate(() => window.entropyTransport.boardApi('checkConnection')), { connected: true, folder: { id: ROOT, name: 'Figures' } }); checks++;
    await page.getByRole('button', { name: 'Start indexing Figures' }).click();
    await page.waitForFunction(() => document.querySelector('#refresh').disabled);
    await page.close();
    // Worker/server keep running without any page or browser polling.
    let remaining = 50;
    while ((working || queue.length || !disk.has(app.key('current.json'))) && remaining-- > 0) await new Promise(resolve => setTimeout(resolve, 100));
    assert(disk.has(app.key('current.json'))); checks++;
    const scanned = listCalls;
    page = await context.newPage(); await page.goto(origin); await page.waitForSelector('.figure-card');
    assert.equal(await page.locator('.figure-card').count(), 3); assert.equal(listCalls, scanned); checks++;
    await page.reload(); await page.waitForSelector('.figure-card');
    assert.equal(await page.locator('#sharedAuth[open]').count(), 0); assert.equal(listCalls, scanned); checks++;
    const savedStatus = structuredClone(disk.get(app.key('status.json')));
    disk.get(app.key('status.json')).value = { ...savedStatus.value, active: false, paused: true,
      lastError: 'Your Google account cannot access this Figures file or folder.' };
    await page.reload(); await page.waitForSelector('.figure-card');
    assert.match(await page.locator('#notice').innerText(), /Your Google account cannot access this Figures file or folder/);
    assert.match(await page.locator('#notice').innerText(), /paused/i);
    assert.match(await page.locator('#refresh').innerText(), /Resume index/); checks++;
    disk.set(app.key('status.json'), savedStatus);
    await page.reload(); await page.waitForSelector('.figure-card');
    await page.waitForSelector('.image-placeholder img'); assert.equal(originalCalls, 0); checks++;
    await page.locator('.open-figure').first().click(); await page.waitForSelector('#viewerBody img');
    assert.equal(originalCalls, 1); checks++;
    await page.locator('#closeViewer').click();
    const collaborator = await browser.newContext();
    const second = await collaborator.newPage(); await second.goto(origin); await second.locator('#sharedAuth[open]').waitFor();
    await second.getByLabel('Dashboard password').fill(PASSWORD); await second.getByRole('button', { name: 'Open dashboard' }).click();
    await second.waitForSelector('.figure-card');
    assert.equal(await second.locator('.figure-card').count(), 3); assert.equal(listCalls, scanned); checks++;
    const boardApi = (target, action, args = {}) => target.evaluate(({ action, args }) => window.entropyTransport.boardApi(action, args), { action, args });
    const originalsBefore = originalCalls;
    await page.getByRole('button', { name: 'Pin to board', exact: true }).first().click();
    await page.locator('#pinBoardDialog[open]').waitFor();
    await page.getByLabel('New board name', { exact: true }).fill('Rebuttal evidence');
    await page.getByRole('button', { name: 'Pin and save', exact: true }).click();
    await page.getByLabel('Board title', { exact: true }).waitFor();
    await page.waitForSelector('.board-content img');
    let board = (await boardApi(page, 'listBoards')).boards[0];
    let saved = (await boardApi(page, 'getBoard', { id: board.id })).board;
    assert.equal(saved.items.length, 1); assert.equal(originalCalls, originalsBefore); checks++;
    const beforeLayout = { ...saved.items[0] };
    let box = await page.locator('.board-handle').boundingBox();
    await page.mouse.move(box.x + 50, box.y + 18); await page.mouse.down();
    await page.mouse.move(box.x + 130, box.y + 78, { steps: 5 }); await page.mouse.up();
    box = await page.locator('.board-resize').boundingBox();
    await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + 50, { steps: 5 }); await page.mouse.up();
    await page.locator('.board-handle').focus(); await page.keyboard.press('ArrowRight');
    await page.getByRole('button', { name: 'Add note', exact: true }).click();
    const note = 'Validation result: <script>literal text, not HTML</script>.';
    await page.getByLabel('Research note', { exact: true }).fill(note);
    await page.getByLabel('Board description', { exact: true }).fill('Figures, scores and interpretation');
    await page.getByRole('button', { name: 'Save board', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.board-status').textContent.startsWith('Saved for everyone'));
    saved = (await boardApi(page, 'getBoard', { id: board.id })).board;
    assert.equal(saved.items[0].x, beforeLayout.x + 100); assert.equal(saved.items[0].y, beforeLayout.y + 60);
    assert.equal(saved.items[0].width, beforeLayout.width + 80); assert.equal(saved.items[0].height, beforeLayout.height + 40); checks++;
    assert.equal(saved.items[1].text, note); checks++;
    await page.getByRole('button', { name: 'Browse & pin results', exact: true }).click();
    await page.evaluate(() => window.EntropyExplorer.openFile(window.EntropyExplorer.getCatalog().records.find(r => r.id === 'scores')));
    await page.locator('#viewer').getByRole('button', { name: 'Pin to board', exact: true }).click();
    await page.getByRole('button', { name: 'Pin and save', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.board-tile').length === 3);
    await page.getByRole('button', { name: 'Browse & pin results', exact: true }).click();
    await page.getByRole('tab', { name: 'Experiments', exact: true }).click();
    await page.getByRole('button', { name: 'Inspect 1 metrics', exact: true }).click();
    await page.getByRole('button', { name: 'Pin metrics to board', exact: true }).click();
    await page.getByRole('button', { name: 'Pin and save', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.board-tile').length === 4);
    // Fit brings the lower row into the lazy-loading viewport.
    await page.getByRole('button', { name: 'Fit content', exact: true }).click();
    await page.getByRole('cell', { name: 'Fixture model', exact: true }).waitFor();
    await page.getByRole('cell', { name: '75.00%', exact: true }).waitFor(); checks++;
    assert.equal(originalCalls, originalsBefore); checks++;
    await page.reload(); await page.getByLabel('Board title', { exact: true }).waitFor();
    assert.equal(await page.locator('.board-tile').count(), 4); assert.equal(await page.getByLabel('Research note', { exact: true }).inputValue(), note); checks++;
    const boardLink = page.url(); await second.goto(boardLink); await second.getByLabel('Board title', { exact: true }).waitFor();
    assert.equal(await second.locator('.board-tile').count(), 4); assert.equal(await second.getByLabel('Board title', { exact: true }).inputValue(), 'Rebuttal evidence'); checks++;
    await second.getByLabel('Board description', { exact: true }).fill('Collaborator saved a newer revision');
    await second.getByRole('button', { name: 'Save board', exact: true }).click();
    await second.waitForFunction(() => document.querySelector('.board-status').textContent.startsWith('Saved for everyone'));
    await page.getByLabel('Board description', { exact: true }).fill('My conflicting draft');
    await page.getByRole('button', { name: 'Save board', exact: true }).click();
    await page.locator('.board-conflict:visible').waitFor();
    assert.equal((await boardApi(page, 'getBoard', { id: board.id })).board.description, 'Collaborator saved a newer revision'); checks++;
    await page.getByRole('button', { name: 'Save draft as a copy', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.board-title').value.endsWith('(copy)'));
    assert.equal((await boardApi(page, 'listBoards')).boards.length, 2); checks++;
    await page.getByRole('button', { name: 'All boards', exact: true }).click();
    await page.waitForSelector('.board-summary');
    await page.evaluate(() => document.dispatchEvent(new Event('entropy:catalog')));
    assert.equal(await page.locator('.board-summary').count(), 2); checks++;
    await page.getByRole('button', { name: /Rebuttal evidence \(copy\)/ }).click();
    await page.getByRole('button', { name: 'Fit content', exact: true }).click();
    await page.screenshot({ path: path.join(root, 'test-artifacts/shared-board-desktop.png'), fullPage: true });
    await collaborator.close();
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); checks++;
    }
    await page.screenshot({ path: path.join(root, 'test-artifacts/shared-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await page.locator('#sharedAuth[open]').waitFor(); checks++;
    assert.deepEqual(googleRequests, []); checks++; assert.deepEqual(errors, []);
    const report = { passed: checks, browser: await browser.version(), scope: 'Built shared browser, real shared API/indexer/boards, synthetic private storage/Drive/queue. Covers closed-tab indexing, cookie auth, lazy originals, board figure/CSV/metrics/note pins, drag/resize/keyboard, reload, second collaborator, revision conflict/copy, mobile and sign-out. No deployed credentials or real Vercel storage/queue tested.' };
    fs.writeFileSync(path.join(root, 'test-artifacts/shared-browser-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
