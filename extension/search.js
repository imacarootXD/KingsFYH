const WEB_SEARCH_SOURCE = 'https://wiby.me/';

function searchText(value) {
  if (typeof value !== 'string') return '';
  // Wiby returns HTML entities in text fields. Decode them without parsing tags.
  const template = document.createElement('template');
  template.innerHTML = value.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return template.content.textContent.replace(/\s+/g, ' ').trim();
}

function rankResults(results, query) {
  if (!results.length) return results;
  const normalized = query.trim().toLowerCase();
  const terms = normalized.split(/\s+/);
  const seenURLs = new Set();
  const seenTitles = new Set();
  const ranked = [];

  if (/^[a-z0-9-]+$/i.test(query.trim())) {
    const host = `${query.trim()}.com`;
    results.unshift({ url: `http://${host}/`, title: host, description: 'Go to the site directly', direct: true });
  }

  for (const result of results) {
    const url = new URL(result.url);
    const key = url.origin + url.pathname.replace(/\/+$/, '') + url.search;
    const title = result.title.toLowerCase();
    const siteTitle = `${url.hostname}\n${title}`;
    if (seenURLs.has(key) || seenTitles.has(siteTitle)) continue;

    seenURLs.add(key);
    seenTitles.add(siteTitle);
    let score = 0;
    if (result.direct) score = 3;
    else if (url.hostname.includes(normalized)) score = 2;
    else if (terms.every(term => title.includes(term))) score = 1;
    ranked.push({ result, score });
  }

  return ranked.sort((first, second) => second.score - first.score).map(({ result }) => result);
}

async function searchWeb(query, signal) {
  const url = new URL('json/', WEB_SEARCH_SOURCE);
  url.searchParams.set('q', query);
  const response = await fetch(url, {
    credentials: 'omit',
    signal: AbortSignal.any([signal, AbortSignal.timeout(9_000)]),
  });
  if (!response.ok) throw new Error(`Wiby returned HTTP ${response.status}`);

  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('Unexpected search response');

  const results = [];
  for (const row of rows) {
    const resultURL = URL.parse(row?.URL);
    if (!resultURL || !['http:', 'https:'].includes(resultURL.protocol) ||
        resultURL.username || resultURL.password) continue;

    results.push({
      url: resultURL.href,
      title: searchText(row.Title) || resultURL.host,
      description: searchText(row.Description) || searchText(row.Snippet),
    });
  }
  return { results: rankResults(results, query), provider: 'Wiby', source: WEB_SEARCH_SOURCE };
}
