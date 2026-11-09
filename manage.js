/* global importContacts, parseRecipients, mergeContacts, listToLines */
const $ = (id) => document.getElementById(id);
const NEW = '__new__';

let book = [];
let lists = {};
let cc = '91';
let current = null; // name of the list being edited, or null for a new list
let selected = new Set(); // phones ticked

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function setStatus(msg, isError) {
  $('status').textContent = msg || '';
  $('status').className = `status${isError ? ' error' : ''}`;
  $('status').hidden = !msg;
}

const persist = (data) => chrome.storage.local.set(data);

// ---------- rendering ----------
function renderPicker() {
  const sel = $('listPick');
  sel.replaceChildren(
    new Option('+ New list', NEW),
    ...Object.keys(lists).sort((a, b) => a.localeCompare(b)).map((n) => new Option(`${n} (${lists[n].length})`, n)),
  );
  sel.value = current && lists[current] ? current : NEW;
  $('bookCount').textContent = `· ${plural(book.length, 'contact')} saved`;
  $('deleteList').disabled = !current;
  $('useList').disabled = !current;
}

function visibleContacts() {
  const q = $('search').value.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, '');
  const onlyTicked = $('onlySelected').checked;
  return book.filter((c) => (!onlyTicked || selected.has(c.phone))
    && (!q || c.name.toLowerCase().includes(q) || (qDigits.length >= 3 && c.phone.includes(qDigits))));
}

function updateCount() {
  const shown = visibleContacts().length;
  $('selCount').textContent = `Ticked ${selected.size} of ${book.length}${shown !== book.length ? ` · showing ${shown}` : ''}`;
}

function renderContacts() {
  const box = $('contacts');
  const shown = visibleContacts();
  if (!book.length || !shown.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = book.length ? 'No contacts match.' : 'No contacts yet. Add some in step 1.';
    box.replaceChildren(empty);
  } else {
    box.replaceChildren(...shown.map((c) => {
      const row = document.createElement('label');
      row.className = 'contact';
      row.setAttribute('role', 'listitem');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selected.has(c.phone);
      cb.dataset.phone = c.phone;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = c.name || '(no name)';
      const phone = document.createElement('span');
      phone.className = 'phone';
      phone.textContent = `+${c.phone}`;
      row.append(cb, name, phone);
      return row;
    }));
  }
  updateCount();
}

async function selectList(name) {
  current = name && name !== NEW && lists[name] ? name : null;
  $('listName').value = current || '';
  selected = new Set(current ? lists[current].map((c) => c.phone) : []);
  if (current) {
    // Contacts that are in the list but were removed from the book come back, so they stay visible.
    const r = mergeContacts(book, lists[current]);
    if (r.added) { book = r.book; await persist({ book }); }
  }
  renderPicker();
  renderContacts();
}

// ---------- adding contacts ----------
async function addContacts(lines, source) {
  const { items, bad } = parseRecipients(lines.join('\n'), cc);
  if (!items.length) {
    setStatus(`No phone numbers found in ${source}.`, true);
    return;
  }
  const r = mergeContacts(book, items);
  book = r.book;
  await persist({ book });
  renderPicker();
  renderContacts();
  const already = items.length - r.added - r.updated;
  const parts = [`${plural(r.added, 'new contact')} added`];
  if (r.updated) parts.push(`${plural(r.updated, 'name')} filled in`);
  if (already > 0) parts.push(`${already} already saved`);
  if (bad.length) parts.push(`${plural(bad.length, 'unreadable line')} skipped`);
  setStatus(`${source}: ${parts.join(', ')}.`);
}

async function loadFile(file) {
  if (!file) return;
  if (/\.xlsx?$/i.test(file.name)) {
    setStatus('That is an Excel file. In Excel use File → Save As → CSV, then add the .csv.', true);
    return;
  }
  const text = await file.text();
  await addContacts(importContacts(text, file.name), file.name);
  $('file').value = ''; // allow picking the same file again
}

// ---------- list actions ----------
async function saveList() {
  const name = $('listName').value.trim();
  if (!name) return setStatus('Type a name for the list first.', true);
  if (!selected.size) return setStatus('Tick at least one contact.', true);
  if (name !== current && lists[name] && !confirm(`A list called "${name}" already exists. Replace it?`)) return;
  const contacts = book.filter((c) => selected.has(c.phone)).map(({ phone, name: n }) => ({ phone, name: n }));
  if (current && current !== name) delete lists[current];
  lists[name] = contacts;
  await persist({ lists });
  await selectList(name);
  setStatus(`Saved "${name}" with ${plural(contacts.length, 'contact')}.`);
}

async function deleteList() {
  if (!current || !confirm(`Delete the list "${current}"? The contacts stay saved.`)) return;
  const name = current;
  delete lists[name];
  await persist({ lists });
  await selectList(NEW);
  setStatus(`Deleted "${name}".`);
}

async function useList() {
  if (!current) return;
  const { job, draft = {} } = await chrome.storage.local.get(['job', 'draft']);
  if (job && job.index < job.items.length) {
    setStatus('A broadcast is in progress or paused. Finish it or press Reset in the popup first.', true);
    return;
  }
  draft.list = listToLines(lists[current]);
  draft.selectedList = current;
  await persist({ draft });
  setStatus(`"${current}" is loaded. Open the Quick Broadcast popup, write the message and press Start.`);
}

async function removeContacts() {
  if (!selected.size) return setStatus('Tick the contacts to remove first.', true);
  if (!confirm(`Remove ${plural(selected.size, 'ticked contact')} from your saved contacts? Saved lists are not changed.`)) return;
  const n = selected.size;
  book = book.filter((c) => !selected.has(c.phone));
  selected.clear();
  await persist({ book });
  renderPicker();
  renderContacts();
  setStatus(`Removed ${plural(n, 'contact')}.`);
}

// ---------- wiring ----------
const guard = (fn) => (...args) => Promise.resolve(fn(...args)).catch((e) => setStatus(e.message, true));

$('file').addEventListener('change', guard((e) => loadFile(e.target.files[0])));
const drop = $('drop');
for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const t of ['dragleave', 'drop']) drop.addEventListener(t, () => drop.classList.remove('over'));
drop.addEventListener('drop', guard((e) => { e.preventDefault(); return loadFile(e.dataTransfer.files[0]); }));

$('addPasted').addEventListener('click', guard(async () => {
  await addContacts($('paste').value.split(/\r?\n/), 'Pasted contacts');
  $('paste').value = '';
}));

$('listPick').addEventListener('change', guard((e) => selectList(e.target.value)));
$('search').addEventListener('input', renderContacts);
$('onlySelected').addEventListener('change', renderContacts);
$('contacts').addEventListener('change', (e) => {
  const phone = e.target.dataset?.phone;
  if (!phone) return;
  if (e.target.checked) selected.add(phone); else selected.delete(phone);
  updateCount();
});
$('selVisible').addEventListener('click', () => { for (const c of visibleContacts()) selected.add(c.phone); renderContacts(); });
$('clearSel').addEventListener('click', () => { selected.clear(); renderContacts(); });
$('saveList').addEventListener('click', guard(saveList));
$('useList').addEventListener('click', guard(useList));
$('deleteList').addEventListener('click', guard(deleteList));
$('removeContacts').addEventListener('click', guard(removeContacts));

guard(async () => {
  const s = await chrome.storage.local.get(['book', 'lists', 'draft']);
  book = s.book || [];
  lists = s.lists || {};
  cc = s.draft?.cc || '91';
  await selectList(new URLSearchParams(location.search).get('list') || NEW);
})();
