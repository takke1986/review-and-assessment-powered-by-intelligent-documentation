import { ApiResponse } from "../../types/api";

export interface CheckFailureTrendItem {
  checkId: string;
  name: string;
  reviewedCount: number;
  failedCount: number;
  /** 0〜1 */
  failRate: number;
  averageConfidence: number | null;
  lastFailedAt: string | null;
}

export type GetCheckFailureTrendsResponse = ApiResponse<{
  reviewJobCount: number;
  items: CheckFailureTrendItem[];
}>;
