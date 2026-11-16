/* Shared mode: one persistent backend catalog, no viewer Google login. */
(function () {
  'use strict';
  const config = window.ENTROPY_CONFIG;
  let currentCatalog = null, currentVersion = '', ready, connected = false;
  const auth = document.createElement('dialog'); auth.id = 'sharedAuth';
  const title = document.createElement('h2'); title.textContent = 'Research results';
  const description = document.createElement('p'); description.textContent = 'Enter the dashboard password shared by Felix.';
  const form = document.createElement('form');
  const label = document.createElement('label'); label.textContent = 'Dashboard password';
  const password = document.createElement('input'); password.type = 'password'; password.autocomplete = 'current-password'; password.required = true; password.name = 'password';
  label.append(password);
  const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'button primary'; submit.textContent = 'Open dashboard';
  const message = document.createElement('p'); message.setAttribute('role', 'status');
  form.append(label, submit); auth.append(title, description, form, message); document.body.append(auth);
  const signout = document.createElement('button'); signout.className = 'button subtle'; signout.textContent = 'Sign out';
  document.querySelector('.top-actions').append(signout);
  document.querySelector('.sidebar-bottom div').firstChild.textContent = 'Shared Drive catalog';
  const style = document.createElement('style'); style.textContent = '#sharedAuth{max-width:440px;padding:32px;border:1px solid #ddd;border-radius:16px}#sharedAuth p{margin:16px 0}#sharedAuth label{display:block}#sharedAuth input{display:block;width:100%;margin:10px 0 18px;padding:10px;border:1px solid #aaa;border-radius:6px}body.needs-auth>.workspace,body.needs-auth>.sidebar,body.needs-auth>#viewer,body.needs-auth>#compareTray{visibility:hidden}';
  document.head.append(style);
  function showAuth(text = '') {
    document.body.classList.add('needs-auth'); message.textContent = text;
    if (!auth.open) auth.showModal();
  }
  auth.addEventListener('cancel', event => event.preventDefault());
  async function api(action, args = {}) {
    const response = await fetch('/api/dashboard', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...args }) });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        showAuth(result.error); currentCatalog = null; currentVersion = '';
        if (connected) { connected = false; ready = new Promise(resolve => { authorize = resolve; }); }
      }
      throw Object.assign(Error(result.error || 'Could not load shared results.'), { status: response.status });
    }
    return result;
  }
  let authorize;
  ready = new Promise(resolve => { authorize = resolve; });
  form.addEventListener('submit', async event => {
    event.preventDefault(); submit.disabled = true; message.textContent = '';
    try {
      await api('login', { password: password.value }); password.value = '';
      connected = true; auth.close(); document.body.classList.remove('needs-auth'); authorize();
      document.getElementById('retry').click();
    } catch (error) { message.textContent = error.message; }
    finally { submit.disabled = false; }
  });
  signout.addEventListener('click', async () => {
    await api('logout'); currentCatalog = null; currentVersion = ''; location.reload();
  });
  async function getCatalog(attempt = 0) {
    const { manifest, status } = await api('getCatalog');
    if (!manifest) return { catalog: { schema: 1, rootId: config.rootId, complete: false, indexedAt: null, groups: [], records: [], runs: [], warnings: [] }, status };
    if (manifest.version !== currentVersion) {
      const catalog = { ...manifest, groups: [], records: [], runs: [], warnings: [] };
      const parts = new Array(manifest.parts); let position = 0;
      try {
        await Promise.all(Array.from({ length: 4 }, async () => {
          while (position < manifest.parts) {
            const page = position++; parts[page] = await api('catalogPage', { version: manifest.version, page });
          }
        }));
      } catch (error) { if (error.status === 409 && attempt < 2) return getCatalog(attempt + 1); throw error; }
      for (const part of parts) for (const key of ['groups', 'records', 'runs', 'warnings']) catalog[key].push(...(part[key] || []));
      currentCatalog = catalog; currentVersion = manifest.version;
    }
    return { catalog: currentCatalog, status };
  }
  window.entropyTransport = { shared: true, fileUrl: id => '/api/original?id=' + encodeURIComponent(id), async rpc(name, args = []) {
    await ready;
    if (name === 'getCatalog') return getCatalog();
    if (name === 'setup') name = 'startIndex';
    if (name === 'continueIndex') await new Promise(resolve => setTimeout(resolve, 1500));
    return api(name, ['getPreview', 'getFileDetail'].includes(name) ? { id: args[0], original: !!args[1] } : {});
  } };
  api('session').then(() => { connected = true; document.body.classList.remove('needs-auth'); authorize(); }).catch(error => showAuth(error.message));
}());
