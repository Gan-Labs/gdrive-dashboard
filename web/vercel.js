/* Google tokens stay in memory. Catalog data lives only in this browser. */
(function () {
  'use strict';
  const config = window.ENTROPY_CONFIG;
  let accessToken = '', expiresAt = 0, account = null, indexer = null, pendingAuth = [], identityClient;
  let refreshing = false, generation = 0, refreshTimer;
  const auth = document.createElement('dialog'); auth.id = 'googleAuth';
  const title = document.createElement('h2'); title.textContent = 'Open your research results';
  const note = document.createElement('p'); note.textContent = 'Connect the Google account that can access your Figures folder.';
  const message = document.createElement('p'); message.setAttribute('role', 'status');
  const connect = document.createElement('button'); connect.className = 'button primary'; connect.textContent = 'Connect Google Drive'; connect.disabled = true;
  auth.append(title, note, message, connect); document.body.append(auth);
  const accountButton = document.createElement('button'); accountButton.className = 'button subtle'; accountButton.textContent = 'Disconnect'; accountButton.hidden = true;
  document.querySelector('.top-actions').append(accountButton);
  const style = document.createElement('style');
  style.textContent = '#googleAuth{max-width:480px;padding:32px;border:1px solid #ddd;border-radius:16px}#googleAuth p{margin:16px 0}body.needs-auth>.workspace,body.needs-auth>.sidebar,body.needs-auth>#viewer,body.needs-auth>#compareTray{visibility:hidden}';
  document.head.append(style);
  function showAuth(text) {
    document.body.classList.add('needs-auth');
    if (text) message.textContent = text;
    if (!auth.open) auth.showModal();
  }
  auth.addEventListener('cancel', e => e.preventDefault());

  const db = new Promise((resolve, reject) => {
    const request = indexedDB.open('entropy-vercel-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('catalogs');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Browser storage is unavailable. Enable site storage to resume indexing.'));
  });
  // Attach a handler immediately: private-browsing storage failures are surfaced on use.
  db.catch(() => {});
  async function storage(key, operation, value) {
    const database = await db;
    return new Promise((resolve, reject) => {
      const tx = database.transaction('catalogs', operation === 'get' ? 'readonly' : 'readwrite');
      const objectStore = tx.objectStore('catalogs');
      const request = operation === 'get' ? objectStore.get(key) : operation === 'delete' ? objectStore.delete(key) : objectStore.put(value, key);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(new Error('Could not save the browser catalog. Check available storage.'));
    });
  }
  function tokenValid() { return accessToken && Date.now() < expiresAt - 30000; }
  async function api(action, args = {}) {
    if (!tokenValid()) { accessToken = ''; showAuth('Reconnect Google Drive to continue. Your scan progress is saved.'); throw Error('Google authorization expired. Connect again to continue.'); }
    const response = await fetch('/api/dashboard', { method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken },
      body: JSON.stringify({ action, ...args }) });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) { accessToken = ''; showAuth(result.error); }
      throw Object.assign(Error(result.error || 'Could not reach Google Drive.'), { code: result.code });
    }
    return result;
  }
  function authorized() {
    if (tokenValid() && indexer) return Promise.resolve();
    showAuth();
    return new Promise((resolve, reject) => pendingAuth.push({ resolve, reject }));
  }
  function keyFor(user) { return config.rootId + ':' + user.permissionId; }
  async function onToken(response) {
    try {
      if (response.error) throw Error(response.error_description || 'Google did not authorize this request.');
      if (!google.accounts.oauth2.hasGrantedAllScopes(response, 'https://www.googleapis.com/auth/drive.readonly'))
        throw Error('Read access to Google Drive is required to browse your results.');
      accessToken = response.access_token; expiresAt = Date.now() + Number(response.expires_in) * 1000;
      const session = await api('session');
      if (session.rootId !== config.rootId || !session.user?.permissionId) throw Error('Drive connection configuration is inconsistent.');
      // Reconnecting a scan to a different account must not publish the old account's results.
      if (account && account.permissionId !== session.user.permissionId) { location.reload(); return; }
      account = session.user;
      const key = keyFor(account);
      indexer = window.EntropyIndexer.createIndexer({ rootId: config.rootId, api, core: window.EntropyCore,
        store: { get: () => storage(key, 'get'), set: value => storage(key, 'put', value) } });
      message.textContent = ''; auth.close(); document.body.classList.remove('needs-auth');
      accountButton.hidden = false; accountButton.title = 'Disconnect ' + (account.emailAddress || 'Google Drive');
      for (const pending of pendingAuth.splice(0)) pending.resolve();
      // Reconnect after an expired request reloads the saved catalog/status for Resume.
      document.getElementById('retry').click();
    } catch (error) {
      accessToken = ''; showAuth(error.message);
    }
  }
  connect.addEventListener('click', () => {
    message.textContent = '';
    identityClient.requestAccessToken({ prompt: 'select_account' });
  });
  accountButton.addEventListener('click', async () => {
    if (refreshing) { message.textContent = 'Wait for the current refresh to finish before disconnecting.'; showAuth(message.textContent); return; }
    generation++; clearInterval(refreshTimer); accessToken = ''; expiresAt = 0;
    const previous = account; account = null; indexer = null;
    if (previous) await storage(keyFor(previous), 'delete').catch(() => {});
    location.reload();
  });
  async function locked(fn) {
    if (!navigator.locks) throw Error('Use a current browser with Web Locks support for resumable indexing.');
    return navigator.locks.request('entropy-index:' + keyFor(account), fn);
  }
  async function rpc(name, args = []) {
    await authorized();
    if (['getPreview', 'getFileDetail'].includes(name)) return api(name, { id: args[0], original: !!args[1] });
    if (name === 'getCatalog') {
      const result = await indexer.getCatalog(); result.status.scheduled = !!refreshTimer; return result;
    }
    if (name === 'setup') {
      if (!refreshTimer) refreshTimer = setInterval(async () => {
        if (refreshing || !tokenValid() || document.hidden) return;
        const saved = await indexer.getCatalog();
        if (!saved.status.active && saved.catalog.indexedAt && Date.now() - Date.parse(saved.catalog.indexedAt) < 6 * 3600000) return;
        document.getElementById('refresh').click();
      }, 60000);
      name = 'startIndex';
    }
    if (!['startIndex', 'continueIndex'].includes(name)) throw Error('Unknown dashboard action.');
    const version = generation;
    return locked(async () => {
      if (version !== generation) throw Error('Drive account changed; reconnect to continue.');
      refreshing = true;
      try { const result = await indexer[name](); result.scheduled = !!refreshTimer; return result; }
      finally { refreshing = false; }
    });
  }
  window.entropyTransport = { rpc };
  showAuth();
  if (!config.clientId) message.textContent = 'Deployment setup needed: set GOOGLE_CLIENT_ID in Vercel and redeploy. See README.';
  else {
    const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    script.onload = () => {
      identityClient = google.accounts.oauth2.initTokenClient({ client_id: config.clientId,
        scope: 'https://www.googleapis.com/auth/drive.readonly', callback: onToken,
        error_callback: () => { message.textContent = 'Google sign-in closed or was blocked. Try connecting again.'; } });
      connect.disabled = false;
    };
    script.onerror = () => { message.textContent = 'Google sign-in could not load. Check your connection and reload.'; };
    document.head.append(script);
  }
}());
