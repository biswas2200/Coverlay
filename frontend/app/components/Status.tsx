import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** A grey placeholder while a page's data loads (`rows` cards tall). */
export function Skeleton({ rows = 2, label }: { rows?: number; label: string }) {
  return (
    <div className="skeleton" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <div className="card tall" key={index} />
      ))}
    </div>
  );
}

/** An empty or error card: an icon, a heading, a line, and optionally a button or link. */
export function EmptyCard({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card empty">
      <Icon name={icon} />
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

/** What a failed load looks like, with a Try again button. */
export function LoadError({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <EmptyCard
      icon="alert"
      title={title}
      action={
        <button className="btn btn-secondary" type="button" onClick={onRetry}>
          <Icon name="refresh" />
          Try again
        </button>
      }
    >
      {message}
    </EmptyCard>
  );
}
