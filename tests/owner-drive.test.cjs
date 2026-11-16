'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ownerDrive } = require('../lib/owner-drive.cjs');
const ROOT = 'root', FOLDER = 'application/vnd.google-apps.folder';
function fixture(size = 6000000) {
  const calls = [], authOptions = [];
  class Auth { constructor(options) { authOptions.push(options); } async getAccessToken() { return 'fixture-owner-token'; } }
  const env = { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'service_account', client_email: 'fixture@example.test', private_key: 'test-only-placeholder', token_uri: 'https://untrusted.invalid' }) };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options }); const u = new URL(url), id = u.pathname.split('/').pop();
    if (u.hostname === 'lh3.googleusercontent.com') return new Response('thumbnail-bytes', { headers: { 'content-type': 'image/png' } });
    if (u.searchParams.get('alt') === 'media') return new Response('full-original');
    if (id === ROOT) return Response.json({ id, mimeType: FOLDER, parents: [] });
    if (id === 'outside') return Response.json({ id, mimeType: 'image/png', parents: [] });
    return Response.json({ id, name: 'figure.png', mimeType: 'image/png', size: String(size), parents: [ROOT] });
  };
  return { drive: ownerDrive(ROOT, env, fetchImpl, Auth), calls, authOptions };
}
test('backend account requests only Drive read scope and never forwards a private key to file URLs', async () => {
  const h = fixture(); const result = await h.drive.call('getMetadata', { id: 'plot' });
  assert.equal(result.name, 'figure.png');
  assert.deepEqual(h.authOptions[0].scopes, ['https://www.googleapis.com/auth/drive.readonly']);
  assert.equal(h.authOptions[0].credentials.token_uri, 'https://oauth2.googleapis.com/token');
  assert(h.calls.every(c => c.options.headers.Authorization === 'Bearer fixture-owner-token'));
  assert(!JSON.stringify(h.calls).includes('test-only-placeholder'));
});
test('worker thumbnail reads never fetch original bytes and reject arbitrary credential destinations', async () => {
  const h = fixture();
  await h.drive.thumbnail({ thumbnailLink: 'https://attacker.example/steal' }); assert.equal(h.calls.length, 0);
  const preview = await h.drive.thumbnail({ thumbnailLink: 'https://lh3.googleusercontent.com/known-thumbnail' });
  assert.equal(preview.original, false); assert.match(preview.dataUrl, /^data:image\/png;base64,/);
  assert.equal(h.calls.length, 1); assert(!h.calls[0].url.includes('alt=media'));
});
test('on-demand original validates current folder ancestry and refuses oversized files before download', async () => {
  const h = fixture(); const result = await h.drive.open('plot'); assert.equal(await result.response.text(), 'full-original');
  const denied = fixture(); await assert.rejects(denied.drive.open('outside'), /outside/);
  assert(!denied.calls.some(c => c.url.includes('alt=media')));
  const large = fixture(60 * 1024 * 1024); await assert.rejects(large.drive.open('plot'), /50 MB/);
  assert(!large.calls.some(c => c.url.includes('alt=media')));
});
