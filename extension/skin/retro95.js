// Retro 95 skin for Rewind's Present mode and fallback pages.
// Adapted from retro95/content.js. worker.js injects this file (plus
// retro95.css) with chrome.scripting, only into pages opened in Present mode
// and into "not online in 2000" fallback pages. Archive pages never get it.
//
// What changed from the standalone extension:
// - No saved on/off state, no messages, no popup: injecting the file turns the
//   skin on. Wrapped in a function and guarded, because executeScript runs
//   files in a shared global scope (a second run must not redeclare anything
//   or start a second set of timers).
// - No title bar, taskbar or Start menu of its own: Rewind's 88px toolbar
//   (<rewind-toolbar>, appended to <html> by page.js) replaces them.
// - Pinned page elements are pushed below that 88px toolbar.
// - The toolbar is never scanned, tagged or restyled.
// - worker.js injects this at navigation commit, before the page's first paint
//   (retro95.css is inserted at the same moment). So the class goes on <html>
//   as the very first statement, and everything heavy (scans, the contrast
//   pass, observers, timers) waits until the DOM exists.
(() => {
  // Switches the skin on. Idempotent, so it is fine before the double-injection guard.
  document.documentElement?.classList.add('retro95');
  if (globalThis.__retro95Loaded) return;
  globalThis.__retro95Loaded = true;

  let root = document.documentElement; // null only if injected before the parser created <html>
  // Rewind's toolbar host. It is a child of <html>, outside <body>, so the
  // scans below never reach it; the explicit checks cover elementsFromPoint,
  // which does return it (it is a fixed layer over the top 88px).
  const TOOLBAR = 'rewind-toolbar';
  const TOOLBAR_H = 88; // keep in sync with .toolbar in toolbar.css and page-layout.css
  // Google Search gets a few extra fixes; retro95.css scopes them to this marker
  // so nothing changes on other sites.
  const onGoogle = /^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(location.hostname);

  function apply() {
    root = document.documentElement;
    if (!root) { // injected before <html> exists: nothing can paint yet, so wait for it
      new MutationObserver((_, observer) => {
        if (!document.documentElement) return;
        observer.disconnect();
        apply();
      }).observe(document, { childList: true });
      return;
    }
    root.classList.add('retro95');
    if (onGoogle) root.setAttribute('data-retro95-site', 'google');
    console.debug('[Rewind skin] applied', document.readyState);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startScans, { once: true });
    else startScans();
  }

  // Everything heavy: runs once the DOM exists, never at injection time.
  let scansStarted = false;
  function startScans() {
    if (scansStarted) return;
    scansStarted = true;
    watchDom(true);
    queueContrast();
    scanPage();
    // Re-scan every second (late banners, bars wiped by the site) and 150ms after scrolling/resizing.
    setInterval(scanPage, 1000);
    addEventListener('scroll', queueScan, { passive: true, capture: true });
    addEventListener('resize', queueScan, { passive: true });
    // Contrast pass: after load, and 300ms after scrolling stops (new things come into view).
    addEventListener('load', () => queueContrast(0));
    addEventListener('scroll', () => {
      clearTimeout(scrollEndTimer);
      scrollEndTimer = setTimeout(() => queueContrast(0), 300);
    }, { passive: true, capture: true });
    // Pictures finishing loading (lazy images) can put existing text on a photo.
    document.addEventListener('load', (e) => {
      if (e.target && MEDIA.test(e.target.tagName) && root.classList.contains('retro95')) { mediaGen++; queueContrast(); }
    }, true);
  }

  // CSS can't select by computed position or "has no text", so this scan tags
  // elements and retro95.css does the styling:
  // - data-retro95-float on fixed/sticky layers (headers, cookie bars,
  //   banners): they get a solid face (the skin makes backgrounds transparent)
  //   and the ones pinned to the top are moved below Rewind's toolbar. Value =
  //   "fixed-top" | "sticky-top" | "" (pinned elsewhere: solid face only).
  //   Skips huge layers (invisible full-screen overlays) and empty ones.
  // - data-retro95-bare on buttons with no text (icon/hidden buttons), so they
  //   don't turn into empty bevelled boxes.
  // Re-checked every second and shortly after scrolling, because sites switch
  // headers to fixed/sticky as you scroll.
  function scanPage() {
    if (!root.classList.contains('retro95') || !document.body) return;
    const maxArea = innerWidth * innerHeight * 0.6;
    for (const el of document.body.getElementsByTagName('*')) {
      if (el.localName === TOOLBAR) continue;
      if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
        setAttr(el, 'data-retro95-bare', el.textContent.trim() ? null : '');
      }
      const cs = getComputedStyle(el);
      let tag = null;
      if (cs.position === 'fixed' || cs.position === 'sticky') {
        const r = el.getBoundingClientRect();
        if (r.width * r.height < maxArea && el.textContent.trim()) tag = pinnedEdge(el, cs);
      }
      setAttr(el, 'data-retro95-float', tag);
    }
  }

  function pinnedEdge(el, cs) {
    const t = parseFloat(cs.top); // NaN for "auto"
    if (cs.position === 'sticky') {
      const cur = el.getAttribute('data-retro95-float'); // retro95.css already moved it
      return t < TOOLBAR_H || (cur === 'sticky-top' && t === TOOLBAR_H) ? 'sticky-top' : '';
    }
    // Fixed: moved with margins, so top reads the same after we move it.
    // Move everything pinned in the top part of the screen, not just top:0,
    // so stacked headers keep their order (apple.com: banner at top:0, nav at top:70px).
    return t < innerHeight * 0.4 ? 'fixed-top' : '';
  }

  // Only touch the DOM when the value changes (sites may watch attributes).
  function setAttr(el, name, value) {
    const cur = el.getAttribute(name);
    if (value === null) { if (cur !== null) el.removeAttribute(name); }
    else if (cur !== value) el.setAttribute(name, value);
  }


  let scanQueued = false;
  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    setTimeout(() => { scanQueued = false; scanPage(); }, 150);
  }

  // ---------- Contrast pass ----------
  // The skin forces black text, so anything still dark underneath it is
  // unreadable. For VISIBLE elements only, tag (retro.css styles the tags):
  // - data-retro95-panel: has text and a dark background (luminance < 0.35),
  //   e.g. an AI answer box -> grey raised panel, black text.
  // - data-retro95-chip: has its own text and sits on a photo/video/canvas or
  //   a background image -> solid grey chip behind the text.
  // - data-retro95-flat: a fade (gradient background or gradient mask) on the
  //   element or its ::before/::after -> removed. Image masks are kept: sites
  //   draw icons with them.
  // - data-retro95-iconbtn: a button with no text that is still dark (itself
  //   or an inner disc) -> grey bevelled button, black icon.
  // Tags are only ever added (removing them would flip-flop, since the tag
  // itself changes what we measure). Runs after load, at most once per 500ms
  // after DOM changes, and 300ms after scrolling stops.
  const MEDIA = /^(IMG|VIDEO|CANVAS|PICTURE|svg)$/;
  const ICONISH = /icon|logo/i;
  const pseudoChecked = new WeakSet(); // ::before/::after rarely change
  const chipChecked = new WeakMap();   // element -> position (+ mediaGen) it was last checked at
  let mediaGen = 0; // bumped when pictures load/change, so "not over a picture" gets re-checked
  let colorCanvas = null;

  // "rgb(a)/oklch/..." -> relative luminance 0..1, or null if mostly transparent.
  function luminance(color) {
    let m = /^rgba?\(/.test(color) ? color.match(/[\d.]+/g).map(Number) : null;
    if (!m) { // other colour spaces: let a 1px canvas convert it
      colorCanvas = colorCanvas || document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      colorCanvas.clearRect(0, 0, 1, 1);
      colorCanvas.fillStyle = 'rgba(0, 0, 0, 0)'; // not a colour ("none", "url(...)") -> stays transparent -> null
      colorCanvas.fillStyle = color;
      colorCanvas.fillRect(0, 0, 1, 1);
      const d = colorCanvas.getImageData(0, 0, 1, 1).data;
      m = [d[0], d[1], d[2], d[3] / 255];
    }
    if (m.length > 3 && m[3] < 0.5) return null;
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
  }

  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());

  // A point on the element's own first line of text. Not the box centre: text
  // flows around floated images that sit inside the box (Wikipedia figures).
  function textPoint(el) {
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const q = [...range.getClientRects()].find((q) => q.width > 1 && q.height > 1);
      if (q) return { x: q.left + Math.min(q.width / 2, 40), y: q.top + q.height / 2 };
    }
    return null;
  }

  // Is this element's text drawn over a picture? Walks everything at a point on
  // the text, top to bottom, looking through transparent layers (e.g. a
  // whole-card link on top). The element itself is often missing from the
  // stack: card text tends to be pointer-events:none (apple.com's tiles).
  // First thing that paints decides: a picture -> true, a solid colour -> false.
  function overPicture(el) {
    const p = textPoint(el);
    if (!p || p.x < 0 || p.y < 0 || p.x >= innerWidth || p.y >= innerHeight) return false;
    for (const e of document.elementsFromPoint(p.x, p.y)) {
      if (e === el || el.contains(e)) continue; // the text itself
      if (e.localName === TOOLBAR) continue; // Rewind's fixed toolbar is not part of the page
      if (e === document.body || e === root) return false;
      if (MEDIA.test(e.tagName)) return true;
      const es = getComputedStyle(e);
      if (/url\(/.test(es.backgroundImage)) return true;
      if (luminance(es.backgroundColor) !== null) return false; // solid background: fine
    }
    return false;
  }

  // ---------- Google Search extras (only when onGoogle) ----------
  const GOOGLE_LOGO = '#logo, a[aria-label="Go to Google Home"]';

  // Google's own divider under the tab row: a thin, wide element with a bottom
  // border right below the tab list. retro.css draws one full-width line
  // instead and hides these. Found by position and shape, not by Google's
  // (scrambled, changing) class names.
  function googleOldTabLines() {
    const list = [...document.querySelectorAll('[role="navigation"] [role="list"]')] // the visible (tallest) tab list
      .filter((l) => l.querySelectorAll('[role="listitem"]').length >= 3)
      .sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
    if (!list) return [];
    const area = document.getElementById('cnt') || document.body;
    const tabsBottom = list.getBoundingClientRect().bottom;
    const minWidth = area.getBoundingClientRect().width * 0.6;
    const found = [];
    for (const e of area.getElementsByTagName('*')) {
      if (e.hasAttribute('data-retro95-oldline') || e.contains(list)) continue;
      const r = e.getBoundingClientRect();
      if (r.width < minWidth || r.height > 4 || Math.abs(r.bottom - tabsBottom) > 12) continue;
      const cs = getComputedStyle(e);
      if (parseFloat(cs.borderBottomWidth) > 0 && cs.borderBottomStyle !== 'none') found.push(e);
    }
    return found;
  }

  // Wrappers between the tab row and #cnt that clip their overflow would cut off
  // the full-width line retro.css draws from a narrow tab row (AI Mode).
  // Found by computed style, not class names.
  function googleClippingWrappers() {
    const row = [...document.querySelectorAll('#cnt div')] // the visible (tallest) tab row
      .filter((d) => d.matches(':has(> [role="navigation"] [role="list"] [role="listitem"])'))
      .sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
    const cnt = document.getElementById('cnt');
    const found = [];
    for (let e = row && row.parentElement; e && e !== cnt && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (!e.hasAttribute('data-retro95-unclip') && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || /paint|strict|content/.test(cs.contain))) found.push(e);
    }
    return found;
  }

  function contrastPass() {
    if (!root.classList.contains('retro95') || !document.body) return;
    const W = innerWidth, H = innerHeight;
    const flats = [], panels = [], chips = [], iconBtns = [], lightFills = [], lightStrokes = [];
    // Read everything first, write the tags after (no layout thrashing).
    for (const el of document.body.getElementsByTagName('*')) {
      if (el.localName === TOOLBAR) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= H || r.right <= 0 || r.left >= W) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden') continue;
      const iconish = ICONISH.test(typeof el.className === 'string' ? el.className : '');

      if (!iconish && !el.hasAttribute('data-retro95-flat')) {
        let fade = /gradient\(/.test(cs.backgroundImage) || /gradient\(/.test(cs.maskImage);
        if (!fade && !pseudoChecked.has(el)) {
          pseudoChecked.add(el);
          for (const p of ['::before', '::after']) {
            const ps = getComputedStyle(el, p);
            if (ps.content !== 'none' && ps.content !== 'normal' && /gradient\(/.test(ps.backgroundImage + ps.maskImage)) fade = true;
          }
        }
        if (fade) flats.push(el);
      }

      if (!el.hasAttribute('data-retro95-panel') && !iconish && MEDIA.test(el.tagName) === false) {
        const L = luminance(cs.backgroundColor);
        if (L !== null && L < 0.35 && el.textContent.trim()) panels.push(el);
      }

      // Icon-only button that is still dark (own background or an inner disc,
      // e.g. Google's "+" in the "Ask anything" box) -> grey bevelled button.
      if ((el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') && !el.textContent.trim() &&
          !el.hasAttribute('data-retro95-iconbtn')) {
        const dark = (e) => { const L = luminance(getComputedStyle(e).backgroundColor); return L !== null && L < 0.35; };
        if (dark(el) || [...el.children].some((c) => dark(c) || [...c.children].some(dark))) iconBtns.push(el);
      }

      // Google only: icon shapes still light from Google's dark theme (near-white
      // on our grey) -> black. The logo is handled in retro.css.
      if (onGoogle && el instanceof SVGGeometryElement && !el.closest(GOOGLE_LOGO)) {
        const light = (c) => { const L = luminance(c); return L !== null && L > 0.6; };
        if (!el.hasAttribute('data-retro95-lightfill') && light(cs.fill)) lightFills.push(el);
        if (!el.hasAttribute('data-retro95-lightstroke') && light(cs.stroke)) lightStrokes.push(el);
      }

      if (!el.hasAttribute('data-retro95-chip') && ownText(el)) {
        const key = Math.round(r.top + scrollY) + ',' + Math.round(r.left + scrollX) + ',' + Math.round(r.width) + ',' + mediaGen;
        if (chipChecked.get(el) !== key) {
          chipChecked.set(el, key);
          if (overPicture(el)) {
            const kind = cs.display.startsWith('inline') ? 'inline'
              : cs.textAlign === 'center' ? 'center' : /right|end/.test(cs.textAlign) ? 'end' : 'start';
            chips.push([el, kind]);
          }
        }
      }
    }
    const oldLines = onGoogle ? googleOldTabLines() : [];
    const clippers = onGoogle ? googleClippingWrappers() : [];
    for (const el of flats) el.setAttribute('data-retro95-flat', '');
    for (const el of panels) el.setAttribute('data-retro95-panel', '');
    for (const el of iconBtns) el.setAttribute('data-retro95-iconbtn', '');
    for (const el of lightFills) el.setAttribute('data-retro95-lightfill', '');
    for (const el of lightStrokes) el.setAttribute('data-retro95-lightstroke', '');
    for (const el of oldLines) el.setAttribute('data-retro95-oldline', '');
    for (const el of clippers) el.setAttribute('data-retro95-unclip', '');
    for (const [el, kind] of chips) { // in document order: skip text inside an outer chip or a panel
      if (!el.parentElement || el.parentElement.closest('[data-retro95-chip], [data-retro95-panel]')) continue;
      el.setAttribute('data-retro95-chip', kind);
    }
  }

  let contrastTimer = null;
  function queueContrast(delay = 500) { // at most once per `delay`
    if (contrastTimer) return;
    contrastTimer = setTimeout(() => { contrastTimer = null; contrastPass(); }, delay);
  }

  // DOM changes from the site (not our own data-retro95-* tags: attributeFilter).
  const domObserver = new MutationObserver((list) => {
    for (const m of list) {
      const media = m.type === 'attributes' ? m.attributeName === 'src'
        : [...m.addedNodes].some((n) => n.nodeType === 1 && (MEDIA.test(n.tagName) || n.querySelector('img, video, picture, canvas')));
      if (media) { mediaGen++; break; }
    }
    queueContrast();
  });
  function watchDom(on) {
    domObserver.disconnect();
    if (on && document.body) {
      domObserver.observe(document.body, { childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['class', 'style', 'src', 'hidden'] });
    }
  }
  let scrollEndTimer = null;

  apply();
})();
