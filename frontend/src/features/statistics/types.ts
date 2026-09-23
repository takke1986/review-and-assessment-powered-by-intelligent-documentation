import { ApiResponse } from "../../types/api";

/** 傾向画面で出す状態。バックエンドの check-trend-status と対応する */
export const CHECK_TREND_STATUS = {
  NOT_REVIEWED_RECENTLY: "not_reviewed_recently",
  INSUFFICIENT_DATA: "insufficient_data",
  /** AI が合格にしたものを人が不合格に直している。見落としている */
  MISSES_THINGS: "misses_things",
  /** AI が不合格にしたものを人が合格に戻している。厳しすぎる */
  TOO_STRICT: "too_strict",
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
  /** 直近で不合格になった審査ジョブ。結果を見に行く先 */
  lastFailedReviewJobId: string | null;
  /** 再審査で引き継いだ回数。審査し直していないことを示す */
  carriedOverCount: number;
  /** AI が合格にしたものを人が不合格に直した回数 */
  missedCount: number;
  /** AI が不合格にしたものを人が合格に戻した回数 */
  overturnedToPassCount: number;
  /** 着眼点を書いたあと、覆されにくくなったか。着眼点が無ければ null */
  guidanceEffect: {
    writtenAt: string;
    before: { reviewed: number; overturned: number };
    after: { reviewed: number; overturned: number };
  } | null;
  /** 次に何をすべきかを示す状態 */
  status: CHECK_TREND_STATUS;
}

export type GetCheckFailureTrendsResponse = ApiResponse<{
  reviewJobCount: number;
  items: CheckFailureTrendItem[];
}>;

/** 横断一覧の1行。セット同士を比べるための要約で、項目は含まない */
export interface CheckListSetTrendSummary {
  checkListSetId: string;
  name: string;
  departmentId: string | null;
  /** 末端のチェック項目の数 */
  itemCount: number;
  reviewJobCount: number;
  /** 0〜1。審査が無ければ null（0% とは違う） */
  failRate: number | null;
  /** 手を入れる価値がある項目の数 */
  actionableCount: number;
  /** 傾向として読むには審査が足りない */
  insufficientData: boolean;
  missedCount: number;
  overturnedToPassCount: number;
  lastReviewedAt: string | null;
}

export type GetCheckListSetTrendsResponse = ApiResponse<{
  items: CheckListSetTrendSummary[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}>;
