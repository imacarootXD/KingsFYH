// Retro 95 popup: "Retro mode" checkbox + Time travel.

const $ = (id) => document.getElementById(id);
const status = (text) => ($('status').textContent = text);
const checkbox = $('retro');
const stateLabel = $('state');
const yearLabel = $('yearLabel');
const yearSelect = $('year');
const goButton = $('go');
const retryButton = $('retry');

function showState(on) {
  checkbox.checked = on;
  stateLabel.textContent = on ? 'ON' : 'OFF';
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Show the saved state when the popup opens (missing = off).
chrome.storage.local.get('retroEnabled', (data) => showState(data.retroEnabled === true));

// Retro mode: write storage (every tab follows via storage.onChanged), then
// also message the active tab directly as a fallback.
checkbox.addEventListener('change', async () => {
  const on = checkbox.checked;
  await chrome.storage.local.set({ retroEnabled: on });
  showState(on);
  status('');
  const tab = await activeTab();
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'toggle', on });
  } catch (e) {
    // chrome:// pages, the Web Store, and tabs opened before the extension
    // was loaded have no content script.
    status('Saved, but this tab has no content script. Reload the page.');
  }
});

// ---------- Time travel ----------
// The year list only has years with a snapshot of this page. background.js
// fetches it from archive.org's capture list (and caches it for 10 minutes).

let snapshots = [];     // [{year: "1999", timestamp: "19990208003341"}], newest first
let shownUrl = null;    // page whose years are on screen (or loading); null = none yet
let loadRun = 0;        // ignore answers for a page we've since left
let travelling = false; // after "Time travel": keep the popup as it is until it closes

// "19991117024224" -> "1999-11-17"; anything else -> ''.
function formatTimestamp(ts) {
  if (typeof ts !== 'string' || !/^\d{8}/.test(ts)) return '';
  return ts.slice(0, 4) + '-' + ts.slice(4, 6) + '-' + ts.slice(6, 8);
}

// tab.url is there when the popup was opened from the toolbar (activeTab) or
// on web.archive.org (host permission). Otherwise ask the page itself.
async function tabAddress(tab) {
  if (typeof tab.url === 'string' && tab.url) return tab.url;
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'getUrl' });
    if (r && typeof r.url === 'string') return r.url;
  } catch (e) {} // no content script: chrome:// pages, Web Store, tabs opened before install
  return '';
}

// One place that sets what the Time travel section shows.
function showPicker({ text, picker = false, go = false, retry = false }) {
  status(text);
  yearLabel.hidden = yearSelect.hidden = !picker;
  yearSelect.disabled = !go;
  goButton.disabled = !go;
  retryButton.hidden = !retry;
}

function closestTo2000(list) {
  return list.reduce((best, s) => {
    const d = Math.abs(s.year - 2000), bd = Math.abs(best.year - 2000);
    return d < bd || (d === bd && s.year < best.year) ? s : best;
  });
}

// Never throws: every path ends in one of the states above.
async function loadYears(force = false) {
  if (travelling) return;
  let url = '';
  try {
    const tab = await activeTab();
    url = tab ? await tabAddress(tab) : '';
  } catch (e) {}
  if (!force && url === shownUrl) return; // same page as on screen: nothing to do
  shownUrl = url;
  const run = ++loadRun;

  if (!/^https?:\/\//i.test(url)) return showPicker({ text: 'Open a normal website first' });
  yearSelect.replaceChildren();
  showPicker({ text: 'Checking the archive...', picker: true });

  let reply = null;
  try {
    reply = await chrome.runtime.sendMessage({ type: 'listYears', url });
  } catch (e) {
    console.error('[Retro 95] background did not answer', e);
  }
  if (run !== loadRun || travelling) return;
  console.log('[Retro 95] years for', url, reply);

  if (reply && reply.notWeb) return showPicker({ text: 'Open a normal website first' });
  if (!reply || !reply.ok || !Array.isArray(reply.years)) {
    shownUrl = null; // let Retry / a tab change ask again
    // Slow: the look-up carries on in the background, so Retry soon is usually instant.
    return showPicker({
      text: reply && reply.error === 'timeout'
        ? 'The archive is slow right now. Press Retry in a few seconds.'
        : 'Archive not reachable. Try again',
      retry: true,
    });
  }
  snapshots = reply.years.filter((s) => s && /^\d{4}$/.test(s.year) && typeof s.timestamp === 'string');
  if (!snapshots.length) return showPicker({ text: 'No archived versions of this page' });

  yearSelect.replaceChildren(...snapshots.map((s) => new Option(s.year, s.year)));
  yearSelect.value = closestTo2000(snapshots).year;
  const n = snapshots.length;
  showPicker({ text: 'Archived in ' + n + (n === 1 ? ' year.' : ' years.'), picker: true, go: true });
}

retryButton.addEventListener('click', () => loadYears(true));
loadYears();
// Popup still open and the user switches tab or the page navigates.
chrome.tabs.onActivated.addListener(() => loadYears());
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (tab && tab.active && info.status === 'complete') loadYears();
});

// Never throws: every path ends with a message in the popup.
goButton.addEventListener('click', async () => {
  goButton.disabled = true; // one request per click
  let slowTimer = null;
  const finish = (text) => {
    clearTimeout(slowTimer);
    travelling = false;
    status(text);
    goButton.disabled = false;
  };
  try {
    const year = yearSelect.value;
    const snap = snapshots.find((s) => s.year === year);
    if (!snap) return finish('Pick a year first.');
    status('Opening ' + year + '...');
    slowTimer = setTimeout(() => status('Still looking... archive.org can be slow, hang on.'), 4000);

    const tab = await activeTab();
    if (!tab || typeof tab.id !== 'number') return finish('Open a normal website first');
    const url = await tabAddress(tab);
    if (!/^https?:\/\//i.test(url)) return finish('Open a normal website first');

    travelling = true;
    let reply;
    try {
      reply = await chrome.runtime.sendMessage({ type: 'timeTravel', url, year, timestamp: snap.timestamp, tabId: tab.id });
    } catch (e) {
      console.error('[Retro 95] background did not answer', e);
      return finish('The extension did not answer. Reload it in chrome://extensions and try again.');
    }
    console.log('[Retro 95] time travel reply', reply);
    if (!reply || typeof reply !== 'object') return finish('No answer from the extension. Try again.');
    if (!reply.ok) return finish(typeof reply.error === 'string' && reply.error ? reply.error : 'Time travel failed. Try again.');

    clearTimeout(slowTimer);
    const date = formatTimestamp(reply.timestamp);
    if (!date) status('Found a snapshot. Loading...');
    else if (date.startsWith(year)) status('Opening the snapshot from ' + date + '...');
    else status('Nothing saved in ' + year + '. Opening the closest snapshot (' + date + ')...');
    setTimeout(() => window.close(), 1500);
  } catch (e) {
    console.error('[Retro 95] time travel failed', e);
    finish('Time travel failed unexpectedly. Try again.');
  }
});
