'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { root, authFile, cli, runClasp } = require('./clasp.cjs');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
}
function readJson(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; }
function check(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Local checks failed; nothing was uploaded.');
}
function canonical(text) { return String(text).replace(/\r\n/g, '\n').trimEnd(); }

async function deploy() {
  check(process.execPath, [path.join(root, 'scripts', 'check.cjs')]);
  check(process.execPath, ['--test', ...fs.readdirSync(path.join(root, 'tests')).filter(n => n.endsWith('.test.cjs')).map(n => path.join(root, 'tests', n))]);
  if (!fs.existsSync(cli)) throw new Error('clasp is missing. Run ./setup-and-deploy.command first.');
  if (!fs.existsSync(authFile)) throw new Error('Google sign-in is required. Run ./setup-and-deploy.command.');
  const { initAuth } = await import(pathToFileURL(path.join(path.dirname(cli), 'auth', 'auth.js')).href);
  const auth = await initAuth({ authFilePath: authFile, userKey: 'default' });
  if (!auth.credentials) throw new Error('Sign-in could not be loaded. Run the setup launcher again.');
  const { google } = require(path.join(root, '.tools', 'node_modules', 'googleapis'));
  const api = google.script({ version: 'v1', auth: auth.credentials });
  const drive = google.drive({ version: 'v3', auth: auth.credentials });
  const configPath = path.join(root, '.clasp.json');
  const pendingPath = path.join(root, '.cache', 'project-creation.json');
  let config = readJson(configPath);
  if (!config) {
    // Resolve an uncertain earlier create before attempting another project.
    let pending = readJson(pendingPath);
    let scriptId;
    if (pending) {
      const response = await drive.files.list({ q: "mimeType = 'application/vnd.google-apps.script' and name = 'Entropy Results Dashboard' and trashed = false and createdTime >= '" + pending.startedAt + "'", fields: 'files(id,name)', pageSize: 100 });
      const matches = response.data.files || [];
      if (matches.length !== 1) throw new Error('An earlier project creation needs reconciliation. Open Apps Script and identify whether it created Entropy Results Dashboard; do not create another project yet.');
      scriptId = matches[0].id;
    } else {
      pending = { startedAt: new Date().toISOString() }; writeJson(pendingPath, pending);
      try {
        const created = await api.projects.create({ requestBody: { title: 'Entropy Results Dashboard' } });
        scriptId = created.data.scriptId;
      } catch (error) {
        // Definitive rejections created no project. Preserve the marker only for uncertain outcomes.
        const status = error.response?.status;
        if ([400, 401, 403, 404, 409, 429].includes(status)) fs.unlinkSync(pendingPath);
        throw error;
      }
    }
    if (!scriptId) throw new Error('Google did not return a project identifier.');
    config = { scriptId, rootDir: 'src', scriptExtensions: ['.gs', '.js'], htmlExtensions: ['.html'], jsonExtensions: ['.json'], filePushOrder: ['src/Core.gs', 'src/Server.gs'] };
    writeJson(configPath, config);
  }
  if (config.rootDir !== 'src') throw new Error('Unexpected clasp source directory; deployment stopped.');
  const expected = fs.readdirSync(path.join(root, 'src')).filter(n => /\.(gs|html|json)$/.test(n)).sort();
  const fileStatus = JSON.parse(runClasp(['--json', 'show-file-status']));
  const pushedNames = fileStatus.filesToPush.map(n => path.basename(n)).sort();
  if (JSON.stringify(expected) !== JSON.stringify(pushedNames)) throw new Error('clasp would upload an unexpected set of files. Check .claspignore.');
  console.log('Uploading ' + expected.length + ' source files to the standalone Apps Script project…');
  runClasp(['push', '--force'], { inherit: true });
  const head = await api.projects.getContent({ scriptId: config.scriptId });
  function verifySource(files) {
    for (const name of expected) {
      const remoteName = name.replace(/\.(gs|html|json)$/, '');
      const found = files.find(f => f.name === remoteName);
      const local = fs.readFileSync(path.join(root, 'src', name), 'utf8');
      const same = found && (name.endsWith('.json') ? isDeepStrictEqual(JSON.parse(found.source), JSON.parse(local)) : canonical(found.source) === canonical(local));
      if (!same)
        throw new Error('Cloud source verification failed for ' + name + '.');
    }
    const manifest = JSON.parse(files.find(f => f.name === 'appsscript').source);
    if (manifest.webapp.access !== 'MYSELF' || manifest.webapp.executeAs !== 'USER_DEPLOYING')
      throw new Error('Private deployment settings were not preserved.');
  }
  verifySource(head.data.files || []);
  const sourceHash = crypto.createHash('sha256');
  expected.forEach(name => sourceHash.update(name).update(fs.readFileSync(path.join(root, 'src', name))));
  const hash = sourceHash.digest('hex');
  const description = 'Entropy dashboard ' + hash.slice(0, 12);
  const statePath = path.join(root, 'deployment.json');
  let saved = readJson(statePath);
  // Reuse the existing deployment, including one created before a lost local response.
  if (!saved) {
    const listed = await api.projects.deployments.list({ scriptId: config.scriptId, pageSize: 50 });
    const existing = (listed.data.deployments || []).filter(d => String(d.deploymentConfig?.description || '').startsWith('Entropy dashboard '));
    if (existing.length > 1) throw new Error('Multiple dashboard deployments exist. Choose the intended one before updating.');
    if (existing.length === 1) saved = { deploymentId: existing[0].deploymentId };
  }
  const args = ['--json', 'create-deployment', '--description', description];
  if (saved?.deploymentId) args.push('--deploymentId', saved.deploymentId);
  const deployed = JSON.parse(runClasp(args));
  if (!deployed.deploymentId) throw new Error('Google did not return a deployment identifier.');
  saved = { ...saved, ...deployed, scriptId: config.scriptId, sourceHash: hash, deployedAt: new Date().toISOString(), verified: false };
  writeJson(statePath, saved);
  const readback = await api.projects.deployments.get({ scriptId: config.scriptId, deploymentId: deployed.deploymentId });
  const versionNumber = readback.data.deploymentConfig?.versionNumber;
  if (!versionNumber) throw new Error('The deployment has no version number.');
  const version = await api.projects.getContent({ scriptId: config.scriptId, versionNumber });
  verifySource(version.data.files || []);
  const web = (readback.data.entryPoints || []).find(e => e.webApp?.url);
  if (!web) throw new Error('No web-app entry point was returned. Open Apps Script and check the web app deployment.');
  if (web.webApp.entryPointConfig?.access !== 'MYSELF') throw new Error('Google did not confirm owner-only web-app access.');
  saved.url = web.webApp.url; saved.versionNumber = versionNumber; saved.verified = true;
  writeJson(statePath, saved);
  console.log('\nDEPLOYED AND SOURCE VERIFIED');
  console.log(saved.url);
  console.log('\nOpen this URL to authorize the dashboard, then choose Start indexing Figures.');
  console.log('Use Enable automatic refresh in the dashboard to keep the catalog current.');
  if (process.platform === 'darwin') spawnSync('/usr/bin/open', [saved.url], { stdio: 'ignore' });
  return saved;
}

if (require.main === module) deploy().catch(error => {
  console.error('\nDeployment stopped: ' + error.message);
  if (/script.*api|access.*disabled|403/i.test(error.message)) console.error('Enable Google Apps Script API at https://script.google.com/home/usersettings, then run the launcher again.');
  process.exitCode = 1;
});
module.exports = { deploy, canonical };
