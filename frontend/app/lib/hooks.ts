import { useEffect } from 'react';

/** Sets the browser tab's title to "<title> · Coverlay" while the page is shown. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Coverlay`;
  }, [title]);
}

/** Adds a class to <body> while the component is mounted (the stylesheet has a few `body.x` rules). */
export function useBodyClass(className: string | null, on = true): void {
  useEffect(() => {
    if (!className || !on) {
      return undefined;
    }
    document.body.classList.add(className);
    return () => document.body.classList.remove(className);
  }, [className, on]);
}
