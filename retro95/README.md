# Retro 95

A Chrome extension (Manifest V3) that restyles any website to look like a
1995-era desktop, and can open the Wayback Machine snapshot of the current
page for a chosen year. Plain JS/HTML/CSS, no build step.

## Load it (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this `retro95/` folder.
4. Pin the extension from the puzzle-piece menu so its button stays visible.

## Reload after editing

- Click the circular **Reload** arrow on the Retro 95 card in `chrome://extensions`.
- Then **reload any open tabs** you want to test. Content scripts are only
  injected into pages loaded after the extension (re)loads.
- Popup-only changes (`popup.html`/`popup.js`) show up the next time you open the popup.

## Files

| File | What it does |
|------|--------------|
| `manifest.json` | Declares the extension: popup, service worker, content script + CSS on every page, permissions. |
| `retro.css` | The whole skin. Every rule is scoped under `html.retro95`, so it does nothing until that class is on `<html>`. Loaded by the manifest, not injected, so page CSP can't block it. |
| `content.js` | Runs in every page. Adds/removes the `retro95` class, and in the top frame only draws the title bar (page title), taskbar (clock) and Start menu (Retro mode, Time travel..., Shut down) inside a Shadow DOM on `<html>`, with a 0.5s power-on effect when switched on. Answers `toggle` messages from the popup. While the skin is on, re-scans every second and after scrolling: tags fixed/sticky elements (`data-retro95-float`) so the CSS can give them a solid face and move them clear of the bars, and text-less buttons (`data-retro95-bare`) so they don't get bevels. A contrast pass (after load, on DOM changes at most every 500ms, after scrolling; visible elements only) tags dark panels with text (`data-retro95-panel` → grey panel), text drawn over pictures (`data-retro95-chip` → grey chip) and fades (`data-retro95-flat` → gradient backgrounds/masks removed). |
| `background.js` | Service worker. `listYears`: fetches which years have a snapshot of a page (archive.org CDX API; the popup waits 8s, a slow request keeps running up to 30s and caches its answer for 10 min in `chrome.storage.session`). `timeTravel`: opens that year's exact capture (`/web/<timestamp>if_/<url>`), or asks the availability API (8s timeout) for the closest one. A failed or slow look-up never navigates the tab. Opens the popup when the Start menu asks (`openPopup`). Keeps no state in memory (it sleeps). Logs raw archive.org answers to its console. |
| `popup.html` / `popup.js` | The toolbar popup: skin toggle, and the Time travel picker listing only years that have a snapshot of the current page (closest to 2000 preselected). |

## Demo script (2 minutes)

### Sites and years

| # | Open this | Year to pick | What the audience sees |
|---|-----------|--------------|------------------------|
| 1 | `https://www.apple.com/` | **2000** (preselected) | apple.com on 26 Feb 2000: Power Mac G4, iBook, "Hot News Headlines" |
| 2 | `https://en.wikipedia.org/wiki/Windows_95` | **2004** (preselected, the oldest) | The 2004 article, with a screenshot of the original Start menu |
| Backup | `https://www.bbc.co.uk/news` | **2005** (choose it by hand) | BBC News front page, 22 Feb 2005 |

Avoid BBC **1997** (archive lost most images) and **2008** (the archived page pops up a
JavaScript alert, "Invalid feed specified").

### Before you go on stage (10 minutes before)

1. `chrome://extensions` → Retro 95 → **Reload**. Then close and reopen the demo tabs.
2. Open tab 1 (apple.com) and tab 2 (Wikipedia). Dismiss the site banners once:
   Apple's "Choose another country" bar (**×**), Wikipedia's donation banner
   (**Maybe later**), BBC's cookie bar (**Reject additional cookies**).
3. **Warm the archive cache.** On each demo tab click the Retro 95 button and wait for
   "Archived in N years." apple.com often takes longer than the 8 s limit and shows
   "The archive is slow right now": wait ~5 s and press **Retry** (the look-up kept running in
   the background, so this is quick). After this the list is instant for 10 minutes. Do this
   *after* step 1: reloading the extension clears the cache.
4. Make sure **Retro mode is OFF** (untick it in the popup) and tab 1 is in front.

### Click order and what to say

**0:00–0:30 Normal site.** Show apple.com as it is.
> "This is the web in 2026: rounded corners, gradients, giant photos. Retro 95 is a Chrome
> extension that turns any website into a 1995 desktop with one click."

**0:30–1:00 Toggle retro.** Click the Retro 95 toolbar button → tick **Retro mode**. The
screen flickers on: grey panels, bevelled buttons, the blue title bar with the page title,
the taskbar with a live clock. Click **Start** to show the menu, then click on the page to
close it.
> "Same page, same links, it all still works. The skin is pure CSS; the title bar and
> taskbar live in a Shadow DOM so the site can't break them."

**1:00–1:30 Time travel.** Click the Retro 95 button. The year list only has years the
Internet Archive really saved for this page; **2000** is already selected. Click
**Time travel**.
> "Now let's go back to the year 2000." (apple.com from February 2000 appears, still in
> the 95 skin.) "Every year in that list is a real capture from the Wayback Machine."

**1:30–2:00 Second site.** Switch to the Wikipedia tab: it's already retro (the setting is
shared). Click the Retro 95 button → **2004** → **Time travel**. The 2004 article loads,
showing a screenshot of the real Start menu next to ours.
> "Works on any site. Here's Wikipedia's Windows 95 article as it was in 2004."
Finish: **Start → Shut down** turns everything back to normal.

### If something goes wrong

- **"The archive is slow right now"**: count to five, press **Retry**. The look-up kept going
  in the background, so the second try is usually instant.
- **"Archive not reachable. Try again"**: the network or archive.org is down; press **Retry**.
  A failed or slow look-up never changes your page.
- **Archive completely down**: skip the time-travel part; show the toggle and Start menu on
  the second site instead.
- **No skin on a tab**: that tab was open before the extension (re)loaded. Reload the tab.

## Debugging

- Popup: right-click the popup > **Inspect**.
- Service worker: `chrome://extensions` > Retro 95 > **service worker** link.
- Content script: the page's own DevTools console (messages start with `[Retro 95]`).
