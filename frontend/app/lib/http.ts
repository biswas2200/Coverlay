import { API_BASE_URL } from './config';
import { ApiError } from './errors';
import { clearSession, getToken } from './session';

// Login and register never carry a (possibly stale) token: the backend treats them as public on purpose, and a
// leftover token must not turn their answer into a confusing 401.
const PUBLIC_PATHS = ['/auth/login', '/auth/register'];

interface Options {
  json?: unknown;
  formData?: FormData;
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null;
  }
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON (an HTML error page from a proxy, say): there is no structured body to offer.
    return null;
  }
}

/**
 * The one place every backend call goes through. Sends the session's JWT (except on login and register), resolves to
 * the parsed JSON body (null for 204 or an empty body) and rejects with an ApiError for any failure. A 401 on a
 * request that carried a token means the session expired: it is cleared, and the app sends the person to sign in.
 */
export async function request<T = unknown>(method: string, path: string, { json, formData }: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (formData !== undefined) {
    body = formData; // the browser sets the multipart boundary itself
  }

  const token = getToken();
  const sendsToken = token !== null && !PUBLIC_PATHS.some((p) => path.startsWith(p));
  if (sendsToken) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { method, headers, body });
  } catch (networkError) {
    console.error(`${method} ${path} failed before a response arrived`, networkError);
    throw new ApiError(0, null);
  }

  const responseBody = await readBody(response);
  if (!response.ok) {
    if (response.status === 401 && sendsToken) {
      clearSession();
    }
    throw new ApiError(response.status, responseBody as ConstructorParameters<typeof ApiError>[1]);
  }
  return responseBody as T;
}

export const get = <T = unknown>(path: string) => request<T>('GET', path);
export const post = <T = unknown>(path: string, options?: Options) => request<T>('POST', path, options);
export const put = <T = unknown>(path: string, options?: Options) => request<T>('PUT', path, options);
export const del = <T = unknown>(path: string) => request<T>('DELETE', path);
