import { del, get, put } from '@/lib/http';
import { jobsQuery } from '@legacy/pages/jobs-rules.js';
import type { InDemandRole, RecommendedJobs, SavedJob } from './types';

// Backed by com.resumeanalyser.job.JobController.

/** Open jobs ranked for the person's latest resume, best first (newest first and unranked without a resume). */
export const getRecommended = (filters: { q?: string; workplace?: string; limit?: number } = {}) => get<RecommendedJobs>(jobsQuery(filters));

/** What open jobs ask for in the person's top role matches, most-asked skills first. */
export const getInDemand = () => get<{ roles: InDemandRole[] }>('/jobs/in-demand');

/** The saved jobs, newest first. */
export const getSaved = () => get<SavedJob[]>('/jobs/saved');

/** Saves a job, or sets where its application stands (a new save starts at SAVED). */
export const saveJob = (jobId: string, status?: string) =>
  put<SavedJob>(`/jobs/${encodeURIComponent(jobId)}/saved`, status ? { json: { status } } : {});

/** Removes a job from the saved list (204 even if it was not saved). */
export const unsaveJob = (jobId: string) => del(`/jobs/${encodeURIComponent(jobId)}/saved`);
