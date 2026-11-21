const { httpURL, readReplay } = RewindURLs;
const CDX_URL = 'https://web.archive.org/cdx/search/cdx';
const REPLAY_ORIGIN = 'https://web.archive.org';
const timestampPattern = /^\d{14}$/;
const INDEX_TIMEOUT = 12_000;
const REPLAY_TIMEOUT = 5_000;

async function indexPage(original, range, resumeKey, signal) {
  const endpoint = new URL(CDX_URL);
  const target = new URL(original);
  target.hash = '';
  endpoint.search = new URLSearchParams({
    url: target.href,
    output: 'json',
    fl: 'timestamp,original',
    filter: 'statuscode:2[0-9][0-9]',
    collapse: 'timestamp:14',
    limit: '24',
    showResumeKey: 'true',
    ...range,
  });
  if (resumeKey) endpoint.searchParams.set('resumeKey', resumeKey);
  const options = {
    credentials: 'omit',
    signal: AbortSignal.any([signal, AbortSignal.timeout(INDEX_TIMEOUT)]),
  };
  let response;
  try {
    response = await fetch(endpoint, options);
  } catch (error) {
    if (!(error instanceof TypeError) || options.signal.aborted) throw error;
    response = await fetch(endpoint, options);
  }
  if (!response.ok) throw new Error(`Wayback index returned ${response.status}`);
  const rows = await response.json();
  const captures = rows.slice(1).filter(([timestamp, url]) => timestampPattern.test(timestamp) && httpURL(url));
  captures.sort(([first], [second]) => first.localeCompare(second));
  return { captures, next: rows.at(-1)?.length === 1 ? rows.at(-1)[0] : undefined };
}

function headerTimestamp(headers) {
  const date = new Date(headers);
  return headers && Number.isFinite(date.valueOf())
    ? date.toISOString().slice(0, 19).replace(/\D/g, '') : null;
}

async function checkReplay(timestamp, url, hash, signal) {
  try {
    const response = await fetch(`${REPLAY_ORIGIN}/web/${timestamp}/${url}`, {
      credentials: 'omit',
      signal: AbortSignal.any([signal, AbortSignal.timeout(REPLAY_TIMEOUT)]),
    });
    void response.body?.cancel().catch(() => {});
    const replay = readReplay(response.url);
    if (!response.ok || replay?.modifier || replay?.timestamp !== timestamp ||
        headerTimestamp(response.headers.get('memento-datetime')) !== timestamp) return null;

    const render = new URL(response.url);
    render.hash = hash;
    return { original: replay.original.href + render.hash, render: render.href, timestamp };
  } catch (error) {
    signal.throwIfAborted();
    return null;
  }
}

async function* findReplays(original, signal) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(26_000)]);
  const ranges = [{ from: '1995', to: '1995' }, {}];
  const seen = new Set();
  const hash = new URL(original).hash;

  for (const range of ranges) {
    let cursor;
    do {
      const { captures, next } = await indexPage(original, range, cursor, deadline);
      for (const [timestamp, url] of captures) {
        const key = timestamp + ' ' + url;
        if (seen.has(key)) continue;
        seen.add(key);
        const replay = await checkReplay(timestamp, url, hash, deadline);
        if (replay) yield replay;
      }
      if (!next || next === cursor) break;
      cursor = next;
    } while (true);
  }
}

function captureLabel(timestamp) {
  return `Archived · ${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
}
