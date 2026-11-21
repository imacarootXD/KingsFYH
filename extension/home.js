const { mount, send, matches } = RewindUI;
const workspace = document.querySelector('#workspace');
let searchView;

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

function resultRow({ title, url, description, direct }, location) {
  const row = element('li', '', 'result');
  if (direct) row.dataset.direct = 'true';
  row.append(link(title || url, url), element('small', location || url));
  if (description) row.append(element('p', description));
  return row;
}

function createSearchView(query) {
  const controller = new AbortController();
  const panel = element('section', '', 'panel results');
  const status = element('p', '', 'search-status');
  status.setAttribute('role', 'status');
  const web = element('section');
  web.setAttribute('aria-label', 'Web results');
  const local = element('section', '', 'history-results');
  const content = element('div', '', 'search-content');
  content.append(element('h1', 'Search results'), element('p', `for “${query}”`, 'search-query'), status, web, local);
  panel.append(element('div', 'Search Results - Rewind', 'search-titlebar'), content);

  async function load() {
    status.textContent = 'Searching the web…';
    web.replaceChildren();
    try {
      const { results, provider, source } = await searchWeb(query, controller.signal);
      if (controller.signal.aborted) return;
      status.textContent = results.length ? '' : 'No web results found. Try a different search.';
      if (results.length) {
        const list = element('ul', '', 'result-list');
        for (const result of results) list.append(resultRow(result, new URL(result.url).host));
        const attribution = element('p', '', 'search-source');
        const providerLink = element('a', provider, 'link');
        providerLink.href = source;
        attribution.append('Web results from ', providerLink);
        web.append(list, attribution);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn('[Rewind search]', error);
      status.textContent = 'Web search is unavailable right now.';
      const retry = element('button', 'Try again', 'search-retry');
      retry.type = 'button';
      retry.addEventListener('click', () => void load());
      web.append(retry);
    }
  }

  void load();
  return { query, panel, local, controller };
}

function render(state, history) {
  const live = state.mode === 'live';
  if (state.kind === 'search' && !live) {
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
  const panel = element('section', '', 'panel');
  if (state.kind === 'error') {
    panel.append(element('h1', 'Could not open page'), element('p', 'Check the address or connection and try again.'));
  } else if (state.kind === 'search') {
    panel.append(element('p', 'Search again to use 2026 search.'));
  } else {
    panel.append(element('h1', live ? '2026, the 2000 way' : 'Browse the early web'));
    panel.append(element('p', 'Enter a web address or search the web.'));
    const demo = element('p', 'Try ', 'demo');
    if (live) {
      demo.append(
        link('Wikipedia', 'https://en.wikipedia.org/'), ', ',
        link('Hacker News', 'https://news.ycombinator.com/'), ', or ',
        link('Discord', 'https://discord.com/'), '.',
      );
    } else {
      demo.append(
        link('BBC 1995', 'http://www.bbcnc.org.uk/index.html'), ', ',
        link('Stanford Google', 'http://google.stanford.edu/'), ', ',
        link('Yahoo!', 'http://www.yahoo.com/'), ', or ',
        link('Space Jam', 'http://www.spacejam.com/'), '.',
      );
    }
    panel.append(demo);
  }
  workspace.replaceChildren(panel);
}

void send('init').then(initial => {
  if (initial) mount(document.querySelector('#chrome'), initial, { render, startFocused: initial.state.kind !== 'search' });
});
