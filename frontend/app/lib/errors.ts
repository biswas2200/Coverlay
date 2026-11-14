const FALLBACK = 'Something went wrong. Please try again.';

interface ApiErrorBody {
  timestamp?: string;
  status?: number;
  message?: string;
  fieldErrors?: string[] | null;
}

/**
 * Thrown for every failed request. `status` is the HTTP status, or 0 when no response arrived (backend down,
 * no network). `body` is the backend's uniform error body when there was one.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.message ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body ?? null;
  }
}

/** Any error as a message safe to show: the backend's own message (with its field details), else a generic one. */
export function errorMessage(error: unknown, fallback: string = FALLBACK): string {
  if (!(error instanceof ApiError) || !error.body?.message) {
    return fallback;
  }
  const { message, fieldErrors } = error.body;
  return fieldErrors?.length ? `${message}: ${fieldErrors.join(', ')}` : message;
}
