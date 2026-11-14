import { get, post } from '@/lib/http';
import { saveSession, saveUser, type AuthResponse, type User } from '@/lib/session';

// Backed by com.resumeanalyser.auth.AuthController.

/** Creates an account (`POST /auth/register`) and starts a session for it: the answer is the same as login's. */
export async function register(email: string, password: string): Promise<AuthResponse> {
  const response = await post<AuthResponse>('/auth/register', { json: { email, password } });
  saveSession(response);
  return response;
}

/** Signs in (`POST /auth/login`) and starts a session. */
export async function login(email: string, password: string): Promise<AuthResponse> {
  const response = await post<AuthResponse>('/auth/login', { json: { email, password } });
  saveSession(response);
  return response;
}

/**
 * Re-reads the signed-in account (`GET /auth/me`) and updates the stored user. The role in a stored session goes
 * stale the moment an admin changes it, so the shell calls this on load.
 */
export async function refreshCurrentUser(): Promise<User> {
  const user = await get<User>('/auth/me');
  saveUser(user);
  return user;
}
