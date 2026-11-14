// Where the app sends API calls. nginx writes /config.js at start-up (the same origin behind its /api proxy, or
// the backend's own address); `npm run dev` serves it too. Without it the app uses /api on its own origin.
declare global {
  interface Window {
    __COVERLAY__?: { apiBaseUrl?: string };
  }
}

export const API_BASE_URL: string = window.__COVERLAY__?.apiBaseUrl ?? '/api';
