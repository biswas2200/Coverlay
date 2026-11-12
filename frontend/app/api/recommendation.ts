import { get } from '@/lib/http';
import type { DashboardResponse } from './types';

// Backed by com.resumeanalyser.recommendation.RecommendationController.

/** Everything the dashboard renders for the latest resume version, or null (204) when no resume was uploaded yet. */
export const getDashboard = () => get<DashboardResponse | null>('/recommendations/dashboard');
