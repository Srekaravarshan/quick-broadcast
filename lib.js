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

if (typeof module !== 'undefined') module.exports = { parseRecipients, todayKey };
