import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useVersions } from '@/lib/data';
import { ROUTES } from '@/lib/routes';
import { shortDate } from '@legacy/pages/insights.js';
import { Icon } from './Icon';

interface Props {
  /** The word before the version number: "Resume", "Written from". */
  label?: string;
  /** The version the page is using (the newest when not given). */
  currentId?: string | null;
}

/**
 * The "Resume v3" button of the top bar: one button that opens a short, scrollable list of the uploaded versions,
 * newest first. Choosing one opens it in the Resume analyzer. (A list in the sidebar grew without limit.)
 */
export function VersionMenu({ label = 'Resume', currentId = null }: Props) {
  const { data: versions = [] } = useVersions();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const popId = useId();
  const newestFirst = [...versions].reverse();
  const current = versions.find((resume) => resume.id === currentId) ?? versions.at(-1) ?? null;

  // A click elsewhere, or Escape, closes it.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="vmenu" ref={root}>
      <button
        className="btn btn-secondary vmenu-btn"
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={popId}
        title="The uploaded versions of your resume"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="file" />
        {current ? `${label} v${current.version}` : `${label}: none yet`}
        <Icon name="arrow-down" />
      </button>
      <div className="vmenu-pop" id={popId} role="menu" aria-label="Resume versions" hidden={!open}>
        <p className="vmenu-title">{versions.length ? `${versions.length} uploaded ${versions.length === 1 ? 'version' : 'versions'}` : 'Resume versions'}</p>
        <ul className="vmenu-list">
          {newestFirst.length ? (
            newestFirst.map((resume, index) => (
              <li key={resume.id}>
                <Link
                  className="vmenu-item"
                  role="menuitem"
                  to={`${ROUTES.upload}?resume=${encodeURIComponent(resume.id)}`}
                  aria-current={resume.id === current?.id ? 'true' : undefined}
                  onClick={() => setOpen(false)}
                >
                  <span>{`Version ${resume.version}${index === 0 ? ' (latest)' : ''}`}</span>
                  <span className="when">{shortDate(resume.uploadedAt)}</span>
                </Link>
              </li>
            ))
          ) : (
            <li className="vmenu-empty">No uploads yet</li>
          )}
        </ul>
        <Link className="vmenu-foot" to={ROUTES.upload} onClick={() => setOpen(false)}>
          <Icon name="upload" />
          Upload a new version
        </Link>
      </div>
    </div>
  );
}
