// Runs on web.whatsapp.com. Drives the job stored in chrome.storage.local.
//
// Fast mode (default): stays on the loaded page. For each recipient it opens
// "New chat", searches the number, opens the chat only if exactly ONE contact
// matches, pastes the message and clicks Send. No page reloads.
//
// Fallback (per recipient, or when fast mode is off / keeps missing): loads
// /send?phone=…&text=… which makes WhatsApp open the chat with text prefilled.
//
// All state lives in storage, so reloads, pausing and closing the popup are safe.
(() => {
  const SEL = {
    compose: 'footer div[contenteditable="true"], div[contenteditable="true"][data-tab="10"]',
    // Verified on live WhatsApp Web (Nov 2026): most data-icon attributes are gone;
    // Send is button[aria-label="Send"], message status is an aria-label (" Pending ", " Sent ", " Read ").
    send: 'footer button[aria-label="Send"], button[aria-label="Send"], span[data-icon="send"], span[data-icon="wds-ic-send-filled"]',
    pending: '#main [aria-label*="Pending"], span[data-icon="msg-time"]',
    dialog: '[role="dialog"], div[data-animate-modal-popup="true"]',
    chatList: '#pane-side',
    newChat: 'button[aria-label="New chat"], div[role="button"][aria-label="New chat"], [title="New chat"], span[data-icon="new-chat-outline"], span[data-icon="chat"]',
    back: 'button[aria-label="Back"], div[role="button"][aria-label="Back"], span[data-icon="back"], span[data-icon="arrow-back"]',
    rows: '[role="listitem"], [role="row"], [role="option"]',
    mainHeader: '#main header',
  };
  const INVALID_RE = /invalid|isn.t on whatsapp|not on whatsapp/i;
  const FIXED_ROWS_RE = /^(new group|new community|new contact|new broadcast|message yourself)$/i;
  const MAX_FAST_MISSES = 3; // consecutive misses before fast mode switches itself off

  let timer = null;
  let ticker = null;
  let busy = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const todayKey = () => new Date().toLocaleDateString('en-CA');
  const rand = (min, max) => min + Math.random() * Math.max(0, max - min);
  const getJob = async () => (await chrome.storage.local.get('job')).job;
  const setJob = (job) => chrome.storage.local.set({ job });
  const visible = (el) => !!el && el.isConnected && el.getClientRects().length > 0;

  async function waitFor(fn, timeout, interval = 250) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  function buildText(job, item) {
    return job.message
      .replace(/\{name\}/gi, item.name || '')
      .replace(/ +([,.!?])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ');
  }

  function sendUrl(job) {
    const item = job.items[job.index];
    return `https://web.whatsapp.com/send?phone=${item.phone}&text=${encodeURIComponent(buildText(job, item))}`;
  }

  function clickEl(el) {
    for (const type of ['mousedown', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  }

  function pressEscape(el) {
    const opts = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
    (el || document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', opts));
  }

  // ---------- overlay ----------
  let overlay;
  function ui() {
    if (overlay) return overlay;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .box{font:13px/1.4 system-ui,sans-serif;background:#111b21;color:#e9edef;border:1px solid #2a3942;
             border-radius:10px;padding:10px 12px;box-shadow:0 4px 16px rgba(0,0,0,.35);display:flex;gap:10px;align-items:center;max-width:380px}
        .t{flex:1}
        button{font:inherit;background:#00a884;color:#111b21;border:0;border-radius:6px;padding:4px 10px;cursor:pointer;font-weight:600}
      </style>
      <div class="box"><div class="t"></div><button type="button">Pause</button></div>`;
    root.querySelector('button').addEventListener('click', async () => {
      const job = await getJob();
      if (!job) return;
      job.running = false;
      job.awaiting = false;
      job.note = 'Paused';
      await setJob(job);
    });
    document.documentElement.appendChild(host);
    overlay = { host, text: root.querySelector('.t') };
    return overlay;
  }
  function say(msg) { ui().text.textContent = msg; ui().host.style.display = ''; }
  function hide() { if (overlay) overlay.host.style.display = 'none'; }

  function stopTimers() {
    clearTimeout(timer);
    clearInterval(ticker);
    timer = ticker = null;
  }

  // ---------- fast mode: open chat without reloading ----------
  function setSearch(el, q) {
    el.focus();
    if (el instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, q);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, q);
    }
  }

  function drawerRoot(el) {
    let node = el;
    while (node && node !== document.body) {
      if (node.getBoundingClientRect().height > window.innerHeight * 0.6) return node;
      node = node.parentElement;
    }
    return document.body;
  }

  function resultRows(root) {
    const rows = [...root.querySelectorAll(SEL.rows)].filter(visible);
    const outer = rows.filter((r) => !rows.some((o) => o !== r && o.contains(r)));
    return outer.filter((r) => {
      const t = r.querySelector('span[title]');
      return t && !FIXED_ROWS_RE.test(t.title.trim());
    });
  }

  async function settledRows(root) {
    await sleep(700);
    let last = -1;
    let rows = [];
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      rows = resultRows(root);
      if (rows.length === last) break; // unchanged across two polls
      last = rows.length;
      await sleep(400);
    }
    return rows;
  }

  function closeDrawer(search) {
    pressEscape(search);
    const back = [...document.querySelectorAll(SEL.back)].find(visible);
    if (back) clickEl(back.closest('button,[role="button"]') || back);
  }

  const composeLabel = () => [...document.querySelectorAll(SEL.compose)].find(visible)?.getAttribute('aria-label') || '';

  // The opened chat must belong to `title`. The message box is labelled
  // "Type a message to <name>", so require that label to have CHANGED since before
  // the click (so a previously open "Sri Ravi" can't pass for "Ravi") and to END
  // with the exact contact title.
  function chatMatches(title, prevLabel) {
    const compose = [...document.querySelectorAll(SEL.compose)].find(visible);
    if (!compose) return null;
    const label = compose.getAttribute('aria-label') || '';
    return label && label !== prevLabel && label.endsWith(title) ? compose : null;
  }

  // Returns 'opened', 'not-on-whatsapp', or false (use the reload fallback).
  async function openChatInPage(item) {
    const icon = [...document.querySelectorAll(SEL.newChat)].find(visible);
    if (!icon) return false;
    const before = document.activeElement;
    clickEl(icon.closest('button,[role="button"]') || icon);

    const search = await waitFor(() => {
      const a = document.activeElement;
      return a && a !== before && (a.isContentEditable || a.tagName === 'INPUT') && !a.closest('footer') ? a : null;
    }, 3000, 100);
    if (!search) { pressEscape(); return false; }

    const root = drawerRoot(search);
    const queries = [...new Set([item.phone, item.phone.slice(-10)])];
    for (const q of queries) {
      setSearch(search, q);
      const rows = await settledRows(root);
      if (rows.length > 1) break; // ambiguous: never guess a recipient
      if (rows.length === 1) {
        const row = rows[0];
        // Saved contacts that aren't on WhatsApp show an "Invite" button instead of opening a chat.
        if (/\bInvite\b/.test(row.innerText || '')) { closeDrawer(search); return 'not-on-whatsapp'; }
        const title = row.querySelector('span[title]').title.trim();
        const prevLabel = composeLabel();
        // The click handler sits on a child of the row's role=button div, so target the inner gridcell.
        clickEl(row.querySelector('[role="gridcell"]') || row.querySelector('span[title]') || row);
        const opened = await waitFor(() => chatMatches(title, prevLabel), 5000);
        if (!opened) closeDrawer(search);
        return opened ? 'opened' : false;
      }
    }
    closeDrawer(search);
    return false;
  }

  const isEmpty = (c) => !(c.textContent || '').trim();

  // WhatsApp's editor (Lexical) ignores execCommand('delete'); a beforeinput
  // deleteContentBackward over a full selection does clear it (verified live).
  async function clearCompose(c) {
    for (let i = 0; i < 2 && !isEmpty(c); i++) {
      c.focus();
      const sel = getSelection();
      const range = document.createRange();
      range.selectNodeContents(c);
      sel.removeAllRanges();
      sel.addRange(range);
      c.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true }));
      await sleep(250);
    }
    return isEmpty(c);
  }

  async function fillCompose(text) {
    const c = await waitFor(() => [...document.querySelectorAll(SEL.compose)].find(visible), 5000);
    if (!c) return null;
    // Never append to a saved draft: if the box can't be emptied, bail out.
    if (!(await clearCompose(c))) return null;
    c.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    c.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    let ok = await waitFor(() => ((c.textContent || '').trim() ? c : null), 2000, 100);
    if (!ok) {
      document.execCommand('insertText', false, text);
      ok = await waitFor(() => ((c.textContent || '').trim() ? c : null), 1000, 100);
    }
    return ok;
  }

  // Returns a result object, or null to tell the caller to use the reload fallback.
  async function sendInPage(job) {
    const item = job.items[job.index];
    say(`Opening chat: ${item.name || '+' + item.phone} (${job.index + 1}/${job.items.length})…`);
    const opened = await openChatInPage(item);
    if (opened === 'not-on-whatsapp') return { status: 'failed', error: 'Not on WhatsApp (contact shows Invite)', via: 'fast' };
    if (opened !== 'opened') return null;
    const compose = await fillCompose(buildText(job, item));
    if (!compose) return null;
    await sleep(rand(300, 900));
    const err = await clickSend(compose);
    return err ? { status: 'failed', error: err } : { status: 'sent', via: 'fast' };
  }

  // ---------- scheduling ----------
  async function scheduleNext(job, delayMs) {
    stopTimers();
    job.nextAt = Date.now() + delayMs;
    await setJob(job);
    const label = `${job.index + 1}/${job.items.length}`;
    const render = () => {
      const s = Math.max(0, Math.ceil((job.nextAt - Date.now()) / 1000));
      say(`Broadcast ${label} · next in ${s}s · sent today ${job.daily.count}/${job.dailyCap}`);
    };
    render();
    ticker = setInterval(render, 1000);
    timer = setTimeout(runNext, delayMs);
  }

  async function runNext() {
    stopTimers();
    if (busy) return;
    busy = true;
    try {
      const job = await getJob();
      if (!job?.running) return;
      if (job.fastMode !== false) {
        const result = await sendInPage(job);
        if (result) { await recordResult(result, true); return; }
        await noteFastMiss();
      }
      const fresh = await getJob();
      if (!fresh?.running) return;
      fresh.awaiting = true;
      await setJob(fresh);
      location.href = sendUrl(fresh);
    } catch (e) {
      console.error('[Quick Broadcast]', e);
      say(`Broadcast error: ${e.message}`);
    } finally {
      busy = false;
    }
  }

  async function noteFastMiss() {
    const job = await getJob();
    if (!job) return;
    job.fastMisses = (job.fastMisses || 0) + 1;
    if (job.fastMisses >= MAX_FAST_MISSES) {
      job.fastMode = false;
      job.fastNote = `Fast mode turned itself off after ${MAX_FAST_MISSES} misses in a row (using page loads instead).`;
    }
    await setJob(job);
  }

  // ---------- reload path ----------
  function invalidDialog() {
    for (const d of document.querySelectorAll(SEL.dialog)) {
      if (INVALID_RE.test(d.textContent || '')) return d;
    }
    return null;
  }

  function composeWithText() {
    for (const c of document.querySelectorAll(SEL.compose)) {
      if ((c.textContent || '').trim()) return c;
    }
    return null;
  }

  async function clickSend(compose) {
    const btn = await waitFor(() => {
      const el = [...document.querySelectorAll(SEL.send)].find(visible);
      return el && (el.closest('button,[role="button"]') || el);
    }, 10000);
    if (!btn) return 'Send button not found';
    btn.click();
    const cleared = await waitFor(() => !compose.isConnected || !(compose.textContent || '').trim(), 10000);
    if (!cleared) return 'Message stayed in the input box';
    // Wait until WhatsApp has handed the message to its server (clock icon gone).
    await waitFor(() => !document.querySelector(SEL.pending), 30000, 500);
    return null;
  }

  async function processAfterReload() {
    const job = await getJob();
    const item = job.items[job.index];
    say(`Sending to ${item.name || '+' + item.phone} (${job.index + 1}/${job.items.length})…`);

    const state = await waitFor(() => {
      const d = invalidDialog();
      if (d) return { invalid: d };
      const c = composeWithText();
      if (c) return { compose: c };
      return null;
    }, 90000, 500);

    let result;
    if (!state) {
      if (!document.querySelector(SEL.chatList)) {
        const fresh = await getJob();
        fresh.running = false;
        fresh.awaiting = false;
        fresh.note = 'WhatsApp Web is not logged in or did not load. Log in, then press Resume.';
        await setJob(fresh);
        say(fresh.note);
        return;
      }
      result = { status: 'failed', error: 'Chat did not open' };
    } else if (state.invalid) {
      state.invalid.querySelector('button')?.click();
      result = { status: 'failed', error: 'Not on WhatsApp / invalid number' };
    } else {
      await sleep(rand(500, 1200));
      const err = await clickSend(state.compose);
      result = err ? { status: 'failed', error: err } : { status: 'sent', via: 'reload' };
    }
    await recordResult(result, false);
  }

  // ---------- bookkeeping ----------
  async function recordResult(result, fast) {
    const job = await getJob();
    if (!job) return;
    Object.assign(job.items[job.index], result, { at: Date.now() });
    if (fast) job.fastMisses = 0;
    if (job.daily.date !== todayKey()) job.daily = { date: todayKey(), count: 0 };
    if (result.status === 'sent') job.daily.count++;
    job.index++;
    job.awaiting = false;

    if (job.index >= job.items.length) {
      job.running = false;
      job.note = 'Finished';
    } else if (job.daily.count >= job.dailyCap) {
      job.running = false;
      job.note = `Daily cap of ${job.dailyCap} reached. Press Resume tomorrow.`;
    }

    if (job.running) {
      await scheduleNext(job, rand(job.minDelay, job.maxDelay) * 1000);
    } else {
      await setJob(job);
      say(`Broadcast: ${job.note}`);
    }
  }

  async function tick() {
    if (busy) return;
    const job = await getJob();
    if (!job?.running) { stopTimers(); return; }
    if (job.awaiting) {
      busy = true;
      try { await processAfterReload(); }
      catch (e) { console.error('[Quick Broadcast]', e); say(`Broadcast error: ${e.message}`); }
      finally { busy = false; }
    } else {
      // Wait for WhatsApp to finish loading before the first in-page attempt.
      await waitFor(() => document.querySelector(SEL.chatList), 90000, 500);
      const fresh = await getJob(); // may have been paused while we waited
      if (!fresh?.running) return;
      await scheduleNext(fresh, Math.max(1500, (fresh.nextAt || 0) - Date.now()));
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.job) return;
    const { oldValue, newValue } = changes.job;
    if (!newValue?.running) {
      stopTimers();
      if (!newValue) hide();
      else if (oldValue?.running) say(`Broadcast: ${newValue.note || 'Paused'}`);
      return;
    }
    if (!oldValue?.running) tick(); // started or resumed from the popup
  });

  tick();
})();
