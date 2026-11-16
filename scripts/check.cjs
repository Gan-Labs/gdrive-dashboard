'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');
for (const file of fs.readdirSync(src)) {
  const text = fs.readFileSync(path.join(src, file), 'utf8');
  if (file.endsWith('.gs')) new vm.Script(text, { filename: file });
  if (file.endsWith('.html')) {
    for (const match of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))
      new vm.Script(match[1], { filename: file });
    if (file === 'Index.html') for (const match of text.matchAll(/include_\('([^']+)'\)/g))
      assert(fs.existsSync(path.join(src, match[1] + '.html')), 'Missing include ' + match[1]);
  }
}
const manifest = JSON.parse(fs.readFileSync(path.join(src, 'appsscript.json'), 'utf8'));
assert.equal(manifest.webapp.access, 'MYSELF');
assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');
assert(manifest.dependencies.enabledAdvancedServices.some(s => s.userSymbol === 'Drive' && s.version === 'v3'));
assert.equal(manifest.runtimeVersion, 'V8');
console.log('Source syntax, template includes, and private deployment manifest: PASS');
for (const directory of ['api', 'web', 'scripts']) for (const file of fs.readdirSync(path.join(root, directory))) {
  if (/\.(js|cjs)$/.test(file)) new vm.Script(fs.readFileSync(path.join(root, directory, file), 'utf8'), { filename: directory + '/' + file });
}
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
assert.equal(vercel.outputDirectory, 'public');
assert.equal(vercel.buildCommand, 'npm run build');
assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).engines.node, '22.x');
console.log('Vercel API/browser/build syntax and hosting configuration: PASS');
