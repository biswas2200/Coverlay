import { del, get, post, put } from '@/lib/http';
import type { CompanyHit, WatchLimits, WatchedCompany } from './types';

// Backed by com.resumeanalyser.job.WatchlistController.

export const getWatchlist = () => get<WatchedCompany[]>('/watchlist');

/** The limits every person has, and this person's use of the cap. Going past them answers 409 (cap) or 429 (too many changes). */
export const getWatchlistLimits = () => get<WatchLimits>('/watchlist/limits');

/** Up to 20 companies whose name contains `query`. */
export const searchCompanies = (query: string) => get<CompanyHit[]>(`/watchlist/companies?${new URLSearchParams({ q: (query ?? '').trim() })}`);

export const watchCompany = (companyId: string) => put<WatchedCompany>(`/watchlist/${encodeURIComponent(companyId)}`);

/** Watches a company that is not in the list yet, by its website; the backend looks for its job tool at once, which takes a few seconds. */
export const addCompany = (body: { name: string; website: string; careersUrl?: string }) => post<WatchedCompany>('/watchlist/companies', { json: body });

export const unwatchCompany = (companyId: string) => del(`/watchlist/${encodeURIComponent(companyId)}`);
