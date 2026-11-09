/* global parseRecipients, todayKey, listToLines */
const $ = (id) => document.getElementById(id);
const FIELDS = ['list', 'message', 'cc', 'minDelay', 'maxDelay', 'dailyCap'];

function showError(msg) {
  $('error').textContent = msg || '';
  $('error').hidden = !msg;
}

function settings() {
  const minDelay = Math.max(3, Number($('minDelay').value) || 8);
  const maxDelay = Math.max(minDelay, Number($('maxDelay').value) || minDelay);
  const dailyCap = Math.max(1, Number($('dailyCap').value) || 150);
  return { minDelay, maxDelay, dailyCap, fastMode: $('fastMode').checked };
}

async function saveDraft() {
  const draft = Object.fromEntries(FIELDS.map((f) => [f, $(f).value]));
  draft.fastMode = $('fastMode').checked;
  draft.selectedList = $('listSelect').value;
  await chrome.storage.local.set({ draft });
}

let lists = {};

function renderListSelect(selectedName) {
  const names = Object.keys(lists).sort((a, b) => a.localeCompare(b));
  $('listSelect').replaceChildren(
    new Option(names.length ? 'Typed / pasted numbers below' : 'Typed / pasted numbers below (no saved lists yet)', ''),
    ...names.map((n) => new Option(`${n} (${lists[n].length})`, n)),
  );
  $('listSelect').value = selectedName && lists[selectedName] ? selectedName : '';
}

function applyList(name) {
  if (!name || !lists[name]) return;
  $('list').value = listToLines(lists[name]);
  updateParseInfo();
}

function updateParseInfo() {
  const { items, bad, dupes } = parseRecipients($('list').value, $('cc').value);
  const parts = [`${items.length} valid`];
  if (dupes) parts.push(`${dupes} duplicate${dupes > 1 ? 's' : ''} skipped`);
  if (bad.length) parts.push(`${bad.length} unreadable: ${bad.slice(0, 3).join(' | ')}${bad.length > 3 ? ' …' : ''}`);
  $('parseInfo').textContent = $('list').value.trim() ? parts.join(' · ') : '';
}

function render(job) {
  const active = job && job.index < job.items.length;
  $('status').hidden = !job;
  $('start').textContent = active && job.index > 0 ? 'Resume' : 'Start';
  $('start').disabled = !!job?.running;
  $('pause').disabled = !job?.running;
  for (const f of ['list', 'message', 'cc', 'listSelect']) $(f).disabled = !!active;
  if (!job) return;

  const sentItems = job.items.filter((i) => i.status === 'sent');
  const fast = sentItems.filter((i) => i.via === 'fast').length;
  const failed = job.items.filter((i) => i.status === 'failed');
  const pending = job.items.length - job.index;
  $('barFill').style.width = `${(job.index / job.items.length) * 100}%`;
  const today = job.daily?.date === todayKey() ? job.daily.count : 0;
  $('counts').textContent = `${job.listName ? `List "${job.listName}" · ` : ''}Sent ${sentItems.length} (${fast} fast, ${sentItems.length - fast} via reload) · Failed ${failed.length} · Left ${pending} · Today ${today}/${job.dailyCap}`;
  const status = job.running ? 'Running in the WhatsApp Web tab. You can close this popup.' : (job.note || 'Paused');
  $('note').textContent = job.fastNote ? `${status} ${job.fastNote}` : status;
  if (!job.running) $('fastMode').checked = job.fastMode !== false;

  $('failedBox').hidden = !failed.length;
  $('failedCount').textContent = failed.length;
  $('failedList').replaceChildren(...failed.map((i) => {
    const li = document.createElement('li');
    li.textContent = `+${i.phone}${i.name ? ` (${i.name})` : ''} — ${i.error}`;
    return li;
  }));
}

async function focusWhatsApp() {
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
  }
}

async function start() {
  showError('');
  let { job } = await chrome.storage.local.get('job');
  const s = settings();

  if (!job || job.index >= job.items.length) {
    const { items } = parseRecipients($('list').value, $('cc').value);
    const message = $('message').value.trim();
    if (!items.length) return showError('Add at least one valid number.');
    if (!message) return showError('Write a message first.');
    job = { items, index: 0, message, daily: { date: todayKey(), count: 0 }, nextAt: 0, listName: $('listSelect').value };
  }
  Object.assign(job, s);
  if (s.fastMode) { job.fastMisses = 0; job.fastNote = ''; }
  if (job.daily.date !== todayKey()) job.daily = { date: todayKey(), count: 0 };
  if (job.daily.count >= job.dailyCap) {
    return showError(`Daily cap (${job.dailyCap}) already reached today. Raise it or resume tomorrow.`);
  }
  job.running = true;
  job.awaiting = false;
  job.note = '';
  job.nextAt = 0;
  await chrome.storage.local.set({ job });
  await focusWhatsApp();
}

async function pause() {
  const { job } = await chrome.storage.local.get('job');
  if (!job) return;
  job.running = false;
  job.awaiting = false;
  job.note = 'Paused';
  await chrome.storage.local.set({ job });
}

async function reset() {
  const { job } = await chrome.storage.local.get('job');
  if (job?.running && !confirm('A broadcast is running. Stop it and clear progress?')) return;
  await chrome.storage.local.remove('job');
}

async function copyFailed() {
  const { job } = await chrome.storage.local.get('job');
  const lines = job.items.filter((i) => i.status === 'failed').map((i) => (i.name ? `${i.phone}, ${i.name}` : i.phone));
  await navigator.clipboard.writeText(lines.join('\n'));
  $('copyFailed').textContent = 'Copied';
  setTimeout(() => { $('copyFailed').textContent = 'Copy failed numbers'; }, 1500);
}

async function init() {
  const store = await chrome.storage.local.get(['draft', 'job', 'lists']);
  const { draft, job } = store;
  lists = store.lists || {};
  if (draft) {
    for (const f of FIELDS) if (draft[f] != null) $(f).value = draft[f];
    if (draft.fastMode != null) $('fastMode').checked = draft.fastMode;
  }
  const active = job && job.index < job.items.length;
  renderListSelect(active ? job.listName : draft?.selectedList);
  // Saved lists are the source of truth: refresh the box in case the list was edited since.
  if (!active) applyList($('listSelect').value);
  if (job) {
    for (const f of ['minDelay', 'maxDelay', 'dailyCap']) $(f).value = job[f];
    if (active) $('message').value = job.message;
  }
  updateParseInfo();
  render(job);

  for (const f of FIELDS) {
    $(f).addEventListener('input', () => {
      if (f === 'list') $('listSelect').value = ''; // hand-edited: no longer exactly a saved list
      saveDraft();
      if (f === 'list' || f === 'cc') updateParseInfo();
    });
  }
  $('listSelect').addEventListener('change', () => {
    const name = $('listSelect').value;
    if (name) applyList(name);
    else $('list').value = '';
    updateParseInfo();
    saveDraft();
  });
  $('fastMode').addEventListener('change', saveDraft);
  // A file picker closes the popup, so contacts and lists are managed on their own page in a tab.
  $('manageBtn').addEventListener('click', async () => {
    await saveDraft();
    const name = $('listSelect').value;
    await chrome.tabs.create({ url: chrome.runtime.getURL(`manage.html${name ? `?list=${encodeURIComponent(name)}` : ''}`) });
  });
  $('start').addEventListener('click', () => start().catch((e) => showError(e.message)));
  $('pause').addEventListener('click', () => pause().catch((e) => showError(e.message)));
  $('reset').addEventListener('click', () => reset().catch((e) => showError(e.message)));
  $('copyFailed').addEventListener('click', () => copyFailed().catch((e) => showError(e.message)));

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (changes.job) render(changes.job.newValue);
    if (changes.lists) {
      lists = changes.lists.newValue || {};
      const { job: j } = await chrome.storage.local.get('job');
      const busy = j && j.index < j.items.length;
      renderListSelect($('listSelect').value);
      if (!busy) applyList($('listSelect').value);
    }
  });
}

init().catch((e) => showError(e.message));
