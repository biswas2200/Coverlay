import { useSyncExternalStore } from 'react';

// The signed-in session lives in localStorage, so a reload does not sign the person out. It is also a tiny
// external store: signing in or out (or another tab doing it) re-renders whatever reads it, so a page never
// has to reload to notice. Inspect or clear it in DevTools > Application > Local Storage.
const TOKEN_KEY = 'resumeAnalyser.auth.token';
const USER_KEY = 'resumeAnalyser.auth.user';

export interface User {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  /** Only on an administrator's own account: where the admin console and API live (see lib/admin.ts). */
  adminPath?: string;
}

export interface AuthResponse {
  token: string;
  tokenType: string;
  expiresAt: string;
  user: User;
}

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// useSyncExternalStore needs the same object back while nothing changed, so the parsed user is kept by its raw text.
let cachedRaw: string | null = null;
let cachedUser: User | null = null;

/** The signed-in user, or null (a corrupted value counts as no session, never a crash). */
export function getUser(): User | null {
  const raw = read(USER_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedUser = raw ? (JSON.parse(raw) as User) : null;
    } catch {
      cachedUser = null;
    }
  }
  return cachedUser;
}

/** The JWT to send as `Authorization: Bearer <token>`, or null when signed out. */
export const getToken = (): string | null => read(TOKEN_KEY);

export const isAuthenticated = (): boolean => getToken() !== null && getUser() !== null;

export function saveSession(response: AuthResponse): void {
  localStorage.setItem(TOKEN_KEY, response.token);
  localStorage.setItem(USER_KEY, JSON.stringify(response.user));
  emit();
}

/** Replaces the stored user, e.g. after `GET /auth/me` picked up a role change. */
export function saveUser(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  emit();
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  emit();
}

/** The signed-in user, kept up to date: signing out anywhere makes this null. */
export function useUser(): User | null {
  return useSyncExternalStore(subscribe, getUser, () => null);
}
