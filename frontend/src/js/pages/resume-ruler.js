import { MARGIN_LIMITS_MM, formatLength } from './resume-builder-rules.js';

// The rulers along the top and left edge of the page, like Word's and Docs': a scale in
// centimetres or inches, the margins shaded grey, and a handle on each margin to drag. The
// page is drawn at true size and scaled to fit, so the ruler is drawn at that scale
// (`pxPerMm`). rulerTicks() is pure and tested; the rest draws SVG and handles the mouse and
// keyboard, and tells the page about a changed margin through `onMargin`.

const THICKNESS = 22; // px: the ruler's short side
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Where the tick marks go along a ruler `lengthMm` long: `{ at, kind, label }`, with `at` in
 * millimetres from the start. Centimetres: a tick every millimetre, longer at 5 mm, longest
 * (and numbered) at every centimetre. Inches: every eighth of an inch, longer at the half,
 * longest (and numbered) at every inch.
 */
export function rulerTicks(lengthMm, unit) {
  const ticks = [];
  if (unit === 'in') {
    const step = 25.4 / 8;
    for (let i = 0; i * step <= lengthMm + 1e-6; i += 1) {
      const kind = i % 8 === 0 ? 'major' : i % 4 === 0 ? 'mid' : 'minor';
      ticks.push({ at: i * step, kind, label: kind === 'major' && i > 0 ? String(i / 8) : null });
    }
  } else {
    for (let mm = 0; mm <= lengthMm + 1e-6; mm += 1) {
      const kind = mm % 10 === 0 ? 'major' : mm % 5 === 0 ? 'mid' : 'minor';
      ticks.push({ at: mm, kind, label: kind === 'major' && mm > 0 ? String(mm / 10) : null });
    }
  }
  return ticks;
}

const svgEl = (name, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  return node;
};

/**
 * One ruler. `orientation` is 'x' (along the top, margins left and right) or 'y' (down the
 * side, margins top and bottom); `keys` names the two margins it sets. Returns
 * `{ element, update({ lengthMm, pxPerMm, startMm, endMm, unit }) }`: `startMm` and `endMm` are
 * the margins at the near and far edge. `onMargin(key, mm, { commit })` is called as a handle
 * moves (`commit` true when the drag or key press is over).
 */
export function createRuler(orientation, keys, onMargin) {
  const horizontal = orientation === 'x';
  const element = document.createElement('div');
  element.className = `rb-ruler rb-ruler-${orientation}`;
  element.hidden = true;
  const svg = svgEl('svg', { class: 'rb-ruler-svg', 'aria-hidden': 'true' });
  const shadeStart = svgEl('rect', { class: 'rb-ruler-shade' });
  const shadeEnd = svgEl('rect', { class: 'rb-ruler-shade' });
  const marks = svgEl('g', { class: 'rb-ruler-marks' });
  svg.append(shadeStart, shadeEnd, marks);
  element.append(svg);

  let current = null;
  let drawnFor = '';

  const handle = (which) => {
    const node = document.createElement('div');
    node.className = `rb-ruler-handle rb-ruler-handle-${which}`;
    node.setAttribute('role', 'slider');
    node.tabIndex = 0;
    node.setAttribute('aria-orientation', horizontal ? 'horizontal' : 'vertical');
    const key = keys[which];
    const valueMm = () => (which === 'start' ? current.startMm : current.endMm);
    const labelFor = { marginTop: 'Top margin', marginBottom: 'Bottom margin', marginLeft: 'Left margin', marginRight: 'Right margin' }[key];
    node.setAttribute('aria-label', `${labelFor}. Drag, or use the arrow keys.`);

    node.addEventListener('pointerdown', (event) => {
      if (!current) {
        return;
      }
      event.preventDefault();
      node.setPointerCapture(event.pointerId);
      node.classList.add('is-dragging');
      const origin = horizontal ? event.clientX : event.clientY;
      const startValue = valueMm();
      const move = (moveEvent) => {
        const delta = ((horizontal ? moveEvent.clientX : moveEvent.clientY) - origin) / current.pxPerMm;
        const snapped = Math.round((startValue + (which === 'start' ? delta : -delta)) / MARGIN_LIMITS_MM.step) * MARGIN_LIMITS_MM.step;
        onMargin(key, snapped, { commit: false });
      };
      const stop = () => {
        node.classList.remove('is-dragging');
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', stop);
        node.removeEventListener('pointercancel', stop);
        onMargin(key, valueMm(), { commit: true });
      };
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', stop);
      node.addEventListener('pointercancel', stop);
    });
    node.addEventListener('keydown', (event) => {
      const grow = horizontal ? (which === 'start' ? 'ArrowRight' : 'ArrowLeft') : (which === 'start' ? 'ArrowDown' : 'ArrowUp');
      const shrink = horizontal ? (which === 'start' ? 'ArrowLeft' : 'ArrowRight') : (which === 'start' ? 'ArrowUp' : 'ArrowDown');
      if (event.key === grow || event.key === shrink) {
        event.preventDefault();
        onMargin(key, valueMm() + (event.key === grow ? 1 : -1) * MARGIN_LIMITS_MM.step * (event.shiftKey ? 10 : 2), { commit: true });
      }
    });
    return node;
  };
  const startHandle = handle('start');
  const endHandle = handle('end');
  element.append(startHandle, endHandle);

  return {
    element,
    update(next) {
      current = next;
      const { lengthMm, pxPerMm, startMm, endMm, unit } = next;
      const long = lengthMm * pxPerMm;
      element.style.width = `${horizontal ? long : THICKNESS}px`;
      element.style.height = `${horizontal ? THICKNESS : long}px`;
      svg.setAttribute('width', String(horizontal ? long : THICKNESS));
      svg.setAttribute('height', String(horizontal ? THICKNESS : long));

      // The scale only needs redrawing when its length, size or unit changes.
      const signature = `${lengthMm}|${pxPerMm.toFixed(4)}|${unit}`;
      if (signature !== drawnFor) {
        drawnFor = signature;
        marks.replaceChildren();
        const size = { minor: 4, mid: 8, major: 12 };
        const paths = { minor: '', mid: '', major: '' };
        for (const tick of rulerTicks(lengthMm, unit)) {
          if (tick.kind === 'minor' && pxPerMm < 1.6) {
            continue; // too dense to read at this scale
          }
          const at = (tick.at * pxPerMm).toFixed(2);
          const len = size[tick.kind];
          paths[tick.kind] += horizontal
            ? `M${at} ${THICKNESS}v${-len}`
            : `M${THICKNESS} ${at}h${-len}`;
          if (tick.label) {
            const label = svgEl('text', horizontal
              ? { x: Number(at) + 2.5, y: 9.5, class: 'rb-ruler-label' }
              : { x: 2, y: Number(at) + 11, class: 'rb-ruler-label' });
            label.textContent = tick.label;
            marks.append(label);
          }
        }
        for (const kind of ['minor', 'mid', 'major']) {
          if (paths[kind]) {
            marks.append(svgEl('path', { d: paths[kind], class: `rb-ruler-tick rb-ruler-tick-${kind}` }));
          }
        }
      }

      // The margins, shaded; and a handle on each.
      const startPx = startMm * pxPerMm;
      const endPx = long - endMm * pxPerMm;
      const place = (rect, from, size) => {
        rect.setAttribute(horizontal ? 'x' : 'y', String(from));
        rect.setAttribute(horizontal ? 'y' : 'x', '0');
        rect.setAttribute(horizontal ? 'width' : 'height', String(Math.max(0, size)));
        rect.setAttribute(horizontal ? 'height' : 'width', String(THICKNESS));
      };
      place(shadeStart, 0, startPx);
      place(shadeEnd, endPx, long - endPx);
      startHandle.style[horizontal ? 'left' : 'top'] = `${startPx}px`;
      endHandle.style[horizontal ? 'left' : 'top'] = `${endPx}px`;
      for (const [node, value] of [[startHandle, startMm], [endHandle, endMm]]) {
        node.dataset.tip = formatLength(value, unit);
        node.setAttribute('aria-valuemin', String(MARGIN_LIMITS_MM.min));
        node.setAttribute('aria-valuemax', String(MARGIN_LIMITS_MM.max));
        node.setAttribute('aria-valuenow', String(value));
        node.setAttribute('aria-valuetext', formatLength(value, unit));
      }
    },
  };
}

export const RULER_THICKNESS = THICKNESS;
