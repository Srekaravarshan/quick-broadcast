# Quick Broadcast (WhatsApp Web)

Sends your own message as a normal 1:1 chat to each number in a list, one at a time, through WhatsApp Web.

## Install
**1. Download or update** (one command, no Git needed; the same command installs and updates)

Mac (Terminal):
```bash
curl -fsSL https://raw.githubusercontent.com/Srekaravarshan/quick-broadcast/main/install.sh | bash
```

Windows (PowerShell):
```powershell
irm https://raw.githubusercontent.com/Srekaravarshan/quick-broadcast/main/install.ps1 | iex
```
After an update, click the reload icon on the extension's card in `chrome://extensions`. Contact lists and progress are kept (they're stored in Chrome, not in this folder).

**2. Add to Chrome**
1. Open `chrome://extensions` → turn on **Developer mode** (top right)
2. **Load unpacked** → pick the `quick-broadcast` folder in your home folder
3. Pin the extension; log in to https://web.whatsapp.com once (QR scan)

## Contacts & lists
No separate app needed. In the popup, click **Contacts & lists…** to open the manager page:
1. **Add contacts** once: drop a `.csv` file (Google Contacts export, Excel "Save as CSV", or any sheet with a phone column) or a `.vcf` file (iPhone or Mac Contacts export), or paste numbers. Duplicates are merged.
   - Android: https://contacts.google.com → Export → Google CSV
   - iPhone: icloud.com/contacts (or Mac Contacts) → select all → Export vCard
2. **Build lists**: search, tick the contacts, give the list a name (e.g. *Family*), and click **Save list**. You can edit, rename or delete lists later.
3. In the popup, choose the list under **Send to**. Only those contacts get the message.

Everything is stored in this Chrome profile; nothing is uploaded. You can still type or paste numbers straight into the popup instead.

**Sync from Google Contacts** (on the same page) reads the Google account's saved contacts, read-only, and adds any new ones. An Android phone already syncs its contacts to Google, so this picks up numbers saved on the phone. Run it again any time. It only adds contacts: nothing is changed in Google, and contacts deleted in Google stay here until removed. It needs the one-time setup below.

## Google Contacts sync setup (one time, ~15 min)
The extension has a fixed ID, `kkgmeoaliceagedabneigmibpdponnoe` (set by `key` in `manifest.json`), so this setup works on every laptop.

1. Go to https://console.cloud.google.com and create a project, e.g. *Quick Broadcast*.
2. **APIs & Services → Library**, search **People API**, then **Enable**.
3. **Google Auth Platform** (also called *OAuth consent screen*) → **Get started**. Use app name *Quick Broadcast*, your email as support email, **Audience: External**, your email as contact, then agree and **Create**.
4. **Audience → Test users → Add users**: add the Gmail whose contacts will be synced (e.g. your dad's), plus yours if you want to test.
5. **Clients → Create client**:
   - Application type: **Web application**
   - Authorized redirect URIs → Add URI: `https://kkgmeoaliceagedabneigmibpdponnoe.chromiumapp.org/` (keep the trailing `/`)
   - **Create**, then copy the **Client ID** (ends in `.apps.googleusercontent.com`).
6. Paste it into `config.js`: `const GOOGLE_CLIENT_ID = '…apps.googleusercontent.com';`, then commit and push. The Client ID is not a secret, and only the test users from step 4 can use it.
7. On the laptop: run the update command, reload the extension, then **Contacts & lists… → Sync from Google Contacts**. On first use, Google shows *"Google hasn't verified this app"*. Click **Continue**, which is expected for a personal app in testing. Then allow read access to contacts.

> **Upgrading from 1.0.0:** adding the fixed ID makes Chrome treat this as a new extension, so contacts, lists and the draft saved by 1.0.0 are not carried over. Load or reload it from the same folder, then sync or import again.

## Use
1. Open the popup, choose a list under **Send to** (or paste numbers), and write the message (`{name}` gets each contact's name).
2. **Start**. The WhatsApp Web tab takes over; a small badge bottom-left shows progress and a Pause button.
3. Leave the tab open (ideally visible: Chrome slows timers in background tabs, so it just runs slower).
4. Failed numbers (not on WhatsApp, chat didn't open) are listed in the popup with a **Copy failed numbers** button.

## How it works
**Fast mode (default, no page reloads):** for each recipient it clicks **New chat**, types the number into the search, and opens the chat **only if exactly one contact matches**. Then it pastes the message, clicks Send, and waits until the clock icon clears (the message reached the server). With zero or several matches it never guesses: it uses the fallback for that number.

**Fallback:** loads `web.whatsapp.com/send?phone=<num>&text=<msg>`. WhatsApp opens the chat with the text prefilled, and the extension clicks Send. After 3 fast-mode misses in a row, fast mode switches itself off for the run, and the popup says so.

Between recipients it waits a random delay (default 8–20 s, minimum 3 s). Progress is saved in `chrome.storage`, so reloads, pausing, and closing the popup are safe. A daily cap (default 150) stops the run; **Resume** continues where it left off. The popup shows how many messages went out via fast mode vs. via reload.

## Verified live (WhatsApp Web, 9 Nov 2026)
- New chat → search by number (with or without `91`) → exactly one result → chat opens in ~2 s, no reload.
- Recipient check: the message box label "Type a message to <name>" must change and end with the contact's exact name before anything is pasted.
- Old drafts are cleared first; multi-line text and emoji paste correctly; `button[aria-label="Send"]` sends; status goes " Pending " → " Read ".
- Fallback `/send?phone=&text=` prefills the chat; an unknown number shows "The number … isn't on WhatsApp." and is marked failed.

## Limits
- Text only (no images/files).
- Depends on WhatsApp Web's DOM (`content.js` → `SEL`). If WhatsApp changes its UI and sends start failing with "Send button not found", update those selectors.
- WhatsApp's terms disallow automated bulk messaging. Keep to contacts who know you, keep the delays, and don't raise the cap aggressively.
