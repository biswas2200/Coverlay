// Where the admin console lives. It is not at /admin: the backend makes up one secret path (APP_ADMIN_PATH), puts
// the admin API under it, and tells it only to an administrator, at sign-in and on GET /auth/me (`user.adminPath`).
// The console's pages use the same path, so the address is in no bundle and no link a non-administrator can see.

// The shape the backend promises: one segment, 24 to 64 letters, digits, - or _.
const ADMIN_PATH = /^\/[A-Za-z0-9_-]{24,64}$/;

/**
 * The base of this account's admin console and admin API, or null. Null for anyone who is not an administrator,
 * for an older stored session that has no path yet, and for a value that is not the promised shape (a hand-edited
 * session must not be able to put the console on top of another page's address).
 */
export function adminBase(user) {
  return user?.role === 'ADMIN' && typeof user.adminPath === 'string' && ADMIN_PATH.test(user.adminPath) ? user.adminPath : null;
}

/** The console's pages under its base. */
export const adminRoutes = (base) => ({ home: base, bugs: `${base}/bugs` });
