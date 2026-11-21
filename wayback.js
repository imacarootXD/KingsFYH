const AVAILABILITY_URL = 'https://archive.org/wayback/available';
// Query the midpoint so a capture anywhere in 1995–1999 can be the closest match.
const MIDPOINT = '19970702';

function httpURL(value) {
  const url = URL.parse(value);
  if (url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
    return url;
  }
  return null;
}

function readReplay(url) {
  if (url?.host !== 'web.archive.org') return null;

  const match = /^\/web\/(\d{1,14}\*?|\*)(?:[a-z]+_)?\/(.+)$/i.exec(
    url.pathname + url.search + url.hash,
  );
  if (!match) return null;

  const [, timestamp, embedded] = match;
  try {
    const target = /^https?%3a%2f%2f/i.test(embedded) ? decodeURIComponent(embedded) : embedded;
    const original = httpURL(target.startsWith('//') ? `https:${target}` : target);
    return original && { timestamp, original };
  } catch {
    return null;
  }
}

function originalURL(value) {
  const url = httpURL(value);
  return readReplay(url)?.original ?? url;
}

function addressURL(value) {
  if (typeof value !== 'string' || !value.trim()) return null;

  const address = value.trim();
  const hasScheme = /^[a-z][\w+.-]*:/i.test(address);
  const hasHostPort = /^(?:localhost|[\w.-]+\.[\w.-]+):\d+(?=[/?#]|$)/i.test(address);
  return originalURL(hasScheme && !hasHostPort ? address : `https://${address}`);
}

function isNineties(timestamp) {
  return /^199[5-9]\d{10}$/.test(timestamp);
}

async function findSnapshot(original, signal) {
  const destination = new URL(original);
  destination.hash = '';
  const endpoint = new URL(AVAILABILITY_URL);
  endpoint.search = new URLSearchParams({ url: destination.href, timestamp: MIDPOINT });

  try {
    const response = await fetch(endpoint, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(4_000)]),
    });
    if (!response.ok) return null;

    const { archived_snapshots } = await response.json();
    const closest = archived_snapshots?.closest;
    if (!closest?.available || !isNineties(closest.timestamp)) return null;

    const replayURL = httpURL(closest.url);
    if (readReplay(replayURL)?.timestamp !== closest.timestamp) return null;

    replayURL.protocol = 'https:';
    replayURL.hash = original.hash;
    return replayURL;
  } catch {
    return null;
  }
}

module.exports = { addressURL, findSnapshot, httpURL, isNineties, originalURL, readReplay };
