'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');
const target = path.join(root, 'manual-upload');
const archive = path.join(root, 'entropy-results-dashboard-manual.zip');
const read = name => fs.readFileSync(path.join(src, name), 'utf8');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

function buildPackage() {
  const originalIndex = read('Index.html');
  const html = originalIndex.replace(/<\?!= include_\('([^']+)'\); \?>/g, (_, name) => read(name + '.html'));
  if (html.includes('<?')) throw Error('A template include was not resolved.');
  const expression = "HtmlService.createTemplateFromFile('Index').evaluate()";
  const originalServer = read('Server.gs');
  if (originalServer.split(expression).length !== 2) throw Error('Expected exactly one HTML entry point.');
  const server = originalServer.replace(expression, 'HtmlService.createHtmlOutput(getDashboardHtml_())')
    .replace(/^function include_\(name\) \{[^\n]+\}\r?\n/m, '');
  const htmlString = JSON.stringify(html).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const code = '// Entropy Results Dashboard — standalone manual installation.\n' +
    '// Paste this entire file into Code.gs. The interface is embedded below.\n' +
    '// Source files are bundled locally; Google Drive data is loaded only at runtime.\n\n' +
    read('Core.gs') + '\n' + server + '\nfunction getDashboardHtml_() {\n  return ' + htmlString + ';\n}\n';
  new vm.Script(code, { filename: 'Code.gs' });
  const manifest = read('appsscript.json');
  const settings = JSON.parse(manifest);
  if (settings.webapp.access !== 'MYSELF' || settings.webapp.executeAs !== 'USER_DEPLOYING')
    throw Error('Owner-only deployment settings were changed.');
  const readme = `# Manual installation\n\nOpen START-HERE.html in your browser for Copy buttons and detailed steps.\n\nThis package contains the complete dashboard as Code.gs, plus appsscript.json. No additional HTML files, clasp, npm, or terminal commands are needed for installation.\n\n1. Sign in with the Google account that should own the dashboard. Confirm that this account can open the Figures folder: https://drive.google.com/drive/folders/1qXAMcNrZuqk4wlGbqZlmHydQ-cSthbIV\n2. Go to https://script.google.com and create a New project named Entropy Results Dashboard.\n3. Replace the default Code.gs contents with the complete Code.gs file from this package.\n4. In Project Settings, enable Show appsscript.json manifest file in editor. Return to Editor and replace appsscript.json with the supplied manifest. Save. It enables the advanced Drive API v3 service.\n5. Select setup in the function dropdown and click Run. Complete Google's authorization flow for your own project. This checks access to Figures, starts indexing, and installs the refresh trigger. If Drive is missing from Services, add Drive API v3 there.\n6. Click Deploy > New deployment > Web app. Set Execute as to Me and Who has access to Only myself. Click Deploy and copy the Web app URL ending in /exec.\n7. Open that new URL using the deploying Google account. If a scan is active, choose Resume index to continue immediately; otherwise the installed trigger continues the scan.\n\nFor multiple Google accounts, use a browser profile or private window signed in only to the intended account. Google's multi-login limitation can still affect a manually deployed app.\n\nYou can move the standalone Apps Script project within your own Drive after creating it. Use a browser bookmark or a launch document containing the new web-app URL to open the dashboard; the Apps Script project itself opens the code editor. The existing launch document still points to the previous deployment until you replace its link.\n\nUploading this ZIP or an HTML file to an ordinary Drive folder stores a file. Running the dashboard requires the Apps Script setup and deployment above. START-HERE.html is an installation guide, not a connected results dashboard.\n\nGoogle references:\n- Standalone projects: https://developers.google.com/apps-script/guides/standalone\n- Web-app deployment: https://developers.google.com/apps-script/guides/web\n- Advanced Drive service: https://developers.google.com/apps-script/guides/services/advanced\n- Multiple-account troubleshooting: https://developers.google.com/apps-script/guides/support/troubleshooting#issues_with_multiple_google_accounts\n\nValidation: this package is generated from the source that passed 19 automated checks and 23 browser checks using synthetic RPC responses. The bundled entry point and exact embedded HTML are checked during packaging. A live Google sign-in, Drive indexing, and real result previews still need to be verified after your manual deployment.\n`;
  const payload = JSON.stringify({ code, manifest }).replace(/</g, '\\u003c');
  const guide = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Install Entropy Results Dashboard</title>
<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#18313a;background:#f3f6f4;line-height:1.65}*{box-sizing:border-box}body{margin:0}main{max-width:930px;margin:auto;padding:46px 24px 70px}header{border-bottom:1px solid #d9e3dd;padding-bottom:25px;margin-bottom:25px}.eyebrow{color:#14675d;font-size:11px;letter-spacing:2px;font-weight:700}h1{font-size:32px;line-height:1.2;letter-spacing:-.7px;margin:14px 0}h2{font-size:17px;margin:0 0 12px}p{font-size:14px;color:#4e646d}a{color:#14675d}section{padding:24px;margin:18px 0;background:white;border:1px solid #dbe5de;border-radius:12px}.step{display:inline-grid;place-items:center;width:28px;height:28px;background:#e9f3ed;color:#14675d;border-radius:50%;margin-right:9px;font-size:13px}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}.button,button{font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;border:1px solid #b9d1c4;border-radius:7px;background:#fff;color:#145e52;padding:11px 16px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}.primary{background:#14675d;color:white;border-color:#14675d}.button:hover,button:hover{filter:brightness(.96)}button:focus-visible,a:focus-visible,textarea:focus-visible{outline:3px solid #65bba4;outline-offset:3px}code{font-family:ui-monospace,SFMono-Regular,monospace;background:#f0f4f2;border-radius:4px;padding:2px 5px;font-size:12px}.settings{display:grid;grid-template-columns:150px 1fr;gap:9px 20px;font-size:14px}.settings dt{color:#647781}.settings dd{margin:0;font-weight:600}.notice{padding:15px 18px;background:#e7f2ec;border:1px solid #d0e2d6;border-radius:8px;font-size:13px;color:#305747}.note{font-size:12px;color:#647781}details{margin-top:15px;font-size:13px}textarea{width:100%;height:260px;margin-top:12px;resize:vertical;border:1px solid #dbe5de;border-radius:7px;padding:12px;font:11px/1.6 ui-monospace,SFMono-Regular,monospace;color:#29444d;background:#fafcfb}.copy-status{font-size:12px;min-height:20px;color:#14675d;margin:8px 0 0}.finish{display:flex;gap:10px;align-items:center;margin-top:15px}footer{font-size:12px;color:#6c7c82;margin-top:25px}@media(max-width:550px){main{padding:25px 16px}h1{font-size:27px}section{padding:19px}.settings{grid-template-columns:1fr;gap:2px}.settings dd{margin-bottom:12px}}
</style></head><body><main>
<header><div class="eyebrow">ENTROPY / MANUAL SETUP</div><h1>Your results dashboard.<br>Two files. Your Google account.</h1><p>Copy the bundled dashboard into a new standalone Apps Script project and deploy it from the browser.</p><div class="notice">This page is a local installation guide. The connected dashboard runs on Google after you deploy it.</div></header>
<section><h2><span class="step">1</span>Choose the Google account</h2><p>Sign in with the account that should own the dashboard. First confirm it can open your Figures folder. With several Google accounts, use a dedicated browser profile or private window signed in only to that account.</p><div class="actions"><a class="button" href="https://drive.google.com/drive/folders/1qXAMcNrZuqk4wlGbqZlmHydQ-cSthbIV" target="_blank" rel="noopener noreferrer">Check access to Figures ↗</a><a class="button primary" href="https://script.google.com" target="_blank" rel="noopener noreferrer">Open Apps Script ↗</a></div><p class="note">Choose New project and name it Entropy Results Dashboard. Start with a new project so the bundled functions have no duplicates.</p></section>
<section><h2><span class="step">2</span>Paste the dashboard code</h2><p>In the new project, open <code>Code.gs</code>. Select all its existing contents and replace them with the code below. The complete interface and server are included in this one file.</p><div class="actions"><button class="primary" id="copyCode">Copy Code.gs</button><a class="button" href="Code.gs" download>Save source file</a></div><p class="copy-status" id="codeStatus" role="status"></p><details><summary>View the bundled code</summary><textarea id="codeSource" readonly aria-label="Complete Code.gs source" spellcheck="false"></textarea></details></section>
<section><h2><span class="step">3</span>Paste the manifest</h2><p>Open <strong>Project Settings</strong> (the gear icon) and enable <strong>Show appsscript.json manifest file in editor</strong>. Return to the editor, open <code>appsscript.json</code>, and replace its contents with this manifest. Save the project.</p><div class="actions"><button class="primary" id="copyManifest">Copy appsscript.json</button><a class="button" href="appsscript.json" download>Save manifest</a></div><p class="copy-status" id="manifestStatus" role="status"></p><details><summary>View the manifest</summary><textarea id="manifestSource" readonly aria-label="Complete appsscript.json source" spellcheck="false"></textarea></details><p class="note">The manifest enables Drive API v3. If Drive does not appear under Services, use its + button to add Drive API, version v3.</p></section>
<section><h2><span class="step">4</span>Authorize and initialize</h2><p>Select <code>setup</code> in the function dropdown at the top of the editor, then click <strong>Run</strong>. Complete Google's authorization flow for your own project. Setup checks access to Figures, starts the catalog, and installs automatic refresh.</p><p class="note">The first scan can continue across several batches. If setup reports a folder-access error, confirm that this Google account can open Figures before deploying.</p></section>
<section><h2><span class="step">5</span>Deploy the web app</h2><p>Choose <strong>Deploy → New deployment</strong>, select <strong>Web app</strong> as the type, and use these settings:</p><dl class="settings"><dt>Execute as</dt><dd>Me</dd><dt>Who has access</dt><dd>Only myself</dd></dl><p>Click <strong>Deploy</strong>. Copy the <strong>Web app URL</strong> ending in <code>/exec</code> and open it using this same Google account.</p><div class="notice">Bookmark the new URL. If the catalog is still scanning, choose <strong>Resume index</strong> in the dashboard. The refresh trigger also continues the scan in the background.</div></section>
<section><h2>Keep it easy to find</h2><p>You can keep the standalone project in your own Drive. Opening the project shows the code editor. Use a bookmark or update the existing launch document with your new <code>/exec</code> URL to open the dashboard.</p><p class="note">The previous launch document still points to the earlier deployment until you replace its link. Uploading these files to an ordinary Drive folder stores them; the steps above create the running app.</p></section>
<footer>Package generated from the existing local source. Tests cover source behavior and the interface with synthetic responses; verify live Drive previews after deployment.<br><a href="README.md">Plain-text instructions</a> · <a href="https://developers.google.com/apps-script/guides/web" target="_blank" rel="noopener noreferrer">Google deployment guide ↗</a></footer>
</main><script>
(function(){
const sources=${payload};
document.getElementById('codeSource').value=sources.code;
document.getElementById('manifestSource').value=sources.manifest;
async function copy(which,area,status){
 const text=sources[which],field=document.getElementById(area),out=document.getElementById(status);
 try{if(!navigator.clipboard||!navigator.clipboard.writeText)throw Error('fallback');await navigator.clipboard.writeText(text);out.textContent='Copied. Paste the complete contents into the matching Apps Script file.';}
 catch(error){const details=field.closest('details');details.open=true;field.focus();field.select();try{if(document.execCommand('copy'))out.textContent='Copied. Paste into the matching Apps Script file.';else out.textContent='The full source is selected. Press Command+C (Mac) or Ctrl+C to copy.';}catch(ignore){out.textContent='The full source is selected. Press Command+C (Mac) or Ctrl+C to copy.';}}
}
document.getElementById('copyCode').addEventListener('click',function(){copy('code','codeSource','codeStatus');});
document.getElementById('copyManifest').addEventListener('click',function(){copy('manifest','manifestSource','manifestStatus');});
}());
</script></body></html>\n`;
  for (const match of guide.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1], { filename: 'START-HERE.html' });
  const files = { 'Code.gs': code, 'appsscript.json': manifest, 'START-HERE.html': guide, 'README.md': readme };
  const checksums = { schema: 1, files: {}, sourceFiles: {} };
  for (const [name, contents] of Object.entries(files)) checksums.files[name] = hash(contents);
  for (const name of fs.readdirSync(src).filter(name => /\.(gs|html|json)$/.test(name)).sort()) checksums.sourceFiles[name] = hash(read(name));
  files['CHECKSUMS.json'] = JSON.stringify(checksums, null, 2) + '\n';
  fs.mkdirSync(target, { recursive: true });
  for (const [name, contents] of Object.entries(files)) fs.writeFileSync(path.join(target, name), contents);
  const zipped = spawnSync('python3', ['-c',
    'from pathlib import Path\nimport sys,zipfile\nfolder=Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED) as z:\n for name in sys.argv[3:]:\n  z.write(folder/name,"manual-upload/"+name)\n',
    target, archive, ...Object.keys(files)], { encoding: 'utf8' });
  if (zipped.status !== 0) throw Error(zipped.stderr || 'ZIP packaging failed.');
  console.log(JSON.stringify({ folder: target, archive, archiveBytes: fs.statSync(archive).size, bundleBytes: Buffer.byteLength(code), files: Object.keys(files) }));
  return { code, html, guide, manifest, files, checksums, archive };
}

if (require.main === module) buildPackage();
module.exports = { buildPackage };
