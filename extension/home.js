const { mount, send, matches } = RewindUI;
const workspace = document.querySelector('#workspace');
let searchView;
let startView;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function link(label, url) {
  const result = element('a', label, 'link');
  result.href = url;
  result.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void send('open', { url });
  });
  return result;
}

function searchForm(id, query = '') {
  const form = element('form', '', 'page-search');
  form.setAttribute('role', 'search');
  const label = element('label', 'Search the web');
  label.htmlFor = id;
  const field = element('input');
  field.id = id;
  field.type = 'search';
  field.value = query;
  field.autocomplete = 'off';
  if (id === 'start-search') field.placeholder = 'Search the web or enter an address';
  const submit = element('button', 'Search');
  submit.type = 'submit';
  form.append(label, field, submit);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const value = field.value.trim();
    if (value) void send('submit', { value });
  });
  return form;
}

function googleLogo() {
  const logo = element('img', '', 'google-logo');
  logo.src = 'google-classic.png';
  logo.alt = 'Google';
  logo.width = 1192;
  logo.height = 432;
  return logo;
}

function createStartView(present) {
  const panel = element('section', '', 'start-page');
  const wordmark = element('h1', '', 'start-wordmark');
  wordmark.append(googleLogo());
  const links = present ? [
    ['Wikipedia', 'https://en.wikipedia.org/', 'en.wikipedia.org'],
    ['Hacker News', 'https://news.ycombinator.com/', 'news.ycombinator.com'],
    ['Discord', 'https://discord.com/', 'discord.com'],
  ] : [
    ['BBC', 'http://www.bbcnc.org.uk/index.html', 'March 1995'],
    ['Stanford Google prototype', 'http://google.stanford.edu/', '11 Nov 1998'],
    ['Google homepage', 'http://www.google.com/index.html', '1 Oct 1999'],
  ];
  const list = element('ul', '', 'start-shortcuts');
  for (const [title, url, details] of links) {
    const row = element('li');
    const shortcut = link(title, url);
    shortcut.append(element('small', details));
    row.append(shortcut);
    list.append(row);
  }
  panel.append(wordmark);
  if (present) panel.append(element('h2', 'Today, the 2000 way', 'start-mode'));
  panel.append(
    searchForm('start-search'),
    element('h2', present ? 'Live shortcuts' : 'Archived shortcuts'),
    list,
  );
  return { present, panel };
}

function resultRow({ title, url, description, direct }, location) {
  const row = element('li', '', 'result');
  if (direct) row.dataset.direct = 'true';
  row.append(link(title || url, url));
  if (description) row.append(element('p', description));
  row.append(element('small', location || url));
  return row;
}

function createSearchView(query) {
  const controller = new AbortController();
  const panel = element('section', '', 'results');
  const header = element('header', '', 'search-header');
  header.append(googleLogo(), searchForm('results-search', query));
  const summary = element('div', '', 'search-summary');
  const heading = element('h1', `Web search for “${query}”`);
  const count = element('span');
  count.setAttribute('role', 'status');
  summary.append(heading, count);
  const status = element('p', '', 'search-status');
  status.setAttribute('role', 'status');
  const web = element('section');
  web.setAttribute('aria-label', 'Web results');
  const local = element('section', '', 'history-results');
  panel.append(header, summary, status, web, local);

  async function load() {
    count.textContent = '';
    status.dataset.state = 'loading';
    status.textContent = 'Searching the web…';
    web.setAttribute('aria-busy', 'true');
    web.replaceChildren();
    try {
      const { results, provider, source } = await searchWeb(query, controller.signal);
      if (controller.signal.aborted) return;
      status.dataset.state = results.length ? 'ready' : 'empty';
      status.textContent = results.length ? '' : 'No web results found. Try a different search.';
      if (results.length) {
        count.textContent = `${results.length} ${results.length === 1 ? 'result' : 'results'}`;
        const list = element('ul', '', 'result-list');
        for (const result of results) list.append(resultRow(result));
        const attribution = element('p', '', 'search-source');
        const providerLink = element('a', provider, 'link');
        providerLink.href = source;
        attribution.append('Web results from ', providerLink);
        web.append(list, attribution);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn('[Rewind search]', error);
      status.dataset.state = 'error';
      status.textContent = 'Web search is unavailable right now.';
      const retry = element('button', 'Try again', 'search-retry');
      retry.type = 'button';
      retry.addEventListener('click', () => void load());
      web.append(retry);
    } finally {
      web.removeAttribute('aria-busy');
    }
  }

  void load();
  return { query, panel, local, controller };
}

function render(state, history) {
  // A missing state.mode (worker without the mode contract) means archive.
  const present = state.mode === 'present';
  workspace.classList.toggle('classic-search-workspace', state.kind === 'start' || (state.kind === 'search' && !present));
  if (state.kind === 'search' && !present) {
    startView = undefined;
    const query = state.original;
    if (searchView?.query !== query) {
      searchView?.controller.abort();
      searchView = createSearchView(query);
      workspace.replaceChildren(searchView.panel);
    }
    const pages = history.pages.filter(item => matches(item, query));
    searchView.local.replaceChildren();
    if (pages.length) {
      const list = element('ul', '', 'result-list');
      for (const item of pages) list.append(resultRow(item, new URL(item.url).host));
      searchView.local.append(element('h2', 'From Rewind history'), list);
    }
    return;
  }

  searchView?.controller.abort();
  searchView = undefined;
  if (state.kind === 'start') {
    if (startView?.present !== present) {
      const typed = workspace.querySelector('#start-search')?.value;
      startView = createStartView(present);
      workspace.replaceChildren(startView.panel);
      if (typed) workspace.querySelector('#start-search').value = typed;
    }
    return;
  }

  startView = undefined;
  const panel = element('section', '', 'panel');
  if (state.kind === 'error') {
    panel.append(element('h1', 'Could not open page'), element('p', 'Check the address or connection and try again.'));
  } else if (state.kind === 'search') {
    panel.append(element('p', 'Search again to use Present search.'));
  }
  workspace.replaceChildren(panel);
}

void send('init').then(initial => {
  if (!initial) return;
  mount(document.querySelector('#chrome'), initial, { render });
  workspace.querySelector('#start-search')?.focus();
});
