importScripts('urls.js', 'archive.js', 'history.js');

const { addressURL, destination, withoutHash } = RewindURLs;
const homeURL = chrome.runtime.getURL('home.html');
const sessions = new Map();
const active = new Map();
const PRESENT_STATUS = 'Present · retro skin';
const FALLBACK_STATUS = 'Not online in 2000 · showing today';
const isMode = value => value === 'archive' || value === 'present';
// "archive" = real Wayback captures up to 2000. "present" = today's web in the Retro 95 skin.
// Global for every Rewind tab, saved in chrome.storage.local under "rewindMode" (default
// "archive"). It only decides NEW navigations: Back/Forward/reload replay entries as recorded.
let mode = 'archive';
const ready = Promise.all([
  chrome.storage.session.get(null).then(items => {
    for (const [key, session] of Object.entries(items)) {
      if (key.startsWith('tab:')) sessions.set(Number(key.slice(4)), session);
    }
  }),
  chrome.storage.local.get('rewindMode').then(({ rewindMode }) => {
    if (isMode(rewindMode)) mode = rewindMode;
  }),
]);
// True once sessions and mode are in memory. After that, committed() can decide about the
// skin synchronously; it only has to wait when the worker has just woken up.
let settled = false;
void ready.then(() => { settled = true; });
// tabId -> documentId that already got the skin at commit time (see committed()).
const skinned = new Map();
const toolbarCSS = fetch(chrome.runtime.getURL('toolbar.css')).then(response => response.text());
const scripts = ['urls.js', 'ui.js', 'page.js'];

function newSession(tabId) {
  const session = { entries: [], index: -1 };
  sessions.set(tabId, session);
  return session;
}

function current(session) {
  return session.entries[session.index];
}

function localPage(url) {
  if (withoutHash(url).split('?')[0] !== homeURL) return null;
  const parameters = new URL(url).searchParams;
  const query = parameters.get('q');
  const error = parameters.get('error');
  if (query) return { kind: 'search', status: 'Search results', original: query, render: url };
  if (error) return { kind: 'error', status: 'Could not open page', original: error, render: url };
  return { kind: 'start', status: 'Ready', original: '', render: url };
}

function stateFor(tabId, session) {
  const entry = current(session);
  const pending = active.get(tabId);
  return {
    ...entry,
    status: pending?.status ?? entry?.status ?? 'Ready',
    waiting: Boolean(pending),
    tabId,
    canGoBack: session.index > 0,
    canGoForward: session.index < session.entries.length - 1,
    mode,
    // Archive mode found no capture up to the cutoff and opened the live page instead.
    fallback: entry?.fallback === true,
  };
}

function publish(tabId) {
  const session = sessions.get(tabId);
  if (!session) return;
  const data = { type: 'rewind-state', state: stateFor(tabId, session) };
  void chrome.tabs.sendMessage(tabId, data, { frameId: 0 }).catch(() => {});
  void chrome.runtime.sendMessage(data).catch(() => {});
}

// The mode is global but publish() reaches one tab, so every change of the saved
// mode (from the toolbar, or any other writer) is pushed to all Rewind tabs here.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('rewindMode' in changes)) return;
  mode = isMode(changes.rewindMode.newValue) ? changes.rewindMode.newValue : 'archive';
  void ready.then(() => { for (const tabId of sessions.keys()) publish(tabId); });
});

function rememberTab(tabId, session, page, historyTraversal) {
  const entries = session.entries;
  const { index } = session;
  const direction = session.traversalDirection ?? -1;
  delete session.traversalDirection;
  if (historyTraversal) {
    const next = [index + direction, index - direction, index, entries.findLastIndex(item => item.render === page.render)]
      .find(position => entries[position]?.render === page.render);
    if (next !== undefined) session.index = next;
  } else if (current(session)?.render === page.render) {
    entries[index] = page;
  } else {
    entries.splice(index + 1, entries.length, page);
    session.index += 1;
  }
  void chrome.storage.session.set({ [`tab:${tabId}`]: session }).catch(console.warn);
  publish(tabId);
}

// The Retro 95 skin goes only on live pages (Present mode and "not online in 2000" fallbacks),
// never on archive captures. Both calls are issued in the same turn, with no await between
// them, so the stylesheet and the class that activates it land together. retro95.js guards
// against a second run.
function injectSkin(tabId, documentId) {
  skinned.set(tabId, documentId);
  const target = documentId ? { tabId, documentIds: [documentId] } : { tabId };
  return Promise.all([
    chrome.scripting.insertCSS({ target, files: ['skin/retro95.css'], origin: 'USER' }),
    chrome.scripting.executeScript({ target, files: ['skin/retro95.js'], injectImmediately: true }),
  ]).catch(() => {
    if (skinned.get(tabId) === documentId) skinned.delete(tabId);
  });
}

// True for a main-frame commit that must be skinned before its first paint: a Rewind tab opening
// an http(s) page that is not an archive replay (this also excludes home.html, a
// chrome-extension:// page), in Present mode or as the live page of an archive-mode fallback.
// Synchronous on purpose: it only reads in-memory state.
function shouldSkin(details) {
  const session = sessions.get(details.tabId);
  const url = session && RewindURLs.httpURL(details.url); // (archive.js already declares httpURL globally)
  if (!url || url.host === 'web.archive.org') return false;
  if (mode === 'present') return true;
  // Archive mode: the live load that follows "no capture up to the cutoff" is a visit with no
  // capture timestamp. Back/Forward/reload of a live page recorded earlier is skinned too.
  const visit = active.get(details.tabId)?.visit;
  if (visit && !visit.timestamp && matchesVisit(details, visit)) return true;
  return session.entries.findLast(item => item.render === details.url)?.kind === 'live';
}

// End of navigate(): the toolbar. Skinned pages were already skinned at commit; the backstop
// below only catches a live page that was not known to be live then (a page that navigated
// itself in archive mode and turned out to have no capture).
async function inject(tabId, documentId, kind) {
  const target = documentId ? { tabId, documentIds: [documentId] } : { tabId };
  try {
    if (kind === 'live' && !(documentId && skinned.get(tabId) === documentId)) await injectSkin(tabId, documentId);
    await chrome.scripting.insertCSS({ target, files: ['page-layout.css'], origin: 'USER' });
    if (kind === 'archive') {
      await chrome.scripting.insertCSS({ target, files: ['archive-page.css'], origin: 'USER' });
    }
    await chrome.scripting.executeScript({ target, files: scripts });
  } catch {
    // Restricted documents and tabs closed during navigation cannot host content scripts.
  }
}

function sameHost(first, second) {
  const a = URL.parse(first);
  const b = URL.parse(second);
  return Boolean(a && b && a.hostname === b.hostname);
}

function stopRun(tabId) {
  const run = active.get(tabId);
  active.delete(tabId);
  run?.controller.abort();
}

function setProgress(tabId, run, status) {
  run.status = status;
  publish(tabId);
}

function setLocation(url) {
  setTimeout(() => location.replace(url), 0);
}

async function visit(tabId, run, expected, timestamp, replace) {
  const { signal } = run.controller;
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(timestamp ? 13_000 : 18_000)]);
  const { promise, resolve } = Promise.withResolvers();
  const pending = { expected, timestamp, resolve, headers: new Map() };
  run.visit = pending;
  const timeout = () => resolve(null);
  deadline.addEventListener('abort', timeout, { once: true });
  try {
    deadline.throwIfAborted();
    const target = { tabId };
    if (replace) {
      try {
        await chrome.scripting.executeScript({ target, func: setLocation, args: [expected], injectImmediately: true });
      } catch {
        await chrome.tabs.update(tabId, { url: expected });
      }
    } else {
      await chrome.tabs.update(tabId, { url: expected });
    }
    return await promise;
  } finally {
    deadline.removeEventListener('abort', timeout);
    run.visit = null;
  }
}

async function navigate(tabId, original, sourceDocument) {
  stopRun(tabId);
  const session = sessions.get(tabId);
  if (!session) return;

  const previous = current(session);
  if (!sourceDocument && original.hash && previous?.render &&
      withoutHash(previous.original) === withoutHash(original.href)) {
    const setAnchor = hash => { location.hash = hash; };
    await chrome.scripting.executeScript({ target: { tabId }, func: setAnchor, args: [original.hash] });
    return;
  }

  const run = { controller: new AbortController(), sourceDocument };
  active.set(tabId, run);
  const { signal } = run.controller;
  let replace = Boolean(sourceDocument);
  let page;
  let loaded;
  // The mode is read once: a switch while this page loads only affects the next navigation.
  const present = mode === 'present';
  // Clicks inside a site that already had no capture up to the cutoff go straight to the
  // live page: no pointless Wayback wait on every link (or SPA route) of e.g. discord.com.
  const staysLive = !present && previous?.fallback === true && sameHost(previous.original, original.href);
  try {
    if (!present && !staysLive) {
      setProgress(tabId, run, 'Looking up archived captures…');
      try {
        for await (const replay of findReplays(original.href, signal)) {
          setProgress(tabId, run, 'Opening archived page…');
          loaded = await visit(tabId, run, replay.render, replay.timestamp, replace);
          signal.throwIfAborted();
          replace = true;
          if (loaded) {
            const capture = readReplay(loaded.url);
            page = { kind: 'archive', original: capture.original.href, status: captureLabel(capture.timestamp), render: loaded.url };
            break;
          }
        }
      } catch {
        signal.throwIfAborted();
      }
    }
    if (!page) {
      setProgress(tabId, run, 'Opening live page…');
      const tab = sourceDocument && await chrome.tabs.get(tabId);
      loaded = tab?.url === original.href && !tab.pendingUrl
        ? { url: tab.url, documentId: sourceDocument }
        : await visit(tabId, run, original.href, null, replace);
      signal.throwIfAborted();
      if (!loaded) throw new Error('The live page could not be loaded');
      // kind and fallback are stored on the entry so Back/Forward restore them as recorded.
      page = {
        kind: 'live',
        original: loaded.url,
        status: present ? PRESENT_STATUS : FALLBACK_STATUS,
        render: loaded.url,
        fallback: !present,
      };
    }
    const tab = await chrome.tabs.get(tabId);
    signal.throwIfAborted();
    page.title = tab.title || new URL(page.original).hostname;
    active.delete(tabId);
    rememberTab(tabId, session, page, false);
    void rememberPage(page).catch(console.warn);
    await inject(tabId, loaded.documentId, page.kind);
  } catch {
    if (!signal.aborted) {
      active.delete(tabId);
      const errorURL = `${homeURL}?error=${encodeURIComponent(original.href)}`;
      await chrome.tabs.update(tabId, { url: errorURL }).catch(() => {});
    }
  }
}

function matchesVisit(details, pending) {
  if (withoutHash(details.url) === withoutHash(pending.expected)) return true;
  const qualifiers = details.transitionQualifiers ?? [];
  return qualifiers.includes('server_redirect') && !qualifiers.includes('forward_back');
}

function finishReplay(details, pending) {
  const replay = readReplay(details.url);
  const headers = pending.headers.get(withoutHash(details.url));
  const valid = replay?.timestamp === pending.timestamp &&
    (!headers || headers.status === 304 || (headers.status >= 200 && headers.status < 300 && headers.timestamp === pending.timestamp));
  pending.resolve(valid ? details : null);
}

async function committed(details) {
  if (details.frameId !== 0 || !details.documentId) return;
  if (!settled) await ready; // only right after the worker woke up
  // Skin first, before any other await: the page has not painted yet, so the skin is in place
  // for its first frame. Waiting for navigate() (tabs.get, rememberTab, ...) would paint plain.
  if (shouldSkin(details)) void injectSkin(details.tabId, details.documentId);
  await ready;
  const tabId = details.tabId;
  const session = sessions.get(tabId);
  if (!session) return;
  const run = active.get(tabId);
  const backForward = details.transitionQualifiers.includes('forward_back');
  const entry = localPage(details.url);

  if (!backForward && !entry && run?.visit && matchesVisit(details, run.visit)) {
    const pending = run.visit;
    pending.committed = details;
    const response = pending.headers.get(withoutHash(details.url));
    if (!pending.timestamp) pending.resolve(details);
    else if (response?.status >= 400 || readReplay(details.url)?.timestamp !== pending.timestamp) pending.resolve(null);
    return;
  }

  if (entry) {
    stopRun(tabId);
    rememberTab(tabId, session, entry, backForward);
    return;
  }
  const original = destination(details.url);
  if (!original) return;

  const known = session.entries.findLast(item => item.render === details.url);
  if (known && (backForward || details.transitionType === 'reload')) {
    stopRun(tabId);
    rememberTab(tabId, session, known, backForward);
    await inject(tabId, details.documentId, known.kind);
    return;
  }

  if (run && !backForward && details.transitionQualifiers.includes('client_redirect')) return;
  void navigate(tabId, original, details.documentId);
  await inject(tabId, details.documentId);
}

async function withinPage(details, isFragment) {
  if (details.frameId !== 0) return;
  await ready;
  const session = sessions.get(details.tabId);
  const page = session && current(session);
  const original = destination(details.url);
  if (!page || !original || active.has(details.tabId)) return;
  if (!isFragment && withoutHash(page.original) !== withoutHash(original.href)) {
    void navigate(details.tabId, original, details.documentId);
    return;
  }
  const entry = { ...page, original: original.href, render: details.url };
  rememberTab(details.tabId, session, entry, details.transitionQualifiers.includes('forward_back'));
}

chrome.webNavigation.onCommitted.addListener(details => void committed(details).catch(console.warn));
chrome.webNavigation.onReferenceFragmentUpdated.addListener(details => void withinPage(details, true).catch(console.warn));
chrome.webNavigation.onHistoryStateUpdated.addListener(details => void withinPage(details, false).catch(console.warn));
chrome.webNavigation.onDOMContentLoaded.addListener(details => {
  const pending = active.get(details.tabId)?.visit;
  if (details.frameId === 0 && pending?.timestamp && pending.committed?.documentId === details.documentId) {
    finishReplay(details, pending);
  }
});
chrome.webNavigation.onErrorOccurred.addListener(details => {
  const pending = active.get(details.tabId)?.visit;
  if (details.frameId === 0 && pending && (matchesVisit(details, pending) || pending.committed?.documentId === details.documentId)) {
    pending.resolve(null);
  }
});

chrome.webRequest.onHeadersReceived.addListener(details => {
  const pending = active.get(details.tabId)?.visit;
  if (!pending?.timestamp) return;
  const date = details.responseHeaders?.find(header => header.name.toLowerCase() === 'memento-datetime');
  pending.headers.set(withoutHash(details.url), { status: details.statusCode, timestamp: headerTimestamp(date?.value) });
}, { urls: ['https://web.archive.org/web/*'], types: ['main_frame'] }, ['responseHeaders']);

let windowOperation = Promise.resolve();

function queueWindowOperation(operation) {
  windowOperation = windowOperation.then(operation).catch(console.warn);
}

chrome.action.onClicked.addListener(() => queueWindowOperation(async () => {
  const { rewindWindow } = await chrome.storage.session.get('rewindWindow');
  if (rewindWindow !== undefined) {
    const existing = await chrome.windows.get(rewindWindow).catch(() => null);
    if (existing?.type === 'popup') {
      const focused = await chrome.windows.update(rewindWindow, { focused: true }).catch(() => null);
      if (focused) return;
    }
  }
  const popup = await chrome.windows.create({
    url: homeURL, type: 'popup', width: 1280, height: 820, focused: true,
  });
  await chrome.storage.session.set({ rewindWindow: popup.id });
}));

chrome.windows.onRemoved.addListener(windowId => queueWindowOperation(async () => {
  const { rewindWindow } = await chrome.storage.session.get('rewindWindow');
  if (rewindWindow === windowId) await chrome.storage.session.remove('rewindWindow');
}));

function open(tabId, value) {
  const url = destination(value);
  if (url) void navigate(tabId, url).catch(console.warn);
}

// Scripted popups and links that bypass the click listener stay in the Rewind popup.
chrome.webNavigation.onCreatedNavigationTarget.addListener(details => {
  void (async () => {
    await ready;
    if (!sessions.has(details.sourceTabId)) return;
    const source = await chrome.tabs.get(details.sourceTabId);
    const { rewindWindow } = await chrome.storage.session.get('rewindWindow');
    if (source.windowId !== rewindWindow) return;
    await chrome.tabs.remove(details.tabId).catch(() => {});
    open(source.id, details.url);
  })().catch(console.warn);
});

async function publishFullscreen(window) {
  await ready;
  const tabs = await chrome.tabs.query({ windowId: window.id });
  for (const { id: tabId } of tabs) {
    if (!sessions.has(tabId)) continue;
    const message = { type: 'rewind-fullscreen', tabId, fullscreen: window.state === 'fullscreen' };
    void chrome.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => {});
    void chrome.runtime.sendMessage(message).catch(() => {});
  }
}

chrome.windows.onBoundsChanged.addListener(window => void publishFullscreen(window).catch(() => {}));

chrome.tabs.onRemoved.addListener(async tabId => {
  skinned.delete(tabId);
  await ready;
  if (!sessions.delete(tabId)) return;
  stopRun(tabId);
  await chrome.storage.session.remove(`tab:${tabId}`);
});

async function onMessage(message, sender) {
  await ready;
  const tabId = sender.tab?.id;
  if (tabId === undefined || sender.frameId !== 0) return null;
  const local = localPage(sender.url);
  let session = sessions.get(tabId);
  if (!session && local && message.type === 'init') {
    session = newSession(tabId);
    rememberTab(tabId, session, local, false);
  }
  if (!session) return null;
  switch (message.type) {
    case 'init': {
      const window = await chrome.windows.get(sender.tab.windowId).catch(() => null);
      return {
        state: stateFor(tabId, session), history: await readHistory(), css: local ? null : await toolbarCSS,
        fullscreen: window?.state === 'fullscreen',
      };
    }
    case 'fullscreen': {
      const window = await chrome.windows.get(sender.tab.windowId);
      const state = window.state === 'fullscreen' ? 'normal' : 'fullscreen';
      const updated = await chrome.windows.update(window.id, { state });
      void publishFullscreen(updated).catch(() => {});
      return updated.state;
    }
    case 'mode': {
      if (!isMode(message.mode)) return stateFor(tabId, session);
      mode = message.mode;
      // Saved in storage (not just memory): survives the worker sleeping, and the listener
      // above then publishes the new state to every Rewind tab.
      await chrome.storage.local.set({ rewindMode: mode });
      publish(tabId);
      return stateFor(tabId, session);
    }
    case 'history':
      return readHistory();
    case 'clear':
      return updateHistory(() => EMPTY_HISTORY);
    case 'back':
    case 'forward':
      stopRun(tabId);
      publish(tabId);
      session.traversalDirection = message.type === 'back' ? -1 : 1;
      return (message.type === 'back' ? chrome.tabs.goBack(tabId) : chrome.tabs.goForward(tabId)).catch(() => {
        delete session.traversalDirection;
      });
    case 'open':
      open(tabId, message.url);
      break;
    case 'submit': {
      const value = typeof message.value === 'string' ? message.value.trim() : '';
      if (!value) break;
      const url = addressURL(value);
      if (url) {
        void navigate(tabId, url).catch(console.warn);
      } else if (!/^[a-z][a-z+.-]*:\/\//i.test(value)) {
        stopRun(tabId);
        await rememberSearch(value);
        if (mode === 'present') {
          // Today's Google results as a live, skinned page. Result clicks go through
          // destination() in page.js and open as Present pages with no Wayback lookup.
          const search = new URL('https://www.google.com/search');
          search.searchParams.set('q', value);
          void navigate(tabId, search).catch(console.warn);
        } else {
          await chrome.tabs.update(tabId, { url: `${homeURL}?q=${encodeURIComponent(value)}` });
        }
      }
      break;
    }
  }
  return null;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (typeof message?.type !== 'string' || ['rewind-state', 'rewind-fullscreen'].includes(message.type)) return false;
  onMessage(message, sender).then(respond, error => {
    console.warn(error);
    respond(null);
  });
  return true;
});
