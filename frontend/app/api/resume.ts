import { get, post } from '@/lib/http';
import type { JdMatch, ParsedProfile, ResumeDto } from './types';

// Backed by com.resumeanalyser.resume.ResumeController.

/**
 * Uploads a new resume version (`POST /resumes`, multipart field `file`). The backend analyses it synchronously, so
 * by the time this resolves the parsed profile and the recommendations exist.
 */
export function uploadResume(file: File): Promise<ResumeDto> {
  const formData = new FormData();
  formData.append('file', file);
  return post<ResumeDto>('/resumes', { formData });
}

/** Every resume version the person uploaded, oldest first. */
export const listVersions = () => get<ResumeDto[]>('/resumes');

/** The structured profile extracted from one resume version. */
export const getParsedProfile = (resumeId: string) => get<ParsedProfile>(`/resumes/${encodeURIComponent(resumeId)}/profile`);

/** Re-runs the analysis of an existing version (how a result locked by an AI outage gets its recommendations later). */
export const reanalyze = (resumeId: string) => post(`/resumes/${encodeURIComponent(resumeId)}/reanalyze`);

/** Scores a resume version against a pasted job description. */
export const matchJobDescription = (resumeId: string, jdText: string) =>
  post<JdMatch>(`/resumes/${encodeURIComponent(resumeId)}/jd-match`, { json: { jdText } });
