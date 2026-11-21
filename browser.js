const { readFileSync } = require('node:fs');
const path = require('node:path');
const { addressURL, findSnapshot, httpURL, isNineties, originalURL, readReplay } = require('./wayback');

const retroCSS = readFileSync(path.join(__dirname, 'retro.css'), 'utf8');
const LIVE_LABEL = 'Live page · 1995 style';

function archiveLabel(timestamp) {
  const date = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
  return `Archived · ${date}`;
}

async function loadPage(contents, url, signal, timeout) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
  deadline.throwIfAborted();

  let responseCode = null;
  const recordResponse = (_event, _url, code) => { responseCode = code; };
  const stopped = Promise.withResolvers();
  const stop = () => {
    stopped.reject(deadline.reason);
    if (!contents.isDestroyed()) contents.stop();
  };

  contents.on('did-navigate', recordResponse);
  deadline.addEventListener('abort', stop, { once: true });
  try {
    await Promise.race([contents.loadURL(url.href), stopped.promise]);
    deadline.throwIfAborted();
    const rendered = httpURL(contents.getURL());
    if (!rendered) throw new Error('No web page was loaded');
    return { rendered, responseCode };
  } finally {
    deadline.removeEventListener('abort', stop);
    contents.off('did-navigate', recordResponse);
  }
}

function createBrowser(view, publish) {
  const contents = view.webContents;
  const history = [];
  let index = -1;
  let active;
  let state = { address: '', kind: 'start', status: 'Ready' };

  function show(kind, status, address) {
    state = { address, kind, status, canGoBack: index > 0, canGoForward: index < history.length - 1 };
    publish(state);
  }

  function commit(page, targetIndex) {
    if (targetIndex === undefined) {
      index += 1;
      history.splice(index, history.length - index, page);
    } else {
      index = targetIndex;
      history[index] = page;
    }

    view.setVisible(page.kind !== 'error');
    show(page.kind, page.status, page.original.href);
  }

  async function navigate(original, targetIndex) {
    active?.abort();
    active = new AbortController();
    const { signal } = active;
    const previous = history[targetIndex];
    view.setVisible(false);

    try {
      let snapshot;
      if (previous) {
        if (previous.kind === 'archive') snapshot = previous.rendered;
      } else {
        show('loading', 'Looking up a 1990s capture…', original.href);
        snapshot = await findSnapshot(original, signal);
      }
      signal.throwIfAborted();

      if (snapshot) {
        show('loading', 'Opening archived page…', original.href);
        try {
          const { rendered, responseCode } = await loadPage(contents, snapshot, signal, 15_000);
          const replay = readReplay(rendered);
          const loaded = responseCode === null || (responseCode >= 200 && responseCode < 300);
          if (loaded && isNineties(replay?.timestamp)) {
            commit({ kind: 'archive', status: archiveLabel(replay.timestamp), original: replay.original, rendered }, targetIndex);
            return;
          }
        } catch {
          signal.throwIfAborted();
        }
      }

      show('loading', 'Opening live page…', original.href);
      const { rendered } = await loadPage(contents, original, signal, 20_000);
      await contents.insertCSS(retroCSS, { cssOrigin: 'user' });
      signal.throwIfAborted();
      commit({ kind: 'live', status: LIVE_LABEL, original: rendered, rendered }, targetIndex);
    } catch {
      if (!signal.aborted) {
        commit({ kind: 'error', status: 'Could not open page', original }, targetIndex);
      }
    } finally {
      if (!signal.aborted) active = undefined;
    }
  }

  function open(destination) {
    const current = history[index];
    if (!active && current?.rendered && destination.href.includes('#') &&
        destination.href.split('#')[0] === current.original.href.split('#')[0]) {
      // Some Wayback links wrap a fragment in a different replay URL. Keep the current document.
      const anchor = new URL(current.rendered);
      anchor.hash = destination.hash;
      if (anchor.href !== current.rendered.href) void contents.loadURL(anchor.href).catch(() => {});
      return;
    }
    void navigate(destination);
  }

  contents.on('will-navigate', (event) => {
    event.preventDefault();
    // The view is hidden while loading. Ignore automatic navigations from that document.
    if (active) return;
    const destination = originalURL(event.url);
    if (destination) open(destination);
  });

  contents.on('will-redirect', (event) => {
    if (event.isMainFrame && !httpURL(event.url)) event.preventDefault();
  });

  contents.on('will-prevent-unload', (event) => event.preventDefault());

  contents.setWindowOpenHandler(({ url, postBody }) => {
    const destination = originalURL(url);
    if (destination && !active && !postBody) queueMicrotask(() => open(destination));
    return { action: 'deny' };
  });

  contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    const current = history[index];
    if (!isMainFrame || active || !current?.rendered || url === current.rendered.href) return;

    const rendered = httpURL(url);
    if (!rendered) return;
    const original = current.kind === 'archive' ? (readReplay(rendered)?.original ?? current.original) : rendered;
    commit({ ...current, original, rendered });
  });

  return {
    getState: () => state,
    submit(value) {
      const destination = addressURL(value);
      if (destination) open(destination);
      else show(state.kind, 'Enter a valid HTTP or HTTPS address', state.address);
    },
    travel(offset) {
      const targetIndex = index + offset;
      const target = history[targetIndex];
      if (target) void navigate(target.original, targetIndex);
    },
    close() {
      active?.abort();
      if (!contents.isDestroyed()) contents.close();
    },
  };
}

module.exports = { createBrowser };
