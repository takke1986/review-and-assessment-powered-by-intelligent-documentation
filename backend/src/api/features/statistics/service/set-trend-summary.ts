/**
 * チェックリストを横断して「どれに手を入れるべきか」を決めるための集計。
 *
 * 個別の傾向（check-failure-trends）は1セットの中の項目を並べる。こちらは
 * セット同士を比べるためのもので、項目1件ずつは返さない。
 *
 * 並びの既定を不合格率にしない理由:
 *   1回しか審査していない項目は 100% か 0% になりやすく、不合格率で並べると
 *   判断材料の薄いセットが先頭に来る。手を入れる価値のある項目の数で並べ、
 *   審査回数が少ないセットは「判断に足りない」として順位を上げない。
 */

import {
  CHECK_TREND_STATUS,
  decideCheckTrendStatus,
} from "./check-trend-status";

/** 手を付ける先がある状態。STABLE と判断材料不足は含めない */
export const ACTIONABLE_STATUSES: CHECK_TREND_STATUS[] = [
  CHECK_TREND_STATUS.MISSES_THINGS,
  CHECK_TREND_STATUS.TOO_STRICT,
  CHECK_TREND_STATUS.NEEDS_GUIDANCE,
  CHECK_TREND_STATUS.OPERATIONAL_ISSUE,
];

export const isActionable = (status: CHECK_TREND_STATUS): boolean =>
  ACTIONABLE_STATUSES.includes(status);

/** 1つのチェック項目について、状態を決めるのに要る数 */
export interface CheckItemCounts {
  checkId: string;
  checkListSetId: string;
  reviewedCount: number;
  failedCount: number;
  carriedOverCount: number;
  averageConfidence: number | null;
  missedCount: number;
  overturnedToPassCount: number;
}

export interface CheckListSetTrendSummary {
  checkListSetId: string;
  name: string;
  /** 部署。付いていないセットもある */
  departmentId: string | null;
  /** 末端のチェック項目の数。セットの大きさが分かる */
  itemCount: number;
  reviewJobCount: number;
  /** 末端項目の判定を合計した不合格率。0〜1。審査が無ければ null */
  failRate: number | null;
  /** 手を入れる価値がある項目の数 */
  actionableCount: number;
  /** 傾向として読むには審査が足りない。この間は順位を上げない */
  insufficientData: boolean;
  missedCount: number;
  overturnedToPassCount: number;
  lastReviewedAt: Date | null;
}

/** これ未満の審査回数のセットは、割合を読んでも雑音の方が大きい */
export const FEW_REVIEW_JOBS = 2;

/**
 * 項目ごとの数を、セット単位の要約にまとめる。
 *
 * DB を引く部分と分けてあるのは、ここが並び順と「判断に足りない」の
 * 線引きを決めており、テストで押さえたい箇所だから。
 */
export const summarizeSets = (params: {
  sets: Array<{
    id: string;
    name: string;
    departmentId: string | null;
    reviewJobCount: number;
    lastReviewedAt: Date | null;
  }>;
  items: CheckItemCounts[];
}): CheckListSetTrendSummary[] => {
  const itemsBySet = new Map<string, CheckItemCounts[]>();
  for (const item of params.items) {
    const list = itemsBySet.get(item.checkListSetId);
    if (list) {
      list.push(item);
    } else {
      itemsBySet.set(item.checkListSetId, [item]);
    }
  }

  return params.sets.map((set) => {
    const items = itemsBySet.get(set.id) ?? [];
    const reviewed = items.reduce((sum, item) => sum + item.reviewedCount, 0);
    const failed = items.reduce((sum, item) => sum + item.failedCount, 0);
    const statuses = items.map((item) =>
      decideCheckTrendStatus({
        reviewedCount: item.reviewedCount,
        carriedOverCount: item.carriedOverCount,
        failRate:
          item.reviewedCount === 0 ? 0 : item.failedCount / item.reviewedCount,
        averageConfidence: item.averageConfidence,
        missedCount: item.missedCount,
        overturnedToPassCount: item.overturnedToPassCount,
      })
    );

    return {
      checkListSetId: set.id,
      name: set.name,
      departmentId: set.departmentId,
      itemCount: items.length,
      reviewJobCount: set.reviewJobCount,
      failRate: reviewed === 0 ? null : failed / reviewed,
      actionableCount: statuses.filter(isActionable).length,
      // 審査そのものが少ないセットは、項目ごとの状態も読めない
      insufficientData:
        set.reviewJobCount > 0 && set.reviewJobCount < FEW_REVIEW_JOBS,
      missedCount: items.reduce((sum, item) => sum + item.missedCount, 0),
      overturnedToPassCount: items.reduce(
        (sum, item) => sum + item.overturnedToPassCount,
        0
      ),
      lastReviewedAt: set.lastReviewedAt,
    };
  });
};

/** 一覧で並べ替えられる列 */
export const SET_TREND_SORT_KEYS = [
  "name",
  "reviewJobCount",
  "failRate",
  "actionableCount",
  "overturned",
  "lastReviewedAt",
] as const;
export type SetTrendSortKey = (typeof SET_TREND_SORT_KEYS)[number];

export const isSetTrendSortKey = (value: unknown): value is SetTrendSortKey =>
  typeof value === "string" &&
  (SET_TREND_SORT_KEYS as readonly string[]).includes(value);

/**
 * 並べ替える。
 *
 * 値の無いもの（未審査など）は、どちら向きでも最後に置く。先頭に空欄が
 * 並ぶと、見たいものが下に押し出されるため。
 */
export const sortSummaries = (
  rows: CheckListSetTrendSummary[],
  sortBy: SetTrendSortKey,
  sortOrder: "asc" | "desc"
): CheckListSetTrendSummary[] => {
  const direction = sortOrder === "asc" ? 1 : -1;
  const value = (row: CheckListSetTrendSummary): string | number | null => {
    switch (sortBy) {
      case "name":
        return row.name;
      case "reviewJobCount":
        return row.reviewJobCount;
      case "failRate":
        return row.failRate;
      case "overturned":
        // 見落としのほうが重いので、並べたときに上に来るよう重みを付ける
        return row.missedCount * 100 + row.overturnedToPassCount;
      case "lastReviewedAt":
        return row.lastReviewedAt ? row.lastReviewedAt.getTime() : null;
      default:
        return row.actionableCount;
    }
  };

  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    if (typeof left === "string" && typeof right === "string") {
      return left.localeCompare(right) * direction;
    }
    const compared = ((left as number) - (right as number)) * direction;
    if (compared !== 0) return compared;
    // 同じ値の中では、審査の多い順。判断材料の厚いものを先に見せる
    return b.reviewJobCount - a.reviewJobCount;
  });
};
