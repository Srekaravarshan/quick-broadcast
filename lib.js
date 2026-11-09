// Shared helpers for the popup (kept framework-free so they can be unit-tested with node).

function todayKey() {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
}

/**
 * Parse one recipient per line. Accepted forms:
 *   9876543210
 *   +91 98765 43210
 *   9876543210, Ravi
 *   Ravi, 9876543210
 * Separators: comma, tab or semicolon. 10-digit numbers get `cc` prepended;
 * an 11-digit number with a leading 0 has the 0 replaced by `cc`.
 */
function parseRecipients(text, cc) {
  cc = String(cc || '').replace(/\D/g, '');
  const seen = new Set();
  const items = [];
  const bad = [];
  let dupes = 0;

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let phone = '';
    let name = '';
    for (const part of line.split(/[,\t;]/).map((s) => s.trim()).filter(Boolean)) {
      const digits = part.replace(/\D/g, '');
      if (!phone && digits.length >= 8 && /^[+\d\s().-]+$/.test(part)) phone = digits;
      else if (!name) name = part;
    }
    if (!phone) { bad.push(line); continue; }
    if (phone.length === 10 && cc) phone = cc + phone;
    else if (phone.length === 11 && phone.startsWith('0') && cc) phone = cc + phone.slice(1);
    if (phone.length < 10 || phone.length > 15) { bad.push(line); continue; }
    if (seen.has(phone)) { dupes++; continue; }
    seen.add(phone);
    items.push({ phone, name, status: 'pending' });
  }
  return { items, bad, dupes };
}

// ---------- contact import (CSV / vCard) ----------

const PHONE_CHARS_RE = /^[+\d\s().-]+$/;
const looksLikePhone = (s) => PHONE_CHARS_RE.test(String(s).trim()) && String(s).replace(/\D/g, '').length >= 8;
// Names go into "phone, name" lines, so separators inside them must go.
const cleanName = (s) => String(s || '').replace(/[,;\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
// Google exports several numbers in one cell as "a ::: b"; take the first phone-looking one.
const firstPhone = (s) => String(s || '').split(/:::|\/|\|/).map((p) => p.trim()).find(looksLikePhone) || '';

/** RFC-4180-ish CSV parser: quoted fields, escaped quotes, commas/newlines inside quotes. */
function parseCsv(text) {
  text = String(text).replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';'
    : firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function contactsFromCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const isPhoneHeader = (h) => /phone|mobile|\bmob\b|number|whatsapp|contact no|cell/.test(h) && !/label|type/.test(h);
  const phoneCols = header.map((h, i) => (isPhoneHeader(h) ? i : -1)).filter((i) => i >= 0)
    .sort((a, b) => Number(/mobile|cell|whatsapp/.test(header[b])) - Number(/mobile|cell|whatsapp/.test(header[a])));
  const out = [];

  if (phoneCols.length && !rows[0].some(looksLikePhone)) {
    const col = (re) => header.findIndex((h) => re.test(h));
    const full = col(/^(name|full name|display name|contact name|contact)$/);
    const first = col(/^(first name|given name)$/);
    const middle = col(/^(middle name|additional name)$/);
    const last = col(/^(last name|family name|surname)$/);
    const anyName = col(/name/);
    for (const r of rows.slice(1)) {
      const phone = phoneCols.map((c) => firstPhone(r[c])).find(Boolean);
      if (!phone) continue;
      let name = full >= 0 ? r[full] : [first, middle, last].filter((c) => c >= 0).map((c) => r[c]).join(' ');
      if (!cleanName(name) && anyName >= 0) name = r[anyName];
      out.push({ phone, name: cleanName(name) });
    }
    return out;
  }

  // No usable header: in each row, the phone-looking cell is the number, the first other cell the name.
  for (const r of rows) {
    const pi = r.findIndex(looksLikePhone);
    if (pi < 0) continue;
    const name = r.find((c, i) => i !== pi && c.trim() && !looksLikePhone(c)) || '';
    out.push({ phone: r[pi].trim(), name: cleanName(name) });
  }
  return out;
}

function contactsFromVcf(text) {
  const unfolded = String(text).replace(/\r?\n[ \t]/g, ''); // RFC 6350 line folding
  const out = [];
  for (const card of unfolded.split(/BEGIN:VCARD/i).slice(1)) {
    const lines = card.split(/\r?\n/);
    const value = (re) => {
      const l = lines.find((x) => re.test(x));
      return l ? l.slice(l.indexOf(':') + 1).trim() : '';
    };
    const tels = lines.filter((l) => /^(item\d+\.)?TEL[;:]/i.test(l));
    const tel = tels.find((l) => /CELL|MOBILE|IPHONE/i.test(l)) || tels[0];
    if (!tel) continue;
    const phone = tel.slice(tel.indexOf(':') + 1).replace(/^tel:/i, '').trim();
    let name = value(/^FN[;:]/i);
    if (!name) name = value(/^N[;:]/i).split(';').slice(0, 2).reverse().join(' ');
    name = name.replace(/\\,/g, ',').replace(/\\;/g, ';');
    if (looksLikePhone(phone)) out.push({ phone, name: cleanName(name) });
  }
  return out;
}

/** Turns an imported file into recipient lines ("phone, name") for the Recipients box. */
function importContacts(text, filename) {
  const isVcf = /\.vcf$/i.test(filename || '') || /BEGIN:VCARD/i.test(String(text).slice(0, 500));
  const contacts = isVcf ? contactsFromVcf(text) : contactsFromCsv(text);
  return contacts.map((c) => (c.name ? `${c.phone}, ${c.name}` : c.phone));
}

// ---------- Google Contacts (People API) ----------

/** Turns People API `connections` into recipient lines ("phone, name"), one per person (mobile number preferred). */
function contactsFromPeople(people) {
  const lines = [];
  for (const p of people || []) {
    const phones = (p.phoneNumbers || []).filter((n) => n.canonicalForm || n.value);
    if (!phones.length) continue;
    const best = phones.find((n) => /mobile|whatsapp/i.test(n.type || '')) || phones.find((n) => n.metadata?.primary) || phones[0];
    const phone = (best.canonicalForm || best.value).trim();
    const nm = (p.names || []).find((n) => n.metadata?.primary) || (p.names || [])[0];
    const name = cleanName(nm?.displayName || [nm?.givenName, nm?.familyName].filter(Boolean).join(' '));
    lines.push(name ? `${phone}, ${name}` : phone);
  }
  return lines;
}

// ---------- address book & lists ----------
// book: [{ phone: '919876543210', name: 'Ravi' }] (phone already normalized by parseRecipients)
// lists: { 'Family': [{ phone, name }, …] } (a snapshot, so removing a contact from the book keeps lists intact)

const byName = (a, b) => (a.name || '￿').localeCompare(b.name || '￿') || a.phone.localeCompare(b.phone);

/** Merge parsed recipients into the address book; fills in missing names, never overwrites one. */
function mergeContacts(book, items) {
  const map = new Map(book.map((c) => [c.phone, { phone: c.phone, name: c.name || '' }]));
  let added = 0;
  let updated = 0;
  for (const it of items) {
    const existing = map.get(it.phone);
    if (!existing) { map.set(it.phone, { phone: it.phone, name: it.name || '' }); added++; }
    else if (!existing.name && it.name) { existing.name = it.name; updated++; }
  }
  return { book: [...map.values()].sort(byName), added, updated };
}

/** Recipient lines ("phone, name") for the popup's Recipients box. */
function listToLines(contacts) {
  return (contacts || []).map((c) => (c.name ? `${c.phone}, ${c.name}` : c.phone)).join('\n');
}

if (typeof module !== 'undefined') {
  module.exports = {
    parseRecipients, todayKey, parseCsv, contactsFromCsv, contactsFromVcf, importContacts, mergeContacts, listToLines, contactsFromPeople,
  };
}
