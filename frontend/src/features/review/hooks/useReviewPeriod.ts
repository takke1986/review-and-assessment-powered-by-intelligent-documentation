import { useMemo, useState } from "react";

/** 費用を見るときの期間。値は URL のクエリにもそのまま使う */
export type ReviewPeriod = "all" | "thisMonth" | "last30Days";

export const REVIEW_PERIODS: ReviewPeriod[] = [
  "all",
  "thisMonth",
  "last30Days",
];

/**
 * 期間の始まりを求める。終わりは「いま」なので指定しない。
 *
 * 月初は利用者の時間帯で数える。UTC で切ると、日本では月初の朝9時までが
 * 前の月に入ってしまい、月の請求と合わなくなる
 */
export function periodStart(
  period: ReviewPeriod,
  now: Date = new Date()
): Date | undefined {
  switch (period) {
    case "thisMonth":
      return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    case "last30Days": {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      return start;
    }
    default:
      return undefined;
  }
}

/** 期間の選択と、API に渡す形を持つ */
export function useReviewPeriod(initial: ReviewPeriod = "all") {
  const [period, setPeriod] = useState<ReviewPeriod>(initial);
  // 期間が変わったときだけ計算し直す。毎描画で「いま」が動くと
  // SWR のキーが変わり続け、一覧を読み直し続けることになる
  const createdFrom = useMemo(() => periodStart(period), [period]);
  return { period, setPeriod, createdFrom };
}
