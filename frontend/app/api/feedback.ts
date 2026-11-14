import { get, post } from '@/lib/http';

// Backed by com.resumeanalyser.feedback.FeedbackController.

export interface Feedback {
  id: string;
  recommendationId: string;
  skillVectorVersionId: string;
  helpful: boolean;
  createdAt: string;
}

/** Records whether the person found a recommendation helpful. */
export const submitFeedback = (recommendationId: string, helpful: boolean) => post<Feedback>('/feedback', { json: { recommendationId, helpful } });

/** The latest feedback for a recommendation, or null (204) if none yet. */
export const getFeedbackFor = (recommendationId: string) => get<Feedback | null>(`/feedback/${encodeURIComponent(recommendationId)}`);
