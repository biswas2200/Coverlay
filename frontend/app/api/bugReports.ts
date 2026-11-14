import { adminApi } from '@/lib/admin';
import { get, post } from '@/lib/http';
import type { BugReport } from './types';

// Backed by com.resumeanalyser.bugreport.BugReportController. The admin calls go to the secret admin path
// (lib/admin.ts), never /admin.

export interface NewBugReport {
  whatHappened: string;
  expected: string;
  steps: string;
  page: string;
  writtenByUser: boolean;
}

/** Sends a report; it waits for an admin's review. */
export const submitBugReport = (report: NewBugReport) => post<BugReport>('/bug-reports', { json: report });

export const getMyBugReports = () => get<BugReport[]>('/bug-reports/mine');

/** Admin: the reports with one status, oldest first. */
export const getBugReports = (status: string) => get<BugReport[]>(`${adminApi()}/bug-reports?status=${encodeURIComponent(status)}`);

/** Admin: opens a GitHub issue for the report. */
export const approveBugReport = (id: string, title: string) => post<BugReport>(`${adminApi()}/bug-reports/${encodeURIComponent(id)}/approve`, { json: { title } });

/** Admin: links the report to an existing GitHub issue ("42", "#42" or its link). */
export const linkBugReport = (id: string, issue: string, note: string) => post<BugReport>(`${adminApi()}/bug-reports/${encodeURIComponent(id)}/link`, { json: { issue, note } });

/** Admin: keeps the report off GitHub. */
export const rejectBugReport = (id: string, note: string) => post<BugReport>(`${adminApi()}/bug-reports/${encodeURIComponent(id)}/reject`, { json: { note } });
