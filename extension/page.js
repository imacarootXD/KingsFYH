(() => {
  if (globalThis.rewindMounted) return;
  globalThis.rewindMounted = true;
  const { destination, withoutHash } = RewindURLs;
  const { mount, send } = RewindUI;

  void send('init').then(initial => {
    if (!initial || document.documentElement?.localName !== 'html') return;
    const host = document.createElement('rewind-toolbar');
    const shadow = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(initial.css);
    shadow.adoptedStyleSheets = [sheet];
    mount(shadow, initial);
    document.documentElement.append(host);

    document.addEventListener('click', event => {
      if (!event.isTrusted || event.defaultPrevented || event.button !== 0 ||
          event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const path = event.composedPath();
      if (path.includes(host)) return;
      const link = path.find(node => node instanceof Element && node.matches('a[href], area[href]'));
      const targetFrame = link?.getAttribute('target')?.toLowerCase() ?? '';
      if (!link || link.hasAttribute('download') || !['', '_self', '_top', '_parent', '_blank'].includes(targetFrame)) return;

      const href = link.getAttribute('href');
      if (href.startsWith('#')) return;
      const target = destination(link.href?.baseVal ? new URL(link.href.baseVal, location.href) : link.href);
      if (!target) return;
      const current = destination(location.href);
      const samePageAnchor = target.hash && withoutHash(target) === withoutHash(current);
      if (samePageAnchor && withoutHash(link.href) === withoutHash(location.href)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      if (samePageAnchor) location.hash = target.hash;
      else void send('open', { url: target.href });
    }, true);
  }).catch(() => {});
})();
