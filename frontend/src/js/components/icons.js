// The app's line icons, drawn for this project on a 24-unit grid. `icon(name)` returns an
// <svg> that references a symbol in a sprite injected once per page, so every icon follows the
// current text colour through `stroke: currentColor` (see .icon in app.css).

const PATHS = {
  home: 'M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z',
  file: 'M14 3H6.5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V7.5zM14 3v4.5h4.5M9 12.5h6M9 16.5h4',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9zM12 11.2a.8.8 0 1 0 0 1.6.8.8 0 1 0 0-1.6z',
  briefcase: 'M4 7.5h16a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1zM8.5 7.5V5.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v2M3 13h18',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM12 7.5V12l3 2',
  upload: 'M12 15.5V4M7.5 8.5 12 4l4.5 4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  logout: 'M9.5 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4.5M15 16l4-4-4-4M19 12H9.5',
  check: 'M5 12.5 10 17.5 19 7',
  x: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  alert: 'M12 3.5 2.8 19.5h18.4zM12 9.5v4.5M12 17v.3',
  minus: 'M6 12h12',
  sparkle: 'M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9zM18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z',
  plus: 'M12 5v14M5 12h14',
  menu: 'M4 7h16M4 12h16M4 17h16',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  up: 'M7.5 10.5V20H4.5v-9.5zM7.5 10.5 11 3.6a2 2 0 0 1 3.4 1.9L13.5 9h5.3a2 2 0 0 1 2 2.4l-1.3 6.9A2 2 0 0 1 17.5 20H7.5',
  down: 'M16.5 13.5V4h3v9.5zM16.5 13.5 13 20.4a2 2 0 0 1-3.4-1.9l.9-3.5H5.2a2 2 0 0 1-2-2.4l1.3-6.9A2 2 0 0 1 6.5 4h10',
  lock: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4.5H15',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13zM15.3 15.3 20 20',
  bookmark: 'M7 3.5h10a1 1 0 0 1 1 1V20.5l-6-4-6 4V4.5a1 1 0 0 1 1-1z',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6z',
  pin: 'M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5z',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H10',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H14',
  list: 'M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  wallet: 'M4 7.5h15.5a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 7.5 15.5 4v3.5M16.5 14h1',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 1 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5a6 6 0 0 1 3.5 5.5',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
  mail: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM3.5 7 12 13l8.5-6',
  chart: 'M4 20V11M10 20V5M16 20v-6M21 20H3',
  shield: 'M12 3.5 19 6v5.5c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6z',
  trash: 'M5 7h14M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M7 7l1 13h8l1-13',
  kanban: 'M4 4.5h4.5v15H4zM10 4.5h4.5v9H10zM16 4.5h4.5v12H16z',
  'arrow-up': 'M12 19V5M6 11l6-6 6 6',
  'arrow-down': 'M12 5v14M6 13l6 6 6-6',
  phone: 'M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5zM10.5 18.5h3',
  building: 'M4.5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M14.5 10h4a1 1 0 0 1 1 1v10M3 21h18M8 8h3M8 12h3M8 16h3',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function ensureSprite() {
  if (document.getElementById('icon-sprite')) {
    return;
  }
  const sprite = document.createElementNS(SVG_NS, 'svg');
  sprite.id = 'icon-sprite';
  sprite.setAttribute('aria-hidden', 'true');
  sprite.style.display = 'none';
  for (const [name, d] of Object.entries(PATHS)) {
    const symbol = document.createElementNS(SVG_NS, 'symbol');
    symbol.id = `i-${name}`;
    symbol.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    symbol.append(path);
    sprite.append(symbol);
  }
  document.body.prepend(sprite);
}

/** An `<svg class="icon">` showing the named icon; decorative, so hidden from screen readers. */
export function icon(name, className = '') {
  ensureSprite();
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `icon ${className}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

/** Replaces every `<i data-icon="name">` placeholder in the static HTML with its icon. */
export function hydrateIcons(root = document) {
  for (const placeholder of root.querySelectorAll('i[data-icon]')) {
    placeholder.replaceWith(icon(placeholder.dataset.icon, placeholder.className));
  }
}
