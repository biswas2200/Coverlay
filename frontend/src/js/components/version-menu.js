import { el } from '../core/dom.js';
import { shortDate } from '../pages/insights.js';
import { icon } from './icons.js';

// The menu of uploaded resume versions, shown in the top bar of the pages that use the resume
// (the analysis, the job matches, the letters, the Resume Builder). It used to be a list in the
// sidebar, which grew without limit; here it is one button that opens a short, scrollable list.

let closeOpenMenu = null;

/**
 * Puts a "Resume v3" button in `slot` that opens the versions, newest first. `versions` is
 * oldest first (the API's order); `currentId` marks the one the page is using (the newest when
 * not given). Choosing a version opens it in the Resume analyzer.
 */
export function mountVersionMenu(slot, versions, { currentId = null, label = 'Resume' } = {}) {
  if (!slot) {
    return;
  }
  const newestFirst = [...versions].reverse();
  const current = versions.find((resume) => resume.id === currentId) ?? versions.at(-1) ?? null;

  const button = el(
    'button',
    { class: 'btn btn-secondary vmenu-btn', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'The uploaded versions of your resume' },
    icon('file'),
    current ? `${label} v${current.version}` : `${label}: none yet`,
    icon('arrow-down'),
  );

  const items = newestFirst.length
    ? newestFirst.map((resume, index) =>
      el(
        'li',
        {},
        el(
          'a',
          { class: 'vmenu-item', role: 'menuitem', href: `upload.html?resume=${encodeURIComponent(resume.id)}`, 'aria-current': resume.id === current?.id ? 'true' : null },
          el('span', {}, `Version ${resume.version}${index === 0 ? ' (latest)' : ''}`),
          el('span', { class: 'when' }, shortDate(resume.uploadedAt)),
        ),
      ))
    : [el('li', { class: 'vmenu-empty' }, 'No uploads yet')];

  const pop = el(
    'div',
    { class: 'vmenu-pop', role: 'menu', 'aria-label': 'Resume versions', hidden: true },
    el('p', { class: 'vmenu-title' }, versions.length ? `${versions.length} uploaded ${versions.length === 1 ? 'version' : 'versions'}` : 'Resume versions'),
    el('ul', { class: 'vmenu-list' }, ...items),
    el('a', { class: 'vmenu-foot', href: 'upload.html' }, icon('upload'), 'Upload a new version'),
  );

  const close = () => {
    pop.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (closeOpenMenu === close) {
      closeOpenMenu = null;
    }
  };
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!pop.hidden) {
      close();
      return;
    }
    closeOpenMenu?.();
    pop.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    closeOpenMenu = close;
  });
  pop.addEventListener('click', (event) => event.stopPropagation());

  slot.replaceChildren(el('div', { class: 'vmenu' }, button, pop));
}

// One pair of listeners for every menu: a click elsewhere, or Escape, closes the open one.
document.addEventListener('click', () => closeOpenMenu?.());
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeOpenMenu?.();
  }
});
