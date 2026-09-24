/**
 * 傾向画面の見た目の定義。
 *
 * 判定（どの状態か）はバックエンドが返す。ここは「その状態をどう見せるか」
 * だけを持つ。状態を足すときはこのファイルだけ直せば済む。
 */
import { CHECK_TREND_STATUS } from "./types";

/**
 * 状態ごとの見た目・ラベル・行動。判定そのものはバックエンドが返す。
 * 状態を足すときにここ1箇所だけ直せば済むよう、まとめて持つ。
 */
export const STATUS_VIEW: Record<
  CHECK_TREND_STATUS,
  {
    style: string;
    label: string;
    action: string;
    actionable: boolean;
    /**
     * 手を入れる価値の順。大きいほど先に見たい。
     *
     * 状態で並べ替えたときに翻訳された文字列の五十音順になると、
     * 「安定している」が「AI が迷っている」より上に来てしまい、
     * 並べ替える意味がなくなる
     */
    rank: number;
  }
> = {
  [CHECK_TREND_STATUS.MISSES_THINGS]: {
    // 見落としが一番危ない。目で拾えるよう、ほかより強い色にする
    style: "bg-red/10 text-red",
    label: "trends.statusMissesThings",
    action: "trends.actionMissesThings",
    actionable: true,
    rank: 6,
  },
  [CHECK_TREND_STATUS.TOO_STRICT]: {
    style: "bg-yellow-100 text-yellow-800",
    label: "trends.statusTooStrict",
    action: "trends.actionTooStrict",
    actionable: true,
    rank: 4,
  },
  [CHECK_TREND_STATUS.NEEDS_GUIDANCE]: {
    style: "bg-yellow-100 text-yellow-800",
    label: "trends.statusNeedsGuidance",
    action: "trends.actionNeedsGuidance",
    actionable: true,
    rank: 3,
  },
  [CHECK_TREND_STATUS.OPERATIONAL_ISSUE]: {
    style: "bg-red/10 text-red",
    label: "trends.statusOperationalIssue",
    action: "trends.actionOperationalIssue",
    actionable: true,
    rank: 5,
  },
  [CHECK_TREND_STATUS.INSUFFICIENT_DATA]: {
    style: "bg-light-gray text-aws-font-color-gray",
    label: "trends.statusInsufficientData",
    action: "trends.actionInsufficientData",
    actionable: false,
    rank: 1,
  },
  [CHECK_TREND_STATUS.NOT_REVIEWED_RECENTLY]: {
    style: "bg-light-gray text-aws-font-color-gray",
    label: "trends.statusNotReviewedRecently",
    action: "trends.actionNotReviewedRecently",
    actionable: false,
    rank: 2,
  },
  [CHECK_TREND_STATUS.STABLE]: {
    style: "bg-light-gray text-aws-font-color-gray",
    label: "trends.statusStable",
    action: "trends.actionStable",
    actionable: false,
    rank: 0,
  },
};

/** 表の列。見出しを押すと並び替える */
export const SORTABLE_COLUMNS = [
  { key: "name", label: "trends.item", alignRight: false },
  { key: "status", label: "trends.status", alignRight: false },
  { key: "action", label: "trends.action", alignRight: false },
  { key: "overturned", label: "trends.overturned", alignRight: false },
  { key: "failRate", label: "trends.failRate", alignRight: true },
  { key: "failedCount", label: "trends.failed", alignRight: true },
  { key: "reviewedCount", label: "trends.reviewed", alignRight: true },
  { key: "averageConfidence", label: "trends.confidence", alignRight: true },
  { key: "lastFailedAt", label: "trends.lastFailed", alignRight: false },
] as const;

/**
 * 横断一覧の列。既定の並びは「手を入れる項目」の多い順。
 *
 * 不合格率を既定にしない理由は set-trend-summary.ts に書いてある通りで、
 * 1回しか審査していないセットが 100% で先頭に来てしまうため。
 */
interface SetTrendColumn {
  key: string;
  label: string;
  alignRight: boolean;
  /** 並べ替えの対象にしない列。既定は対象にする */
  sortable?: boolean;
}

export const SET_TREND_COLUMNS: SetTrendColumn[] = [
  { key: "name", label: "trends.checkListSet", alignRight: false },
  { key: "reviewJobCount", label: "trends.reviewJobs", alignRight: true },
  { key: "failRate", label: "trends.failRate", alignRight: false },
  { key: "actionableCount", label: "trends.actionableItems", alignRight: true },
  { key: "overturned", label: "trends.overturned", alignRight: true },
  { key: "lastReviewedAt", label: "trends.lastReviewed", alignRight: false },
  // 他の一覧と同じく、行クリックに加えて操作列に詳細ボタンを置く
  {
    key: "actions",
    label: "table.actions",
    alignRight: false,
    sortable: false,
  },
];
