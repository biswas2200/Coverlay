import { adminBase as baseOf, adminRoutes as routesOf } from '@legacy/pages/admin-rules.js';
import { getUser, type User } from './session';

// The admin console and the admin API are not at /admin. Both live under one secret path the backend makes up
// and tells only to an administrator (`user.adminPath`); the rules are in admin-rules.js. So the path is not in
// this bundle, the console's routes do not exist for anyone else, and the backend answers 404 at the API.

/** Where this administrator's console (and admin API) lives, or null for everyone else. */
export const adminBase = (user: User | null): string | null => baseOf(user);

/** The console's pages under its base. */
export const adminRoutes = (base: string): { home: string; bugs: string } => routesOf(base);

/** The admin API's base for the signed-in administrator. A call made without one is a bug, so it fails loudly. */
export function adminApi(): string {
  const base = adminBase(getUser());
  if (!base) {
    throw new Error('Not available');
  }
  return base;
}
