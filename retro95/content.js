// Retro 95 content script: runs in every page at document_start.
// The skin is on when <html> has the class "retro95". The saved state lives
// in chrome.storage.local under "retroEnabled" (missing = off).

const root = document.documentElement;
// Title bar/taskbar only in the top page of a normal HTML document.
const isTop = window.top === window && root instanceof HTMLHtmlElement;
// Google Search gets a few extra fixes; retro.css scopes them to this marker
// so nothing changes on other sites.
const onGoogle = /^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(location.hostname);
if (onGoogle) root.setAttribute('data-retro95-site', 'google');

// animate = play the power-on effect (only for a live switch-on, not on
// every page load while the skin is already on).
function apply(on, animate) {
  root.classList.toggle('retro95', on === true);
  if (on === true) whenBody(() => { mountUI(animate); watchDom(true); queueContrast(); });
  else { unmountUI(); watchDom(false); }
  scanPage();
}

// Used by the in-page controls (Start menu).
function setRetro(on) {
  apply(on, on);
  try { chrome.storage.local.set({ retroEnabled: on }); } catch (e) {} // extension reloaded
}

function whenBody(fn) {
  if (document.body) fn();
  else document.addEventListener('DOMContentLoaded', fn, { once: true });
}

// CSS can't select by computed position or "has no text", so this scan tags
// elements and retro.css does the styling:
// - data-retro95-float on fixed/sticky layers (headers, cookie bars,
//   banners): they get a solid face (the skin makes backgrounds transparent)
//   and are moved clear of our bars. Value = the edge they're pinned to:
//   "fixed-top" | "sticky-top" | "bottom" | "sticky-bottom" | "both" | "".
//   Skips huge layers (invisible full-screen overlays) and empty ones.
// - data-retro95-bare on buttons with no text (icon/hidden buttons), so they
//   don't turn into empty bevelled boxes.
// Re-checked every second and shortly after scrolling, because sites switch
// headers to fixed/sticky as you scroll.
const TITLE_H = 26, TASKBAR_H = 32; // space our bars take at the top/bottom

function scanPage() {
  if (!root.classList.contains('retro95') || !document.body) return;
  const maxArea = innerWidth * innerHeight * 0.6;
  for (const el of document.body.getElementsByTagName('*')) {
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
  // Our bars use the top z-index; staying the last element wins any tie.
  if (ui && root.lastElementChild !== ui.host) root.append(ui.host);
}

function pinnedEdge(el, cs) {
  const t = parseFloat(cs.top), b = parseFloat(cs.bottom); // NaN for "auto"
  if (cs.position === 'sticky') {
    const cur = el.getAttribute('data-retro95-float'); // retro.css already moved it
    if (t < TITLE_H || (cur === 'sticky-top' && t === TITLE_H)) return 'sticky-top';
    if (b < TASKBAR_H || (cur === 'sticky-bottom' && b === TASKBAR_H)) return 'sticky-bottom';
    return '';
  }
  // Fixed: moved with margins, so top/bottom read the same after we move it.
  // Move everything pinned in the top part of the screen, not just top:0,
  // so stacked headers keep their order (apple.com: banner at top:0, nav at top:70px).
  const atTop = t < innerHeight * 0.4, atBottom = b < TASKBAR_H;
  return atTop && atBottom ? 'both' : atTop ? 'fixed-top' : atBottom ? 'bottom' : '';
}

// Only touch the DOM when the value changes (sites may watch attributes).
function setAttr(el, name, value) {
  const cur = el.getAttribute(name);
  if (value === null) { if (cur !== null) el.removeAttribute(name); }
  else if (cur !== value) el.setAttribute(name, value);
}

// ---------- Title bar, taskbar, Start menu ----------
// Lives in a Shadow DOM on <html> (outside <body>), so neither the site's CSS
// nor retro.css's "body *" rules reach it. Styles go in via a constructed
// stylesheet, which page CSP can't block (unlike an injected <style>).
const BLUE = 'linear-gradient(90deg, #000080, #1084d0)';
const UI_CSS = `
  :host { all: initial !important; }
  * { box-sizing: border-box; margin: 0; color: #000;
      font: 12px Tahoma, "MS Sans Serif", Arial, sans-serif; }
  [hidden] { display: none !important; }
  .raised { background: #c0c0c0; border: 1px solid; border-color: #fff #000 #000 #fff;
            box-shadow: inset -1px -1px #808080, inset 1px 1px #dfdfdf; }
  button { display: flex; align-items: center; justify-content: center;
           padding: 0; cursor: default; user-select: none; }
  button:active, .pressed { border-color: #000 #fff #fff #000 !important;
           box-shadow: inset 1px 1px #808080, inset -1px -1px #dfdfdf !important; }
  .cap { width: 16px; height: 14px; font-size: 11px; font-weight: bold; line-height: 1; } /* dialog × */
  .bluebar { display: flex; align-items: center; gap: 2px; background: ${BLUE}; }
  .bluebar .label { flex: 1; min-width: 0; color: #fff; font-weight: bold;
           white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* 2px grey frame on top/sides so nothing scrolling underneath peeks through. */
  .titlebar { position: fixed; top: 0; left: 8px; right: 8px; height: 26px;
              z-index: 2147483647; padding: 0 6px;
              border: solid #c0c0c0; border-width: 2px 2px 0; }

  .taskbar { position: fixed; left: 0; right: 0; bottom: 0; height: 32px;
             z-index: 2147483647; display: flex; align-items: center;
             justify-content: space-between; padding: 3px 3px 2px;
             background: #c0c0c0; border-top: 1px solid #dfdfdf; box-shadow: inset 0 1px #fff; }
  .start { height: 24px; padding: 0 6px; gap: 4px; font-weight: bold; }
  .tray { height: 24px; padding: 0 10px; display: flex; align-items: center;
          border: 1px solid; border-color: #808080 #fff #fff #808080; }

  /* Start menu: raised panel above the taskbar, navy side strip. */
  .menu { position: fixed; left: 2px; bottom: 30px; z-index: 2147483647;
          display: flex; min-width: 200px; padding: 2px; }
  .side { width: 24px; padding: 8px 0; background: #000080; color: #c0c0c0;
          font-size: 15px; font-weight: bold; writing-mode: vertical-rl; transform: rotate(180deg); }
  .items { flex: 1; display: flex; flex-direction: column; }
  .item { justify-content: flex-start; gap: 10px; height: 34px; padding: 0 14px 0 6px;
          border: 0; background: transparent; text-align: left; }
  .item:active { box-shadow: none !important; }
  .item:hover, .item:focus-visible { background: #000080; outline: none; }
  .item:hover *, .item:focus-visible * { color: #fff; }
  .ico { width: 24px; font-size: 18px; text-align: center; }
  .sep { margin: 2px 1px; border-top: 1px solid #808080; border-bottom: 1px solid #fff; }

  /* Small dialog box (Time travel help). */
  .dialog { position: fixed; left: 50%; top: 40%; transform: translate(-50%, -50%);
            z-index: 2147483647; width: 320px; padding: 3px; }
  .dialog .bluebar { height: 20px; padding: 0 2px 0 4px; }
  .dialog p { padding: 14px 12px; line-height: 1.45; }
  .dialog .ok { width: 75px; height: 23px; margin: 0 auto 8px; }

  /* Power-on effect (~500ms): a bright line opens out of a black screen,
     then one flicker and it is gone. */
  .crt { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
         background: #000; animation: crt-fade 500ms ease-out forwards; }
  .crt::after { content: ""; position: absolute; inset: 0; background: #cfd8ff;
                animation: crt-line 500ms ease-out forwards; }
  @keyframes crt-line {
    0%   { transform: scale(0.1, 0.004); opacity: 1; }
    30%  { transform: scale(1, 0.004);   opacity: 1; }
    55%  { transform: scale(1, 1);       opacity: 0.45; }
    100% { transform: scale(1, 1);       opacity: 0; }
  }
  @keyframes crt-fade {
    0%, 45% { opacity: 1; }
    60%     { opacity: 0.35; }
    70%     { opacity: 0.7; }
    100%    { opacity: 0; visibility: hidden; }
  }
  @media (prefers-reduced-motion: reduce) { .crt { display: none; } }
`;

let ui = null; // { host, clockTimer, titleObserver, menu, start, ... } while mounted

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

function mountUI(animate) {
  if (ui || !isTop || !root.classList.contains('retro95')) return;
  const host = document.createElement('retro95-ui');
  const shadow = host.attachShadow({ mode: 'open' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(UI_CSS);
  shadow.adoptedStyleSheets = [sheet];

  // Title bar: just the page title.
  const titlebar = el('div', 'titlebar bluebar');
  const title = el('span', 'label');
  titlebar.append(title);

  // Taskbar: Start button + sunken tray with a clock.
  const taskbar = el('div', 'taskbar');
  const start = el('button', 'raised start');
  start.append(el('span', '', '💾'), el('span', '', 'Start'));
  const clock = el('div', 'tray');
  taskbar.append(start, clock);

  // Start menu.
  const menu = el('div', 'raised menu');
  menu.hidden = true;
  const items = el('div', 'items');
  const item = (icon, text, onClick) => {
    const b = el('button', 'item');
    const label = el('span', '', text);
    b.append(el('span', 'ico', icon), label);
    b.addEventListener('click', () => { setMenu(false); onClick(); });
    items.append(b);
    return label;
  };
  const modeLabel = item('🖥️', '', () => setRetro(!root.classList.contains('retro95')));
  item('⏳', 'Time travel...', timeTravel);
  items.append(el('div', 'sep'));
  item('🔌', 'Shut down', () => setRetro(false));
  menu.append(el('div', 'side', 'Retro 95'), items);
  start.addEventListener('click', () => setMenu(menu.hidden));

  // Help dialog for Time travel when the popup can't be opened for you.
  const dialog = el('div', 'raised dialog');
  dialog.hidden = true;
  const dbar = el('div', 'bluebar');
  const dclose = el('button', 'raised cap', '×');
  dbar.append(el('span', 'label', 'Time travel'), dclose);
  const ok = el('button', 'raised ok', 'OK');
  dialog.append(dbar, el('p', '', 'Click the Retro 95 button in Chrome\'s toolbar ' +
    '(or the puzzle-piece menu), pick a year, then press Time travel.'), ok);
  dclose.addEventListener('click', () => { dialog.hidden = true; });
  ok.addEventListener('click', () => { dialog.hidden = true; });

  shadow.append(titlebar, taskbar, menu, dialog);
  if (animate) {
    const crt = el('div', 'crt');
    crt.addEventListener('animationend', () => crt.remove(), { once: true });
    shadow.append(crt);
  }
  root.append(host);

  const setTitle = () => { title.textContent = document.title || location.hostname; };
  const setClock = () => {
    const d = new Date();
    clock.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  };
  function setMenu(open) {
    menu.hidden = !open;
    start.classList.toggle('pressed', open);
    if (open) modeLabel.textContent = 'Retro mode: ' + (root.classList.contains('retro95') ? 'ON' : 'OFF');
  }
  setTitle();
  setClock();
  const titleObserver = new MutationObserver(setTitle);
  titleObserver.observe(document.head || root, { subtree: true, childList: true, characterData: true });
  ui = { host, titleObserver, clockTimer: setInterval(setClock, 10000), setMenu, dialog };
}

function unmountUI() {
  if (!ui) return;
  clearInterval(ui.clockTimer);
  ui.titleObserver.disconnect();
  ui.host.remove();
  ui = null;
}

// Ask the background to open the extension popup (where the year is
// picked). If Chrome won't, explain how to open it.
function timeTravel() {
  const help = () => { if (ui) ui.dialog.hidden = false; };
  try {
    chrome.runtime.sendMessage({ type: 'openPopup' }, (reply) => {
      if (chrome.runtime.lastError || !reply || !reply.ok) help();
    });
  } catch (e) { help(); } // extension was reloaded
}

// Close the Start menu on any click outside our UI, on Escape, or when focus
// leaves the page (e.g. a click inside an iframe).
addEventListener('pointerdown', (e) => {
  if (ui && !e.composedPath().includes(ui.host)) ui.setMenu(false);
}, true);
addEventListener('keydown', (e) => { if (ui && e.key === 'Escape') ui.setMenu(false); }, true);
addEventListener('blur', () => { if (ui) ui.setMenu(false); });

// ---------- Wiring ----------

// On load: restore the saved state (no animation).
chrome.storage.local.get('retroEnabled', (data) => apply(data.retroEnabled));

// Live updates: the popup writes storage, every open tab follows.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'retroEnabled' in changes) {
    apply(changes.retroEnabled.newValue, true);
  }
});

// Fallback: {type:"toggle", on?:boolean}. Without "on" it flips the state.
// Saves to storage too, so the state persists and other tabs follow.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'toggle') {
    const on = typeof msg.on === 'boolean' ? msg.on : !root.classList.contains('retro95');
    apply(on, true);
    chrome.storage.local.set({ retroEnabled: on });
    sendResponse({ ok: true, on });
  }
  // Popup asks for the address when it can't read tab.url itself.
  if (msg.type === 'getUrl') sendResponse({ url: location.href });
});

// Re-scan (no-op while the skin is off): on load, every second (late
// banners, bars wiped by the site), and 150ms after scrolling/resizing.
document.addEventListener('DOMContentLoaded', scanPage);
setInterval(scanPage, 1000);
let scanQueued = false;
function queueScan() {
  if (scanQueued) return;
  scanQueued = true;
  setTimeout(() => { scanQueued = false; scanPage(); }, 150);
}
addEventListener('scroll', queueScan, { passive: true, capture: true });
addEventListener('resize', queueScan, { passive: true });

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
// Pictures finishing loading (lazy images) can put existing text on a photo.
document.addEventListener('load', (e) => {
  if (e.target && MEDIA.test(e.target.tagName) && root.classList.contains('retro95')) { mediaGen++; queueContrast(); }
}, true);
function watchDom(on) {
  domObserver.disconnect();
  if (on && document.body) {
    domObserver.observe(document.body, { childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['class', 'style', 'src', 'hidden'] });
  }
}
addEventListener('load', () => queueContrast(0));
let scrollEndTimer = null;
addEventListener('scroll', () => { // new things come into view
  clearTimeout(scrollEndTimer);
  scrollEndTimer = setTimeout(() => queueContrast(0), 300);
}, { passive: true, capture: true });
