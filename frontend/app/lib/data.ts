import useSWR from 'swr';
import { listVersions } from '@/api/resume';
import type { ResumeDto } from '@/api/types';

/**
 * The uploaded resume versions, oldest first. One shared request: the sidebar, the version menu and the pages that
 * use the resume all read the same cached answer, and it refreshes in the background.
 */
export function useVersions() {
  return useSWR<ResumeDto[]>('/resumes', listVersions, { revalidateOnFocus: false });
}
