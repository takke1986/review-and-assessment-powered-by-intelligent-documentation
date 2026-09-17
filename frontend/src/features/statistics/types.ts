import { ApiResponse } from "../../types/api";

/** 傾向画面で出す状態。バックエンドの check-trend-status と対応する */
export const CHECK_TREND_STATUS = {
  NOT_REVIEWED_RECENTLY: "not_reviewed_recently",
  INSUFFICIENT_DATA: "insufficient_data",
  NEEDS_GUIDANCE: "needs_guidance",
  OPERATIONAL_ISSUE: "operational_issue",
  STABLE: "stable",
} as const;

export type CHECK_TREND_STATUS =
  (typeof CHECK_TREND_STATUS)[keyof typeof CHECK_TREND_STATUS];

export interface CheckFailureTrendItem {
  checkId: string;
  name: string;
  reviewedCount: number;
  failedCount: number;
  /** 0〜1 */
  failRate: number;
  averageConfidence: number | null;
  lastFailedAt: string | null;
  /** 再審査で引き継いだ回数。審査し直していないことを示す */
  carriedOverCount: number;
  /** 次に何をすべきかを示す状態 */
  status: CHECK_TREND_STATUS;
}

export type GetCheckFailureTrendsResponse = ApiResponse<{
  reviewJobCount: number;
  items: CheckFailureTrendItem[];
}>;
