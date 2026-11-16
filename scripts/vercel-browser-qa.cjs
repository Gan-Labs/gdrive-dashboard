'use strict';
// Actual built browser transport + actual Node API with synthetic Google responses.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { createHandler } = require('../api/dashboard.js');
const { ROOT, PNG } = require('../tests/harness.cjs');
const root = path.resolve(__dirname, '..'), FOLDER = 'application/vnd.google-apps.folder';
async function main() {
  let failList = false, expireNext = false;
  const file = (id, name, mimeType, parents) => ({ id, name, mimeType, parents, size: '400', modifiedTime: '2026-11-16T00:00:00Z' });
  const metadata = { [ROOT]: file(ROOT, 'Figures', FOLDER, []), group: file('group', 'ResNet HMDB51', FOLDER, [ROOT]),
    run: file('run', 'HMDB51_video_800k_gop8', FOLDER, ['group']),
    summary: file('summary', 'status.json', 'application/json', ['run']),
    csv: file('csv', 'results.csv', 'text/csv', ['run']),
    outside: file('outside', 'private.txt', 'text/plain', []) };
  for (let i = 0; i < 57; i++) metadata['plot-' + i] = file('plot-' + i, 'accuracy_' + i + '.png', 'image/png', ['run']);
  const handler = createHandler({ rootId: ROOT, fetchImpl: async url => {
    const u = new URL(url), id = u.pathname.split('/').pop();
    if (expireNext) { expireNext = false; return new Response('', { status: 401 }); }
    if (u.pathname.endsWith('/about')) return Response.json({ user: { permissionId: 'fixture-user', emailAddress: 'fixture@example.test' } });
    if (u.pathname.endsWith('/files')) {
      if (failList) { failList = false; return new Response('', { status: 503 }); }
      const parent = u.searchParams.get('q').match(/^'([^']+)'/)[1];
      let files = Object.values(metadata).filter(f => f.parents.includes(parent));
      if (parent === 'run') {
        const second = u.searchParams.get('pageToken') === 'page2';
        files = second ? files.slice(40) : files.slice(0, 40);
        return Response.json({ files, ...(second ? {} : { nextPageToken: 'page2' }) });
      }
      return Response.json({ files });
    }
    if (u.searchParams.get('alt') === 'media') {
      if (id === 'summary') return Response.json({ state: 'complete', latest_validation_metrics: { accuracy: 0.75 } });
      if (id === 'csv') return new Response('name,value\n"one,two",3');
      return new Response(Buffer.from(PNG, 'base64'), { headers: { 'content-type': 'image/png' } });
    }
    return metadata[id] ? Response.json(metadata[id]) : new Response('', { status: 404 });
  } });
  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/dashboard') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      req.body = Buffer.concat(chunks).toString('utf8'); return handler(req, res);
    }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const name = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (name === 'config.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('window.ENTROPY_CONFIG=' + JSON.stringify({ clientId: 'fixture.apps.googleusercontent.com', rootId: ROOT })); return; }
    if (!['index.html', 'core.js', 'indexer.js', 'vercel.js'].includes(name)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : 'text/html');
    res.end(fs.readFileSync(path.join(root, 'public', name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let executablePath = process.env.ENTROPY_CHROME;
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  if (!executablePath && fs.existsSync(cache)) for (const entry of fs.readdirSync(cache)) {
    const candidate = path.join(cache, entry, 'chrome-headless-shell-linux64/chrome-headless-shell');
    if (entry.startsWith('chromium_headless_shell-') && fs.existsSync(candidate)) executablePath = candidate;
  }
  let browser, checks = 0; const errors = [];
  try {
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
    await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'text/javascript', body:
      'window.google={accounts:{oauth2:{hasGrantedAllScopes:()=>true,initTokenClient:options=>({requestAccessToken:()=>options.callback({access_token:"fixture-token",expires_in:3600})})}}};' }));
    await page.goto(origin); await page.locator('#googleAuth[open]').waitFor();
    assert.equal(await page.locator('#statFiles').textContent(), '—'); checks++;
    await page.getByRole('button', { name: 'Connect Google Drive' }).click();
    await page.waitForSelector('.empty');
    await page.getByRole('button', { name: 'Start indexing Figures' }).click();
    await page.waitForFunction(() => document.querySelector('#statFiles').textContent === '59' && document.querySelector('#refresh').textContent.includes('Refresh index'));
    assert.equal(await page.locator('.figure-card').count(), 48); checks++;
    await page.locator('#loadMore').click(); assert.equal(await page.locator('.figure-card').count(), 57); checks++;
    await page.locator('.open-figure').first().click(); await page.waitForSelector('#viewerBody img');
    assert.match(await page.locator('#viewerBody img').getAttribute('src'), /^data:image\/png;base64,/); checks++;
    await page.locator('#closeViewer').click();
    await page.locator('[data-view="runs"]').click(); await page.getByRole('button', { name: 'Inspect 1 metrics' }).click();
    assert.match(await page.locator('.run-detail').textContent(), /75\.00%/); checks++;
    await page.locator('#closeViewer').click();
    // Reload requires a fresh token and then restores the saved browser catalog.
    await page.reload(); await page.locator('#googleAuth[open]').waitFor();
    await page.getByRole('button', { name: 'Connect Google Drive' }).click();
    await page.waitForFunction(() => document.querySelector('#statFiles').textContent === '59'); checks++;
    failList = true; await page.locator('#refresh').click(); await page.locator('#error:not([hidden])').waitFor();
    assert.equal(await page.locator('#statFiles').textContent(), '59'); checks++;
    await page.waitForFunction(() => document.querySelector('#refresh').textContent.includes('Resume'));
    await page.locator('#refresh').click(); await page.waitForFunction(() => document.querySelector('#refresh').textContent.includes('Refresh index')); checks++;
    expireNext = true; await page.locator('#refresh').click(); await page.locator('#googleAuth[open]').waitFor();
    await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
    await page.getByRole('button', { name: 'Connect Google Drive' }).click();
    await page.waitForFunction(() => document.querySelector('#refresh').textContent.includes('Refresh index')); checks++;
    const denied = await page.request.post(origin + '/api/dashboard', { data: { action: 'getFileDetail', id: 'outside' }, headers: { Authorization: 'Bearer fixture-token' } });
    assert.equal(denied.status(), 403); checks++;
    const anonymous = await page.request.post(origin + '/api/dashboard', { data: { action: 'session' } });
    assert.equal(anonymous.status(), 401); checks++;
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); checks++;
    }
    fs.mkdirSync(path.join(root, 'test-artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'test-artifacts/vercel-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.locator('#googleAuth[open]').waitFor();
    await page.getByRole('button', { name: 'Connect Google Drive' }).click();
    await page.waitForSelector('.empty');
    assert.equal(await page.locator('#statFiles').textContent(), '0'); checks++;
    assert.deepEqual(errors, []);
    const report = { passed: checks, browser: await browser.version(), scope: 'Actual Vercel build, browser storage/transport and Node handler with synthetic Google OAuth/Drive responses. Live Google consent and production deployment not tested.' };
    fs.writeFileSync(path.join(root, 'test-artifacts/vercel-browser-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
