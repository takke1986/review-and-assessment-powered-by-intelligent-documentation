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
  /** 部署ごと。高い順。部署の付いていない審査は入らない */
  byDepartment: Array<{
    departmentId: string;
    totalCost: number;
    jobCount: number;
  }>;
  /**
   * 部署の付いていない審査のぶん。byDepartment には入らないので、
   * 足しても合計に届かない。その差を画面で説明するために使う
   */
  withoutDepartment: { totalCost: number; jobCount: number };
  /** 高い順 */
  byChecklist: Array<{
    checkListSetId: string;
    name: string;
    totalCost: number;
    jobCount: number;
  }>;
  /** チェックリストの総数。byChecklist は上位だけなので、切った件数が分かる */
  checklistCount: number;
  /** 高い順、最大10件 */
  topJobs: Array<{
    id: string;
    name: string;
    totalCost: number;
    createdAt: string;
  }>;
}

export type GetReviewCostSummaryResponse = ApiResponse<ReviewCostSummary>;
