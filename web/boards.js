/* Saved research boards: shared definitions, optimistic revisions, source-linked tiles. */
(function () {
  'use strict';
  if (!window.entropyTransport?.shared || !window.EntropyExplorer) return;
  const explorer = window.EntropyExplorer, api = window.entropyTransport.boardApi;
  const state = { view: 'list', draft: null, dirty: false, zoom: 1, saving: false, dragging: false, boards: [], pending: [] };
  const node = (tag, className, text) => { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; };
  function button(text, fn, className = 'button') { const b = node('button', className, text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  const workspace = node('section'); workspace.id = 'boardWorkspace'; workspace.hidden = true; document.getElementById('main').append(workspace);
  const nav = button('Research boards', () => showList(), 'nav-item'); nav.id = 'boardsNav'; document.getElementById('savedResults').after(nav);
  let observer, viewport, world, stage, statusLabel, saveButton, conflictBox;
  function message(text, error = false) { if (statusLabel) { statusLabel.textContent = text; statusLabel.dataset.error = String(error); } }
  function markDirty() { state.dirty = true; message('Unsaved changes · click Save board to share this layout'); if (saveButton) saveButton.disabled = false; }
  function mode(open) {
    document.body.classList.toggle('boards-open', open); workspace.hidden = !open; nav.classList.toggle('active', open);
    document.body.classList.remove('sidebar-open'); document.getElementById('browseToggle').setAttribute('aria-expanded', 'false');
  }
  function boardUrl(id) { const url = new URL(location.href); url.searchParams.set('board', id); return url; }
  function browse() { mode(false); const url = new URL(location.href); url.searchParams.delete('board'); history.replaceState({}, '', url); }
  document.querySelector('.sidebar').addEventListener('click', event => {
    const item = event.target.closest('.nav-item'); if (item && item !== nav) browse();
  }, true);
  window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
  async function showList() {
    state.view = 'list'; mode(true); if (observer) observer.disconnect(); workspace.replaceChildren();
    const url = new URL(location.href); url.searchParams.delete('board'); history.replaceState({}, '', url);
    const heading = node('div', 'board-heading'), intro = node('div');
    intro.append(node('p', 'eyebrow', 'SHARED RESEARCH SPACE'), node('h1', '', 'Research boards'),
      node('p', '', 'Arrange figures, tables and notes. Saved boards are shared with everyone using this dashboard.'));
    heading.append(intro, button('New board', newBoard, 'button primary')); workspace.append(heading);
    const list = node('div', 'board-list'); list.append(node('p', 'muted', 'Loading saved boards…')); workspace.append(list);
    try {
      state.boards = (await api('listBoards')).boards; list.replaceChildren();
      if (!state.boards.length) list.append(node('p', 'muted', 'No saved boards yet. Create a board or pin a result from the explorer.'));
      for (const board of state.boards) {
        const entry = button('', () => openBoard(board.id), 'board-summary');
        entry.append(node('small', '', board.items + ' tiles · shared'), node('h2', '', board.title), node('p', '', board.description.slice(0, 180)),
          node('small', '', 'Saved ' + new Date(board.updatedAt).toLocaleString())); list.append(entry);
      }
      if (state.draft && state.dirty) list.prepend(button('Continue unsaved draft: ' + state.draft.title, showEditor, 'board-summary'));
    } catch (error) { list.replaceChildren(node('p', 'board-list-error', error.message), button('Retry', showList)); }
  }
  function canReplace() { return !state.dirty || confirm('Discard the unsaved changes in the current board?'); }
  function newBoard() {
    if (!canReplace()) return;
    state.draft = { title: 'Untitled board', description: '', items: [], revision: 0 }; state.dirty = true; state.zoom = 1;
    showEditor(); const input = workspace.querySelector('.board-title'); input.focus(); input.select();
  }
  async function openBoard(id) {
    if (state.draft?.id === id && state.dirty) { showEditor(); return; }
    if (!canReplace()) return;
    try { state.draft = (await api('getBoard', { id })).board; state.dirty = false; state.zoom = 1; showEditor(); }
    catch (error) { explorer.toast(error.message); }
  }
  async function save(copy = false) {
    if (state.saving || !state.draft) return;
    state.saving = true; workspace.inert = true; nav.disabled = true; saveButton.disabled = true; message('Saving shared board…');
    const draft = structuredClone(state.draft), copyFrom = copy ? draft.id : undefined;
    if (copy) { delete draft.id; draft.title = draft.title.slice(0, 112) + ' (copy)'; }
    try {
      const result = await api('saveBoard', { board: draft, revision: copy ? 0 : state.draft.revision, copyFrom });
      state.draft = result.board; state.dirty = false; showEditor(); explorer.toast('Board saved for everyone.');
    } catch (error) {
      message(error.message, true); saveButton.disabled = false;
      if (error.status === 409) {
        conflictBox.hidden = false; conflictBox.replaceChildren(node('p', '', 'Your draft is intact. Another editor has saved a newer version.'),
          button('Save draft as a copy', () => save(true)), button('Reload saved board', async () => {
            if (!confirm('Discard your draft and load the latest saved board?')) return;
            state.dirty = false; await openBoard(state.draft.id);
          }));
      }
    } finally { state.saving = false; workspace.inert = false; nav.disabled = false; if (saveButton) saveButton.disabled = !state.dirty; }
  }
  function showEditor() {
    if (!state.draft) return showList();
    state.view = 'editor'; mode(true); if (observer) observer.disconnect(); workspace.replaceChildren();
    const heading = node('div', 'board-heading'), intro = node('div');
    intro.append(node('p', 'eyebrow', 'SHARED BOARD'));
    const title = node('input', 'board-title'); title.value = state.draft.title; title.maxLength = 120; title.setAttribute('aria-label', 'Board title');
    title.addEventListener('input', () => { state.draft.title = title.value; markDirty(); }); intro.append(title);
    const actions = node('div', 'board-actions'); saveButton = button('Save board', () => save(), 'button primary'); saveButton.disabled = !state.dirty;
    actions.append(button('All boards', showList), button('Browse & pin results', browse), saveButton,
      button('Copy board link', async () => {
        if (!state.draft.id || state.dirty) { explorer.toast('Save the board first, then copy its link.'); return; }
        try { await navigator.clipboard.writeText(boardUrl(state.draft.id).href); explorer.toast('Board link copied. Viewers need the dashboard password.'); }
        catch (_) { prompt('Copy this board link:', boardUrl(state.draft.id).href); }
      }));
    heading.append(intro, actions); workspace.append(heading);
    const description = node('textarea', 'board-description'); description.value = state.draft.description; description.maxLength = 4000;
    description.placeholder = 'What does this board show?'; description.setAttribute('aria-label', 'Board description');
    description.addEventListener('input', () => { state.draft.description = description.value; markDirty(); }); workspace.append(description);
    statusLabel = node('p', 'board-status'); statusLabel.setAttribute('role', 'status'); workspace.append(statusLabel);
    message(state.dirty ? 'Unsaved changes · click Save board to share this layout' : 'Saved for everyone · revision ' + state.draft.revision);
    conflictBox = node('div', 'board-conflict'); conflictBox.hidden = true; workspace.append(conflictBox);
    const toolbar = node('div', 'board-toolbar'), tools = node('div', 'board-actions'), zoomTools = node('div', 'board-actions');
    const zoomLabel = node('span', 'muted'); zoomLabel.id = 'boardZoom';
    tools.append(button('Add note', () => addNote()), node('span', 'board-helper', 'Drag tile headers · resize corners · arrow keys move; Shift + arrows resize'));
    zoomTools.append(button('−', () => setZoom(state.zoom - .1)), zoomLabel, button('+', () => setZoom(state.zoom + .1)), button('Fit content', fit));
    toolbar.append(tools, zoomTools); workspace.append(toolbar);
    viewport = node('div', 'board-viewport'); viewport.setAttribute('aria-label', 'Research board canvas'); viewport.tabIndex = 0;
    world = node('div', 'board-world'); stage = node('div', 'board-stage'); world.append(stage); viewport.append(world); workspace.append(viewport);
    stage.addEventListener('pointerdown', event => {
      if (event.target !== stage || event.button !== 0) return;
      event.preventDefault(); stage.setPointerCapture(event.pointerId); stage.classList.add('panning');
      const x = event.clientX, y = event.clientY, left = viewport.scrollLeft, top = viewport.scrollTop;
      const move = e => { viewport.scrollLeft = left - (e.clientX - x); viewport.scrollTop = top - (e.clientY - y); };
      const end = () => { stage.classList.remove('panning'); stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', end); stage.removeEventListener('pointercancel', end); };
      stage.addEventListener('pointermove', move); stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
    });
    renderCanvas();
    const url = new URL(location.href); url.searchParams.delete('board');
    history.replaceState({}, '', state.draft.id ? boardUrl(state.draft.id) : url);
  }
  function sizeCanvas() {
    if (!stage) return;
    const width = Math.max(1800, ...state.draft.items.map(t => t.x + t.width + 60)), height = Math.max(1200, ...state.draft.items.map(t => t.y + t.height + 60));
    stage.style.width = width + 'px'; stage.style.height = height + 'px'; stage.style.transform = 'scale(' + state.zoom + ')';
    world.style.width = Math.ceil(width * state.zoom) + 'px'; world.style.height = Math.ceil(height * state.zoom) + 'px';
    workspace.querySelector('#boardZoom').textContent = Math.round(state.zoom * 100) + '%';
  }
  function setZoom(value) {
    const x = (viewport.scrollLeft + viewport.clientWidth / 2) / state.zoom, y = (viewport.scrollTop + viewport.clientHeight / 2) / state.zoom;
    state.zoom = Math.max(.25, Math.min(1.5, Math.round(value * 100) / 100)); sizeCanvas();
    viewport.scrollLeft = Math.max(0, x * state.zoom - viewport.clientWidth / 2); viewport.scrollTop = Math.max(0, y * state.zoom - viewport.clientHeight / 2);
  }
  function fit() {
    const items = state.draft.items; if (!items.length) return;
    const minX = Math.min(...items.map(t => t.x)), minY = Math.min(...items.map(t => t.y));
    const width = Math.max(...items.map(t => t.x + t.width)) - minX + 80, height = Math.max(...items.map(t => t.y + t.height)) - minY + 80;
    setZoom(Math.min(viewport.clientWidth / width, viewport.clientHeight / height, 1));
    viewport.scrollLeft = Math.max(0, (minX - 40) * state.zoom); viewport.scrollTop = Math.max(0, (minY - 40) * state.zoom);
  }
  const snap = value => Math.round(value / 20) * 20;
  function place(tile, element) {
    Object.assign(element.style, { left: tile.x + 'px', top: tile.y + 'px', width: tile.width + 'px', height: tile.height + 'px' });
  }
  function manipulate(handle, tile, card, resize) {
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); handle.setPointerCapture(event.pointerId); state.dragging = true; card.classList.add('moving');
      const start = { ...tile, pointerX: event.clientX, pointerY: event.clientY };
      const move = e => {
        const dx = (e.clientX - start.pointerX) / state.zoom, dy = (e.clientY - start.pointerY) / state.zoom;
        if (resize) { tile.width = Math.max(240, Math.min(2400, 20000 - tile.x, snap(start.width + dx))); tile.height = Math.max(180, Math.min(2000, 20000 - tile.y, snap(start.height + dy))); }
        else { tile.x = Math.max(0, Math.min(19600, 20000 - tile.width, snap(start.xPosition + dx))); tile.y = Math.max(0, Math.min(19600, 20000 - tile.height, snap(start.yPosition + dy))); }
        place(tile, card); sizeCanvas(); markDirty();
      };
      start.xPosition = tile.x; start.yPosition = tile.y;
      const end = () => { state.dragging = false; card.classList.remove('moving'); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
    });
    handle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); const dx = event.key === 'ArrowRight' ? 20 : event.key === 'ArrowLeft' ? -20 : 0, dy = event.key === 'ArrowDown' ? 20 : event.key === 'ArrowUp' ? -20 : 0;
      if (resize || event.shiftKey) { tile.width = Math.max(240, Math.min(2400, 20000 - tile.x, tile.width + dx)); tile.height = Math.max(180, Math.min(2000, 20000 - tile.y, tile.height + dy)); }
      else { tile.x = Math.max(0, Math.min(19600, 20000 - tile.width, tile.x + dx)); tile.y = Math.max(0, Math.min(19600, 20000 - tile.height, tile.y + dy)); }
      place(tile, card); sizeCanvas(); markDirty();
    });
  }
  function renderCanvas() {
    if (observer) observer.disconnect(); stage.replaceChildren();
    observer = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) {
      observer.unobserve(entry.target); loadTile(entry.target, state.draft.items.find(t => t.id === entry.target.dataset.tileId));
    } }, { root: viewport, rootMargin: '250px' });
    if (!state.draft.items.length) {
      const empty = node('div', 'board-empty'); empty.append(node('h2', '', 'Start pinning your results'), node('p', '', 'Browse the explorer and use Pin to board on figures, source tables or experiment metrics. Add notes, arrange tiles, then save to share the board.'), button('Browse results', browse)); stage.append(empty);
    }
    for (const tile of state.draft.items) {
      const card = node('article', 'board-tile' + (tile.kind === 'note' ? ' note' : '')); card.dataset.tileId = tile.id; place(tile, card);
      const header = node('div', 'board-tile-header'); const name = tile.kind === 'note' ? 'Research note' : tile.source?.name || 'Result';
      const handle = button('⠿  ' + name, () => {}, 'board-handle'); handle.title = 'Drag to move; arrow keys move; Shift + arrows resize'; handle.setAttribute('aria-label', 'Move ' + name);
      const remove = button('×', () => { state.draft.items = state.draft.items.filter(t => t.id !== tile.id); markDirty(); renderCanvas(); }, 'tile-remove'); remove.setAttribute('aria-label', 'Remove ' + name + ' from board');
      header.append(handle, remove); const content = node('div', 'board-content'); content.dataset.tileId = tile.id;
      const caption = node('div', 'board-caption', tile.kind === 'note' ? 'Shared note' : tile.source?.path || name); caption.title = tile.source?.path || name;
      const resize = button('', () => {}, 'board-resize'); resize.setAttribute('aria-label', 'Resize ' + name);
      card.append(header, content, caption, resize); stage.append(card); manipulate(handle, tile, card, false); manipulate(resize, tile, card, true);
      if (tile.kind === 'note') {
        const input = node('textarea', 'board-note'); input.value = tile.text; input.maxLength = 8000; input.placeholder = 'Add an observation, hypothesis or takeaway…'; input.setAttribute('aria-label', 'Research note');
        input.addEventListener('input', () => { tile.text = input.value; markDirty(); }); content.append(input);
      } else { content.append(node('p', 'muted', 'Loading saved result…')); observer.observe(content); }
    }
    sizeCanvas();
  }
  function table(rows) {
    const t = node('table'); rows.forEach((row, i) => { const tr = node('tr'); row.forEach(value => tr.append(node(i ? 'td' : 'th', '', String(value ?? '')))); t.append(tr); }); return t;
  }
  async function loadTile(content, tile) {
    if (!tile) return;
    try {
      const catalog = explorer.getCatalog();
      if (tile.kind === 'run') {
        const run = catalog?.runs.find(r => r.id === tile.runId); content.replaceChildren();
        if (!run) { content.append(node('p', 'muted', 'This experiment is unavailable in the current index.')); return; }
        content.append(table([['Metric', 'Value', 'Split / evaluation', 'Block'], ...run.metrics.map(m => [m.label, /accuracy|f1/i.test(m.label) ? (m.value * 100).toFixed(2) + '%' : String(m.value), m.split, m.block || '—'])]));
        if (!run.metrics.length) content.append(node('p', 'muted', 'No recognized metrics were reported.'));
        return;
      }
      const record = catalog?.records.find(r => r.id === tile.fileId);
      if (catalog && !record) { content.replaceChildren(node('p', 'muted', 'Source unavailable in the current index. This tile and its position have been preserved.')); return; }
      const kind = record?.fileKind || window.EntropyCore.fileKind_(tile.source?.name || '', tile.source?.mimeType || '');
      if (['image', 'pdf'].includes(kind)) {
        const preview = await explorer.rpc('getPreview', tile.fileId, false); if (!content.isConnected) return; content.replaceChildren();
        if (preview.dataUrl && /^data:image\/(png|jpeg|gif|webp|bmp);base64,/i.test(preview.dataUrl)) {
          const image = node('img'); image.src = preview.dataUrl; image.alt = tile.source?.name || 'Pinned figure'; content.append(image);
        } else content.append(node('p', 'muted', preview.note || 'Thumbnail unavailable.'));
        if (record) content.append(button('Expand', () => explorer.openFile(record), 'board-expand'));
      } else {
        const detail = await explorer.rpc('getFileDetail', tile.fileId); if (!content.isConnected) return; content.replaceChildren();
        if (detail.table) { content.append(table(detail.table.rows)); if (detail.table.truncated) content.append(node('p', 'muted', 'Preview: first 100 rows and up to 30 columns.')); }
        else if (detail.text) content.append(node('pre', '', detail.text));
        else content.append(node('p', 'muted', detail.note || 'Open this source from the explorer.'));
      }
    } catch (error) { if (content.isConnected) content.replaceChildren(node('p', 'muted', error.message)); }
  }
  function nextPosition(items) {
    for (let y = 40; y < 19400; y += 420) for (let x = 40; x < 1700; x += 540) {
      if (!items.some(t => x < t.x + t.width + 20 && x + 500 > t.x && y < t.y + t.height + 20 && y + 380 > t.y)) return { x, y };
    }
    return { x: 40, y: 40 };
  }
  function makeTile(kind, ref, items) { return { id: crypto.randomUUID(), kind, ...nextPosition(items), width: 500, height: 360, ...ref }; }
  function addNote() {
    if (state.draft.items.length >= 100) { explorer.toast('A board supports up to 100 tiles.'); return; }
    state.draft.items.push(makeTile('note', { text: '' }, state.draft.items)); markDirty(); renderCanvas();
  }
  const picker = node('dialog', 'board-modal'); picker.id = 'pinBoardDialog';
  const pickerTitle = node('h2', '', 'Pin to a shared board'), pickerForm = node('form');
  const chooseLabel = node('label', '', 'Choose board'), choose = node('select'); choose.name = 'board'; chooseLabel.append(choose);
  const nameLabel = node('label', '', 'New board name'), name = node('input'); name.maxLength = 120; name.value = 'Research board'; nameLabel.append(name);
  const pickerError = node('p', 'board-status'); pickerError.setAttribute('role', 'status');
  const pinSubmit = node('button', 'button primary', 'Pin and save'); pinSubmit.type = 'submit';
  pickerForm.append(chooseLabel, nameLabel, pickerError, pinSubmit, button('Cancel', () => picker.close())); picker.append(pickerTitle, pickerForm); document.body.append(picker);
  choose.addEventListener('change', () => { nameLabel.hidden = choose.value !== '__new__'; });
  async function pin(items) {
    try {
      state.pending = items; state.boards = (await api('listBoards')).boards; choose.replaceChildren();
      for (const b of state.boards) { const option = node('option', '', b.title); option.value = b.id; choose.append(option); }
      if (state.draft && !state.draft.id) { const option = node('option', '', state.draft.title + ' (draft)'); option.value = '__draft__'; choose.append(option); }
      const create = node('option', '', 'Create a new board…'); create.value = '__new__'; choose.append(create);
      choose.value = state.draft?.id || (state.draft ? '__draft__' : state.boards[0]?.id || '__new__');
      nameLabel.hidden = choose.value !== '__new__'; pickerError.textContent = '';
      pickerTitle.textContent = items.length === 1 ? 'Pin result to a shared board' : 'Pin ' + items.length + ' results'; picker.showModal();
    } catch (error) { explorer.toast(error.message); }
  }
  pickerForm.addEventListener('submit', async event => {
    event.preventDefault(); pinSubmit.disabled = true; pickerError.textContent = '';
    try {
      const target = choose.value === '__new__' ? { title: name.value.trim(), description: '', revision: 0, items: [] } :
        choose.value === '__draft__' || choose.value === state.draft?.id ? state.draft : (await api('getBoard', { id: choose.value })).board;
      const draft = structuredClone(target);
      for (const item of state.pending) draft.items.push(makeTile(item.kind, item.kind === 'file' ? { fileId: item.id } : { runId: item.id }, draft.items));
      const result = (await api('saveBoard', { board: draft, revision: target.revision })).board;
      picker.close(); document.getElementById('viewer').close();
      if (!state.dirty || !state.draft || target === state.draft) { state.draft = result; state.dirty = false; showEditor(); }
      explorer.toast('Pinned and saved to ' + result.title + '.');
    } catch (error) { pickerError.textContent = error.message; }
    finally { pinSubmit.disabled = false; }
  });
  window.EntropyBoards = { fileButton: record => button('Pin to board', () => pin([{ kind: 'file', id: record.id }]), 'button subtle board-pin'),
    runButton: run => button('Pin metrics to board', () => pin([{ kind: 'run', id: run.id }]), 'button subtle') };
  const bulk = button('Pin selection to board', () => pin(explorer.selected().map(r => ({ kind: 'file', id: r.id }))), 'button');
  document.getElementById('compareTray').append(bulk);
  let lastCatalog = explorer.getCatalog();
  document.addEventListener('entropy:catalog', () => {
    const catalog = explorer.getCatalog(); if (catalog === lastCatalog) return; lastCatalog = catalog;
    if (document.body.classList.contains('boards-open') && state.view === 'editor' && state.draft) {
      // Refresh linked results without replacing note inputs or disturbing an in-progress layout edit.
      for (const content of stage.querySelectorAll('.board-content')) {
        const tile = state.draft.items.find(t => t.id === content.dataset.tileId);
        if (tile && tile.kind !== 'note') observer.observe(content);
      }
    }
  });
  explorer.refresh();
  const initial = new URL(location.href).searchParams.get('board'); if (initial) openBoard(initial);
}());
