// Retro 95 service worker. It sleeps when idle, so keep no state in
// variables here; use chrome.storage.local.

// "https://web.archive.org/web/19991117024224if_/http://apple.com:80/" -> "http://apple.com:80/"
const WAYBACK_PREFIX = /^(?:https?:\/\/)?web\.archive\.org\/web\/[^/]*\/?/i;

// The address of the real site, even if we're already on a snapshot.
// Returns '' if there is nothing usable.
function originalUrl(raw) {
  let url = typeof raw === 'string' ? raw.trim() : '';
  for (let i = 0; i < 3 && WAYBACK_PREFIX.test(url); i++) url = url.replace(WAYBACK_PREFIX, '');
  if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'http://' + url; // "web/2000/apple.com"
  if (!/^https?:\/\//i.test(url)) return url;
  // Tidy snapshot quirks the API chokes on (it times out on
  // "http://www.apple.com:80/?" but answers "http://www.apple.com/"):
  // default port (URL drops it), trailing dot in the host, empty "?".
  try {
    const u = new URL(url);
    u.hostname = u.hostname.replace(/\.$/, '');
    if (!u.search) u.search = '';
    return u.href;
  } catch (e) {
    return '';
  }
}

const isArchiveOrg = (url) => /^https?:\/\/([^/]*\.)?archive\.org(\/|:|$)/i.test(url);

// ---------- Years with snapshots (CDX capture list) ----------
const CDX_TIMEOUT_MS = 8000;     // how long the popup waits for the year list
const CDX_BACKGROUND_MS = 30000; // how long the request itself may run (it caches its answer)
const LOOKUP_TIMEOUT_MS = 8000;  // closest-snapshot lookup (fallback when there's no exact capture)
const CACHE_MS = 10 * 60 * 1000;

// Requests still running, by URL. Only lives while the worker is awake; if it
// sleeps, the next ask just starts a new request.
const cdxRunning = new Map();

// Which years have a snapshot of this page? Cached for 10 min per URL in
// chrome.storage.session, never throws. The popup gets an answer within 8s;
// a slow archive.org request keeps going in the background and caches its
// result, so "Retry" a few seconds later is instant (and never starts a
// second request for the same page). Resolves to
// {ok:true, url, years:[{year, timestamp}] newest first, cached}
// | {ok:false, notWeb:true} | {ok:false, error: 'timeout'|'network'|...}.
async function listYears(msg) {
  try {
    const url = originalUrl(msg && msg.url);
    if (!/^https?:\/\//i.test(url) || isArchiveOrg(url)) return { ok: false, notWeb: true };

    const { cdxCache = {} } = await chrome.storage.session.get('cdxCache');
    const hit = cdxCache[url];
    if (hit && Date.now() - hit.at < CACHE_MS && Array.isArray(hit.years)) {
      return { ok: true, url, years: hit.years, cached: true };
    }

    let job = cdxRunning.get(url);
    if (!job) {
      job = fetchYears(url).finally(() => cdxRunning.delete(url));
      cdxRunning.set(url, job);
    }
    const slow = new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'timeout' }), CDX_TIMEOUT_MS));
    return await Promise.race([job, slow]);
  } catch (e) {
    console.error('[Retro 95] listYears failed', e);
    return { ok: false, error: 'unexpected' };
  }
}

// One CDX request; caches a successful answer. Never throws.
async function fetchYears(url) {
  try {
    // One row per year (collapse=timestamp:4). Skips redirect/error captures
    // (3xx/4xx/5xx) so each year's timestamp is a page that shows that year.
    const api = 'https://web.archive.org/cdx/search/cdx?url=' + encodeURIComponent(url) +
      '&output=json&fl=timestamp&collapse=timestamp:4&filter=!statuscode:%5B345%5D..';
    let raw;
    try {
      const res = await fetch(api, { signal: AbortSignal.timeout(CDX_BACKGROUND_MS) });
      raw = await res.text();
      console.log('[Retro 95] CDX', res.status, api, raw); // raw response, for debugging
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
    } catch (e) {
      console.warn('[Retro 95] CDX request failed', api, e);
      return { ok: false, error: e && e.name === 'TimeoutError' ? 'timeout' : 'network' };
    }

    let rows;
    try { rows = raw.trim() ? JSON.parse(raw) : []; } catch (e) { return { ok: false, error: 'bad answer' }; }
    // [["timestamp"], ["19961022105458"], ...]; no captures = [] (no header row).
    const years = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      const ts = Array.isArray(row) ? String(row[0]) : '';
      if (/^\d{8,14}$/.test(ts) && !years.some((y) => y.year === ts.slice(0, 4))) {
        years.push({ year: ts.slice(0, 4), timestamp: ts });
      }
    }
    years.sort((a, b) => b.year - a.year);

    const { cdxCache = {} } = await chrome.storage.session.get('cdxCache'); // re-read: may have changed meanwhile
    for (const key of Object.keys(cdxCache)) {
      if (!(Date.now() - (cdxCache[key] && cdxCache[key].at) < CACHE_MS)) delete cdxCache[key]; // drop stale
    }
    cdxCache[url] = { at: Date.now(), years };
    await chrome.storage.session.set({ cdxCache });
    return { ok: true, url, years, cached: false };
  } catch (e) {
    console.error('[Retro 95] fetchYears failed', e);
    return { ok: false, error: 'unexpected' };
  }
}

// ---------- Navigate to a snapshot ----------

// Never throws. With an exact CDX timestamp for the chosen year, opens that
// capture directly. Otherwise asks the availability API (one request) for
// the closest one. Resolves to {ok:true, url, timestamp} after navigating
// the tab, or {ok:false, error}.
async function timeTravel(msg) {
  try {
    const url = originalUrl(msg && msg.url);
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'Open a normal website first (an http or https page).' };
    }
    if (isArchiveOrg(url)) {
      return { ok: false, error: 'This is an archive.org page. Open a normal website first.' };
    }
    const year = parseInt(msg && msg.year, 10);
    if (!(year >= 1991 && year <= new Date().getFullYear())) return { ok: false, error: 'Pick a year first.' };

    const exact = msg && typeof msg.timestamp === 'string' && /^\d{8,14}$/.test(msg.timestamp) &&
      msg.timestamp.startsWith(String(year)) ? msg.timestamp : '';
    if (exact) return openSnapshot(msg.tabId, 'https://web.archive.org/web/' + exact + 'if_/' + url, exact);

    const api = 'https://archive.org/wayback/available?url=' + encodeURIComponent(url) + '&timestamp=' + year + '0101';
    let raw;
    try {
      const res = await fetch(api, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
      raw = await res.text();
      console.log('[Retro 95] Wayback API', res.status, api, raw); // raw response, for debugging
      if (!res.ok) return { ok: false, error: 'The archive had a problem (error ' + res.status + '). Your page was left as it is. Try again in a moment.' };
    } catch (e) {
      console.warn('[Retro 95] Wayback API request failed', api, e);
      return {
        ok: false,
        error: e && e.name === 'TimeoutError'
          ? 'The archive did not answer within 8 seconds. Your page was left as it is. Try again in a moment.'
          : 'Could not reach the archive. Your page was left as it is. Check the connection and try again.',
      };
    }

    let data;
    try { data = JSON.parse(raw); } catch (e) {
      return { ok: false, error: 'archive.org sent an unexpected answer. Try again in a moment.' };
    }
    const snaps = data && typeof data === 'object' ? data.archived_snapshots : null;
    const closest = snaps && typeof snaps === 'object' ? snaps.closest : null;
    if (!closest || typeof closest !== 'object' || closest.available === false || typeof closest.url !== 'string') {
      // An "error" field means archive.org failed, not that nothing was saved,
      // e.g. {"error": {"code": "timeout", "message": "client timeout at 5.0 seconds"}}
      if (data && data.error) {
        return { ok: false, error: 'archive.org could not look that up right now (' +
          String(data.error.code || 'error') + '). Try again in a moment.' };
      }
      return { ok: false, error: 'No snapshot found for that year.' };
    }

    // Toolbar-free replay over https: .../web/<timestamp>if_/<original url>
    const m = closest.url.match(/^https?:\/\/web\.archive\.org\/web\/(\d{4,14})[a-z_]*\/(.+)$/i);
    if (!m) return { ok: false, error: 'archive.org sent a snapshot link Retro 95 does not understand.' };
    const snapshot = 'https://web.archive.org/web/' + m[1] + 'if_/' + m[2];
    const timestamp = typeof closest.timestamp === 'string' && /^\d{8,14}$/.test(closest.timestamp) ? closest.timestamp : m[1];

    return openSnapshot(msg && msg.tabId, snapshot, timestamp);
  } catch (e) {
    console.error('[Retro 95] time travel failed', e);
    return { ok: false, error: 'Time travel failed unexpectedly. Try again.' };
  }
}

async function openSnapshot(tabId, snapshot, timestamp) {
  if (typeof tabId !== 'number') {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tabId = tab && tab.id;
  }
  if (typeof tabId !== 'number') return { ok: false, error: 'Could not find the tab to open the snapshot in.' };
  try {
    await chrome.tabs.update(tabId, { url: snapshot });
  } catch (e) {
    console.warn('[Retro 95] tabs.update failed', tabId, e);
    return { ok: false, error: 'Could not open the snapshot in this tab (was it closed?).' };
  }
  return { ok: true, url: snapshot, timestamp };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const type = msg && msg.type;

  // Popup opened: which years have snapshots? {type, url}
  if (type === 'listYears') {
    listYears(msg).then(sendResponse);
    return true; // reply is async
  }

  // Popup > "Time travel": {type, url, year, timestamp?, tabId}
  if (type === 'timeTravel') {
    timeTravel(msg).then(sendResponse);
    return true; // reply is async
  }

  // Start menu > "Time travel...": open the popup so the user can pick a year.
  // openPopup() needs Chrome 127+ and a focused browser window; the content
  // script shows help text if this fails.
  if (type === 'openPopup') {
    try {
      chrome.action.openPopup().then(
        () => sendResponse({ ok: true }),
        (e) => sendResponse({ ok: false, error: String(e && e.message || e) }),
      );
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
    return true;
  }
});
