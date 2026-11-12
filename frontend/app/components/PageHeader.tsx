import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { useShell } from './shell-context';

interface Props {
  crumb: string;
  title: string;
  /** What sits at the right of the top bar: a version menu, a "Preview" badge. */
  actions?: ReactNode;
}

/** The top bar every signed-in page starts with: the menu button (on a phone), the breadcrumb, the title and the actions. */
export function PageHeader({ crumb, title, actions }: Props) {
  const { openNav, navOpen } = useShell();
  return (
    <header className="topbar">
      <button className="icon-btn" id="menu-button" type="button" aria-label="Open navigation" aria-controls="sidebar" aria-expanded={navOpen} onClick={openNav}>
        <Icon name="menu" />
      </button>
      <div>
        <p className="crumb">{crumb}</p>
        <h1 className="page-title">{title}</h1>
      </div>
      {actions ? <div className="topbar-actions">{actions}</div> : null}
    </header>
  );
}

/** The violet "Preview" badge of a screen that is built to the spec but runs on sample data. */
export function PreviewBadge() {
  return <span className="badge badge-violet">Preview</span>;
}
