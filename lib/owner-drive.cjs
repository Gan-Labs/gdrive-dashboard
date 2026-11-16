'use strict';
const { createHandler, bounded } = require('./drive-api.cjs');
function ownerDrive(rootId, env = process.env, fetchImpl = global.fetch, GoogleAuthClass) {
  let auth;
  async function token() {
    if (!auth) {
      let credentials;
      try { credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}'); }
      catch (_) { throw Object.assign(Error('GOOGLE_SERVICE_ACCOUNT_JSON is invalid.'), { status: 503 }); }
      if (credentials.type !== 'service_account' || !credentials.client_email || !credentials.private_key)
        throw Object.assign(Error('Configure the backend Google service account.'), { status: 503 });
      const GoogleAuth = GoogleAuthClass || require('google-auth-library').GoogleAuth;
      auth = new GoogleAuth({ credentials: { type: 'service_account', client_email: credentials.client_email,
        private_key: credentials.private_key, private_key_id: credentials.private_key_id, project_id: credentials.project_id,
        token_uri: 'https://oauth2.googleapis.com/token' }, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
    }
    let value;
    try { value = await auth.getAccessToken(); }
    catch (_) { throw Object.assign(Error('Backend Google authorization failed. Check the service-account key and Drive API setup.'), { status: 503 }); }
    if (!value) throw Object.assign(Error('Backend Google authorization failed.'), { status: 503 });
    return value;
  }
  const handler = createHandler({ rootId, fetchImpl, withThumbnails: true });
  async function call(action, args = {}) {
    let result, status;
    await handler({ method: 'POST', headers: { authorization: 'Bearer ' + await token() }, body: { action, ...args } }, {
      setHeader() {}, set statusCode(code) { status = code; }, end(json) { result = JSON.parse(json); }
    });
    if (status >= 400) throw Object.assign(Error(result.error), { status, code: result.code });
    return result;
  }
  async function thumbnail(item) {
    if (!item.thumbnailLink) return { dataUrl: '', original: false, note: 'Thumbnail unavailable. Open the figure to load a larger preview.' };
    const url = new URL(item.thumbnailLink);
    if (url.protocol !== 'https:' || !/(^|\.)(googleusercontent\.com|googleapis\.com)$/.test(url.hostname))
      return { dataUrl: '', original: false, note: 'Thumbnail unavailable.' };
    const response = await fetchImpl(url.href, { headers: { Authorization: 'Bearer ' + await token() }, redirect: 'error', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw Object.assign(Error('Could not cache the Drive thumbnail.'), { status: 502 });
    const mime = response.headers.get('content-type')?.split(';')[0];
    if (!/^image\/(png|jpeg|webp|gif|bmp)$/i.test(mime)) return { dataUrl: '', original: false, note: 'Thumbnail unavailable.' };
    const bytes = await bounded(response, 1000000);
    return { dataUrl: 'data:' + mime + ';base64,' + bytes.toString('base64'), original: false, note: '' };
  }
  async function open(id) {
    const file = await call('getMetadata', { id });
    if (file.mimeType.startsWith('application/vnd.google-apps.'))
      throw Object.assign(Error('Google-native documents must be opened in Drive.'), { status: 415 });
    if (Number(file.size) > 50 * 1024 * 1024)
      throw Object.assign(Error('This file exceeds the 50 MB dashboard download limit. Ask the owner for direct Drive access.'), { status: 413 });
    const response = await fetchImpl('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media&supportsAllDrives=true', {
      headers: { Authorization: 'Bearer ' + await token() }, redirect: 'error', signal: AbortSignal.timeout(45000)
    });
    if (!response.ok) throw Object.assign(Error('The backend could not read this original from Drive.'), { status: 502 });
    return { file, response };
  }
  return { call, thumbnail, open };
}
module.exports = { ownerDrive };
