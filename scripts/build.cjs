'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, 'src', name), 'utf8');
const config = {
  mode: process.env.DASHBOARD_MODE === 'shared' ? 'shared' : 'personal',
  clientId: process.env.GOOGLE_CLIENT_ID || '',
  rootId: process.env.GOOGLE_DRIVE_ROOT_ID || '1qXAMcNrZuqk4wlGbqZlmHydQ-cSthbIV'
};
if (!/^[\w-]+$/.test(config.rootId)) throw Error('Invalid GOOGLE_DRIVE_ROOT_ID.');
if (config.clientId && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(config.clientId))
  throw Error('GOOGLE_CLIENT_ID must be a Google OAuth web client ID.');
const publicDir = path.join(root, 'public');
fs.mkdirSync(publicDir, { recursive: true });
let html = read('Index.html').replace("<?!= include_('Styles'); ?>", read('Styles.html'))
  .replace("<?!= include_('Client'); ?>", '<script src="/config.js"></script>\n<script src="/core.js"></script>\n<script src="/indexer.js"></script>\n<script src="/' + (config.mode === 'shared' ? 'shared' : 'vercel') + '.js"></script>\n' + read('Client.html') + (config.mode === 'shared' ? '\n<link rel="stylesheet" href="/boards.css">\n<script src="/boards.js"></script>' : ''))
  .replaceAll('1qXAMcNrZuqk4wlGbqZlmHydQ-cSthbIV', config.rootId)
  .replace('<base target="_top">', '<title>Entropy Results Dashboard</title>');
fs.writeFileSync(path.join(publicDir, 'index.html'), html);
fs.writeFileSync(path.join(publicDir, 'core.js'), read('Core.gs'));
fs.copyFileSync(path.join(root, 'web', 'vercel.js'), path.join(publicDir, 'vercel.js'));
fs.copyFileSync(path.join(root, 'web', 'indexer.js'), path.join(publicDir, 'indexer.js'));
fs.copyFileSync(path.join(root, 'web', 'shared.js'), path.join(publicDir, 'shared.js'));
for (const file of ['boards.js', 'boards.css']) fs.copyFileSync(path.join(root, 'web', file), path.join(publicDir, file));
// Only these explicitly public settings enter the browser build.
fs.writeFileSync(path.join(publicDir, 'config.js'), 'window.ENTROPY_CONFIG=' + JSON.stringify(config).replace(/</g, '\\u003c') + ';\n');
console.log('Vercel static build ready in public/. API: api/dashboard.js (Node.js).');
if (config.mode === 'personal' && !config.clientId) console.log('Set GOOGLE_CLIENT_ID before deploying to enable Google Drive sign-in.');
if (config.mode === 'shared') console.log('Shared mode: configure backend service account, private Blob store and DASHBOARD_PASSWORD.');
