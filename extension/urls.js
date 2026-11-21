(() => {
  function httpURL(value) {
    const url = URL.parse(value);
    return url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url : null;
  }

  function readReplay(value) {
    const url = httpURL(value);
    if (url?.host !== 'web.archive.org') return null;
    const match = /^\/web\/(\d{1,14}\*?|\*)([a-z]+_)?\/(.+)$/i.exec(url.pathname + url.search + url.hash);
    if (!match) return null;
    const [, timestamp, modifier, embedded] = match;
    try {
      const target = /^https?%3a%2f%2f/i.test(embedded) ? decodeURIComponent(embedded) : embedded;
      const original = httpURL(target.startsWith('//') ? `https:${target}` : target)
        ?? (/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(target) ? httpURL(`http://${target}`) : null);
      return original && { timestamp, modifier, original };
    } catch {
      return null;
    }
  }

  function destination(value) {
    let url = readReplay(value)?.original ?? httpURL(value);
    if (!url) return null;
    // Search engines sometimes wrap results in a reporting redirect.
    if (/^(www\.)?google\.com$/.test(url.hostname) && url.pathname === '/url') {
      url = httpURL(url.searchParams.get('url') ?? url.searchParams.get('q')) ?? url;
    }
    if (/(^|\.)duckduckgo\.com$/.test(url.hostname) && url.pathname === '/l/') {
      url = httpURL(url.searchParams.get('uddg')) ?? url;
    }
    return url;
  }

  function addressURL(value) {
    const address = typeof value === 'string' ? value.trim() : '';
    if (!address) return null;
    if (/^https?:\/\//i.test(address)) return destination(address);
    if (/\s/.test(address)) return null;

    const parsed = httpURL(`https://${address}`);
    const host = parsed?.hostname;
    if (!host || !(host === 'localhost' || host.startsWith('[') || /\.[\w-]{2,}\.?$/.test(host) || /^\d+(\.\d+){3}$/.test(address.split(/[/:?#]/)[0]))) {
      return null;
    }
    return destination(parsed);
  }

  function withoutHash(value) {
    return String(value).split('#', 1)[0];
  }

  globalThis.RewindURLs = { httpURL, readReplay, destination, addressURL, withoutHash };
})();
