'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const authFile = process.env.ENTROPY_AUTH_FILE || path.join(os.homedir(), '.config', 'entropy-results-dashboard', '.clasprc.json');
const cli = path.join(root, '.tools', 'node_modules', '@google', 'clasp', 'build', 'src', 'index.js');

function runClasp(args, options = {}) {
  if (!fs.existsSync(cli)) throw new Error('clasp is not installed. Run ./setup-and-deploy.command in Mac Terminal.');
  const result = spawnSync(process.execPath, [cli, '--auth', authFile, ...args], {
    cwd: root, env: process.env, stdio: options.inherit ? 'inherit' : 'pipe',
    encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'clasp failed.').trim());
  return options.inherit ? null : result.stdout.trim();
}

if (require.main === module) {
  try { runClasp(process.argv.slice(2), { inherit: true }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { root, authFile, cli, runClasp };
