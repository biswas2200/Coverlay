// The app's pages as routes. The older multi-page app used file names (`resume-builder.html`); a few places still
// speak that way (Lay AI's page links, the connector list), so `toRoute` turns any of those into a route.
// The admin console is not here on purpose: its address is a secret only an administrator is given (lib/admin.ts).
const BY_FILE: Record<string, string> = {
  index: '/',
  'resume-builder': '/builder',
};

export const ROUTES = {
  home: '/',
  login: '/login',
  register: '/register',
  dashboard: '/dashboard',
  upload: '/upload',
  builder: '/builder',
  letters: '/letters',
  jobs: '/jobs',
  saved: '/saved',
  applications: '/applications',
  watchlist: '/watchlist',
  community: '/community',
  activity: '/activity',
  wallet: '/wallet',
  settings: '/settings',
  preview: '/preview',
} as const;

/** `resume-builder.html#linkedin` -> `/builder#linkedin`; a route that is already one stays as it is. */
export function toRoute(href: string): string {
  if (href.startsWith('/')) {
    return href;
  }
  const [path, hash = ''] = href.split('#');
  const [file, query = ''] = path.split('?');
  const name = file.replace(/\.html$/, '');
  return `${BY_FILE[name] ?? `/${name}`}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`;
}
