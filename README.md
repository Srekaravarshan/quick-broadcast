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

## Contact list
No separate app needed. The list is pasted into the extension popup's **Recipients** box, one per line (`9876543210, Ravi`), and Chrome remembers it.
Keep the master list anywhere you like (Notes, a text file, Google Sheets, Excel) and copy-paste it in.
**Import file…** (button in the popup) opens an import page. Pick or drop a `.csv` file (Google Contacts export, Excel "Save as CSV", or any sheet with a phone column) or a `.vcf` file (iPhone or Mac Contacts export). You can review and edit the list there, then choose replace or add. The file is read locally and never uploaded.
- Android: https://contacts.google.com → Export → Google CSV
- iPhone: icloud.com/contacts (or Mac Contacts) → select all → Export vCard

## Use
1. Open the popup, paste recipients (one per line: `9876543210, Ravi`), write the message (`{name}` gets the name).
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
