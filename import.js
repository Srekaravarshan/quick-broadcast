/* global importContacts, parseRecipients */
const $ = (id) => document.getElementById(id);

function setStatus(msg, isError) {
  $('status').textContent = msg;
  $('status').className = `status${isError ? ' error' : ''}`;
  $('status').hidden = !msg;
}

async function getDraft() {
  const { draft = {} } = await chrome.storage.local.get('draft');
  return draft;
}

async function load(file) {
  setStatus('');
  if (!file) return;
  if (/\.xlsx?$/i.test(file.name)) {
    setStatus('That is an Excel file. In Excel use File → Save As → CSV, then import the .csv.', true);
    return;
  }
  const text = await file.text();
  const lines = importContacts(text, file.name);
  const { cc = '91' } = await getDraft();
  const { items, bad, dupes } = parseRecipients(lines.join('\n'), cc);
  if (!items.length) {
    setStatus(`No phone numbers found in ${file.name}. The file needs a phone/mobile column (CSV) or TEL entries (vCard).`, true);
    $('result').hidden = true;
    return;
  }
  $('dropText').textContent = `${file.name} — choose another file to replace`;
  $('ccShow').textContent = `+${cc}`;
  $('preview').value = lines.join('\n');
  const extra = [dupes && `${dupes} duplicate${dupes > 1 ? 's' : ''}`, bad.length && `${bad.length} unreadable`].filter(Boolean);
  $('summary').textContent = `Found ${items.length} contact${items.length > 1 ? 's' : ''} with a phone number${extra.length ? ` (${extra.join(', ')} will be skipped)` : ''}.`;
  $('result').hidden = false;
}

async function save(mode) {
  const { job } = await chrome.storage.local.get('job');
  if (job && job.index < job.items.length) {
    setStatus('A broadcast is in progress or paused. Finish it or press Reset in the popup before changing the list.', true);
    return;
  }
  const draft = await getDraft();
  const incoming = $('preview').value.trim();
  const current = (draft.list || '').trim();
  draft.list = mode === 'append' && current ? `${current}\n${incoming}` : incoming;
  await chrome.storage.local.set({ draft });
  const { items } = parseRecipients(draft.list, draft.cc || '91');
  setStatus(`Saved. The list now has ${items.length} recipient${items.length === 1 ? '' : 's'}. Open the Quick Broadcast popup to continue. This tab can be closed.`);
  $('result').hidden = true;
}

$('file').addEventListener('change', (e) => load(e.target.files[0]).catch((err) => setStatus(err.message, true)));
$('replace').addEventListener('click', () => save('replace').catch((err) => setStatus(err.message, true)));
$('append').addEventListener('click', () => save('append').catch((err) => setStatus(err.message, true)));

const drop = $('drop');
for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const t of ['dragleave', 'drop']) drop.addEventListener(t, () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  load(e.dataTransfer.files[0]).catch((err) => setStatus(err.message, true));
});
