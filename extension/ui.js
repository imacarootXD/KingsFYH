(() => {
  const send = (type, details = {}) => chrome.runtime.sendMessage({ type, ...details });

  const markup = `
    <header class="toolbar" aria-label="Rewind browser toolbar">
      <div class="titlebar">
        <strong class="brand">Rewind</strong>
        <div class="titlebar-actions">
          <div class="mode-toggle" role="group" aria-label="Browsing mode">
            <button type="button" data-mode="archive" aria-pressed="true" aria-label="Back to 2000" title="Back to 2000: real pages from the archive"><span class="mode-year">2000</span><span class="mode-year-short" aria-hidden="true">00</span></button>
            <button type="button" data-mode="live" aria-pressed="false" aria-label="2026 in 2000" title="2026 in 2000: today's web, retro style"><span class="mode-year">2026</span><span class="mode-year-short" aria-hidden="true">26</span></button>
          </div>
          <span id="status" class="status" data-kind="start" role="status"><span class="status-text">Ready</span></span>
          <button id="fullscreen" class="fullscreen-toggle" type="button" aria-pressed="false" aria-label="Toggle full screen" title="Full screen (Esc to exit)">⛶</button>
        </div>
      </div>
      <form id="navigation" class="navigation">
        <button id="back" type="button" disabled><span class="arrow arrow-back" aria-hidden="true"></span>Back</button>
        <button id="forward" type="button" disabled><span class="arrow" aria-hidden="true"></span>Forward</button>
        <span class="divider" aria-hidden="true"></span>
        <label for="address">Address</label>
        <div class="field">
          <input id="address" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="suggestions" autocomplete="off" spellcheck="false" placeholder="Type a web address or search">
          <ul id="suggestions" class="suggestions" role="listbox" aria-label="History suggestions" hidden></ul>
        </div>
        <button type="submit" class="go">Go</button>
        <button type="button" id="clear" class="clear">Clear history</button>
      </form>
    </header>`;

  function matches(entry, query) {
    const text = `${entry.title ?? ''} ${entry.url ?? ''} ${entry.query ?? ''}`.toLowerCase();
    return query.toLowerCase().trim().split(/\s+/).every(part => text.includes(part));
  }

  function mount(root, initial, { render = () => {}, startFocused = false } = {}) {
    const template = document.createElement('template');
    template.innerHTML = markup;
    root.append(template.content);
    const get = id => root.querySelector('#' + id);
    const address = get('address');
    const form = get('navigation');
    const status = get('status');
    const statusText = status.querySelector('.status-text');
    const fullscreenButton = get('fullscreen');
    const modeButtons = root.querySelectorAll('.mode-toggle button');
    const back = get('back');
    const forward = get('forward');
    const clear = get('clear');
    const listbox = get('suggestions');
    let { state, history } = initial;
    let options = [];
    let selected = -1;
    let showRecent = true;
    let dismissed = false;
    let focused = false;
    let notice;
    let modeRequest = 0;
    let changingFullscreen = false;

    function showFullscreen(fullscreen) {
      fullscreenButton.setAttribute('aria-pressed', String(fullscreen));
    }

    async function toggleFullscreen() {
      if (changingFullscreen) return;
      changingFullscreen = true;
      try {
        const state = await send('fullscreen');
        if (state === 'fullscreen' || state === 'normal') showFullscreen(state === 'fullscreen');
      } catch (error) {
        console.warn('[Rewind fullscreen]', error);
      } finally {
        changingFullscreen = false;
      }
    }

    function choose(item) {
      dismiss();
      if (item.url) void send('open', { url: item.url });
      else void send('submit', { value: item.query });
    }

    function select(index) {
      selected = index;
      [...listbox.children].forEach((element, position) => {
        element.setAttribute('aria-selected', String(position === selected));
      });
      if (selected === -1) address.removeAttribute('aria-activedescendant');
      else {
        const item = listbox.children[selected];
        address.setAttribute('aria-activedescendant', item.id);
        item.scrollIntoView({ block: 'nearest' });
      }
    }

    function suggestions() {
      const query = showRecent ? '' : address.value;
      const pages = history.pages.filter(item => matches(item, query)).slice(0, 5);
      const searches = history.searches.filter(item => matches(item, query)).slice(0, 3);
      options = [...pages, ...searches];
      const visible = focused && !dismissed && options.length > 0;
      listbox.replaceChildren();
      for (const [index, item] of options.entries()) {
        const element = document.createElement('li');
        element.id = `suggestion-${index}`;
        element.setAttribute('role', 'option');
        const title = document.createElement('span');
        const description = document.createElement('small');
        title.textContent = item.title ?? item.query;
        description.textContent = item.url ?? 'Previous search';
        element.append(title, description);
        element.addEventListener('mousedown', event => event.preventDefault());
        element.addEventListener('click', () => choose(item));
        listbox.append(element);
      }
      listbox.hidden = !visible;
      address.setAttribute('aria-expanded', String(visible));
      select(-1);
    }

    function dismiss() {
      dismissed = true;
      listbox.hidden = true;
      address.setAttribute('aria-expanded', 'false');
      select(-1);
    }

    function refresh() {
      void send('history').then(latest => {
        if (!latest || JSON.stringify(latest) === JSON.stringify(history)) return;
        history = latest;
        suggestions();
      });
    }

    function update(next) {
      const changed = state.original !== next.original || state.kind !== next.kind || state.waiting !== next.waiting;
      if (changed && !next.waiting) address.value = next.original ?? '';
      state = next;
      const mode = next.mode === 'live' ? 'live' : 'archive';
      for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
      statusText.textContent = next.status;
      status.dataset.kind = mode === 'live' ? 'live' : next.waiting ? 'loading' : next.kind ?? 'start';
      status.toggleAttribute('data-fallback', next.fallback === true);
      back.disabled = !next.canGoBack;
      forward.disabled = !next.canGoForward;
      render(state, history);
    }

    address.value = state.original ?? '';
    showFullscreen(initial.fullscreen === true);
    update(state);
    chrome.runtime.onMessage.addListener(message => {
      if (message.type === 'rewind-state' && message.state.tabId === state.tabId) {
        clearTimeout(notice);
        update(message.state);
      }
      if (message.type === 'rewind-fullscreen' && message.tabId === state.tabId) {
        showFullscreen(message.fullscreen);
      }
    });
    fullscreenButton.addEventListener('click', () => void toggleFullscreen());
    window.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.repeat ||
          fullscreenButton.getAttribute('aria-pressed') !== 'true') return;
      event.preventDefault();
      void toggleFullscreen();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      const mode = changes.rewindMode?.newValue;
      if (area === 'local' && (mode === 'archive' || mode === 'live') && mode !== state.mode) {
        update({ ...state, mode });
      }
    });
    for (const button of modeButtons) {
      button.addEventListener('click', async () => {
        const { mode } = button.dataset;
        const request = ++modeRequest;
        try {
          const next = await send('mode', { mode });
          if (request === modeRequest && next?.mode === mode && next.tabId === state.tabId) {
            clearTimeout(notice);
            update(next);
          }
        } catch (error) {
          console.warn('[Rewind mode]', error);
        }
      });
    }
    window.addEventListener('pageshow', event => {
      if (!event.persisted) return;
      void send('init').then(latest => {
        if (!latest) return;
        history = latest.history;
        showFullscreen(latest.fullscreen === true);
        update(latest.state);
      });
    });

    address.addEventListener('focus', () => {
      focused = true;
      dismissed = false;
      showRecent = address.value === (state.original ?? '');
      suggestions();
      refresh();
    });
    address.addEventListener('blur', () => {
      focused = false;
      dismiss();
    });
    address.addEventListener('input', () => {
      showRecent = false;
      dismissed = false;
      suggestions();
    });
    address.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !listbox.hidden) {
        event.preventDefault();
        dismiss();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (listbox.hidden) {
          dismissed = false;
          suggestions();
        }
        if (listbox.hidden) return;
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        select(selected === -1 && step < 0 ? options.length - 1 : (selected + step + options.length) % options.length);
      } else if (event.key === 'Enter' && selected >= 0 && !listbox.hidden) {
        event.preventDefault();
        choose(options[selected]);
      }
    });

    form.addEventListener('submit', event => {
      event.preventDefault();
      dismiss();
      if (address.value.trim()) void send('submit', { value: address.value });
    });
    back.addEventListener('click', () => void send('back'));
    forward.addEventListener('click', () => void send('forward'));
    clear.addEventListener('click', async () => {
      const latest = await send('clear');
      if (!latest) return;
      history = latest;
      suggestions();
      render(state, history);
      statusText.textContent = 'History cleared';
      clearTimeout(notice);
      notice = setTimeout(() => { statusText.textContent = state.status; }, 2300);
    });

    if (startFocused) address.focus();
  }

  globalThis.RewindUI = { mount, send, matches };
})();
