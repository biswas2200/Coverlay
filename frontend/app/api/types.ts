// The shapes the backend answers with (see the DTOs in backend/src/main/java/com/resumeanalyser). Only what the
// screens read is listed.

export interface ResumeDto {
  id: string;
  userId: string;
  fileRef: string;
  version: number;
  uploadedAt: string;
}

export interface ParsedProfile {
  id: string;
  resumeId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  skills: string[];
  experience: { title?: string | null; organization?: string | null; duration?: string | null }[];
  education: { degree?: string | null; institution?: string | null; year?: string | null }[];
}

export interface JdMatch {
  resumeId: string;
  score: number;
  coverage: number;
  similarity: number;
  jdSkills: string[];
  matchedSkills: string[];
  missingSkills: string[];
  closestRole: { title: string } | null;
  explanation: string;
}

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string | null;
  workplaceType: string | null;
  employmentType: string | null;
  publishedAt: string | null;
  firstSeenAt: string | null;
  excerpt: string | null;
  applyUrl: string | null;
  url: string | null;
  active: boolean;
}

export interface RankedJob {
  job: Job;
  score: number | null;
  coverage: number | null;
  matchedSkills: string[];
  missingSkills: string[];
  closestRole: string | null;
  why: string;
  savedStatus: string | null;
}

export interface RecommendedJobs {
  resumeId: string | null;
  resumeVersion: number | null;
  roles: string[];
  openJobs: number;
  jobs: RankedJob[];
}

export interface InDemandRole {
  role: string;
  jobCount: number;
  computedAt: string | null;
  skills: { skill: string; share: number; have: boolean }[];
}

export interface SavedJob {
  job: Job;
  status: string;
  savedAt: string;
  updatedAt: string;
}

export interface WatchedCompany {
  companyId: string;
  name: string;
  domain: string | null;
  status: string;
  careersUrl: string | null;
  openJobs: number;
  newJobs: number;
  addedAt: string;
}

export interface WatchLimits {
  maxCompanies: number;
  watching: number;
  changesPerMinute: number;
  changesPerHour: number;
}

export interface CompanyHit {
  id: string;
  name: string;
  domain: string | null;
  status: string;
  watched: boolean;
}

export interface BugReport {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'LINKED' | 'REJECTED';
  whatHappened: string;
  expected: string | null;
  steps: string | null;
  page: string | null;
  userAgent?: string | null;
  reporterEmail?: string | null;
  githubIssueUrl?: string | null;
  githubIssueNumber?: number | null;
  reviewNote?: string | null;
  createdAt: string;
}

export interface AtsCheck {
  name: string;
  passed: boolean;
  detail: string | null;
}

export interface Recommendation {
  recommendationId: string;
  role: { id: string; title: string; description: string };
  matchScore: number;
  matchedSkills: string[];
  missingSkills: string[];
}

/** `GET /recommendations/dashboard`; `atsScore.max_score` is snake_case in the JSON, kept as it is. */
export interface DashboardResponse {
  resumeId: string;
  atsScore: { score: number; max_score: number; checks: AtsCheck[] };
  domain: { name: string; confidence: number } | null;
  recommendations: Recommendation[];
  recommendationsLocked?: boolean;
  lockReason?: string | null;
  explanation: string;
  explanationSource?: string;
}
