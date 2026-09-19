import type { ApiResponse } from "../../types/api";

/**
 * 費用の内訳。
 * GET /review-jobs/cost-summary
 */
export interface ReviewCostSummary {
  total: {
    totalCost: number;
    jobCount: number;
    averageCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
  /** 古い順 */
  byMonth: Array<{ month: string; totalCost: number; jobCount: number }>;
  /** 高い順 */
  byChecklist: Array<{
    checkListSetId: string;
    name: string;
    totalCost: number;
    jobCount: number;
  }>;
  /** 高い順、最大10件 */
  topJobs: Array<{
    id: string;
    name: string;
    totalCost: number;
    createdAt: string;
  }>;
}

export type GetReviewCostSummaryResponse = ApiResponse<ReviewCostSummary>;
