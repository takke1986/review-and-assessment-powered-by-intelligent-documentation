/**
 * チェック項目の傾向を、次に何をすべきかが分かる状態に翻訳する。
 *
 * 不合格率だけでは行動が決まらない。AI が自信を持って不合格にしているのか、
 * 迷った末の不合格なのかで、直すべき対象が変わるため。
 *
 * 期間比較（直近とそれ以前の差）を足すときは、この関数に引数を増やして
 * 状態を1つ加えるだけで済むようにしてある。
 */

export const CHECK_TREND_STATUS = {
  /** 引き継ぎばかりで、実際に審査し直していない */
  NOT_REVIEWED_RECENTLY: "not_reviewed_recently",
  /** 審査回数が少なく、傾向として読めない */
  INSUFFICIENT_DATA: "insufficient_data",
  /** AI が合格にしたものを人が不合格に直している。見落としている */
  MISSES_THINGS: "misses_things",
  /** AI が不合格にしたものを人が合格に戻している。厳しすぎる */
  TOO_STRICT: "too_strict",
  /** よく落ちるが AI は迷っている。項目の書き方が曖昧な可能性が高い */
  NEEDS_GUIDANCE: "needs_guidance",
  /** よく落ちて AI も確信している。実務側が守れていない */
  OPERATIONAL_ISSUE: "operational_issue",
  /** 落ちにくい。手を付けなくてよい */
  STABLE: "stable",
} as const;

export type CHECK_TREND_STATUS =
  (typeof CHECK_TREND_STATUS)[keyof typeof CHECK_TREND_STATUS];

/** これ未満の審査回数では、割合を読んでも雑音の方が大きい */
export const FEW_REVIEWS = 3;
/** これ以上落ちていれば、手を付ける価値がある */
export const HIGH_FAIL_RATE = 0.5;
/** これ未満の信頼度は、AI が迷っていると見なす */
export const LOW_CONFIDENCE = 0.7;

/**
 * 見落としは回数で見る。
 *
 * AI が合格にしたものを人が不合格に直したということは、そのまま通って
 * いたら見逃していたということ。1回は偶然かもしれないが、2回あれば癖。
 * 割合で見ると、審査回数の多い項目ほど見逃しが薄まってしまう
 */
export const REPEATED_MISSES = 2;

/**
 * 厳しすぎるほうは割合で見る。
 *
 * 誤検知は1件では困らない。困るのは毎回手直しが要ることなので、
 * 何回に1回かで判断する
 */
export const HIGH_OVERTURN_RATE = 0.3;

export const decideCheckTrendStatus = (row: {
  reviewedCount: number;
  carriedOverCount: number;
  failRate: number;
  averageConfidence: number | null;
  /** AI が合格にしたものを人が不合格に直した回数 */
  missedCount: number;
  /** AI が不合格にしたものを人が合格に戻した回数 */
  overturnedToPassCount: number;
}): CHECK_TREND_STATUS => {
  // 引き継ぎだけの項目は割合を出しても前回の写しなので、状態として明示する
  if (row.reviewedCount === 0) {
    return row.carriedOverCount > 0
      ? CHECK_TREND_STATUS.NOT_REVIEWED_RECENTLY
      : CHECK_TREND_STATUS.INSUFFICIENT_DATA;
  }
  if (row.reviewedCount < FEW_REVIEWS) {
    return CHECK_TREND_STATUS.INSUFFICIENT_DATA;
  }

  // 人が覆したという事実は、不合格率より強い。不合格率は上書き後の数字で、
  // すでに人の手で直されたあとのものだから。見落としのほうが実害が大きいので先に見る
  if (row.missedCount >= REPEATED_MISSES) {
    return CHECK_TREND_STATUS.MISSES_THINGS;
  }
  if (row.overturnedToPassCount / row.reviewedCount >= HIGH_OVERTURN_RATE) {
    return CHECK_TREND_STATUS.TOO_STRICT;
  }

  if (row.failRate < HIGH_FAIL_RATE) {
    return CHECK_TREND_STATUS.STABLE;
  }
  if (
    row.averageConfidence !== null &&
    row.averageConfidence < LOW_CONFIDENCE
  ) {
    return CHECK_TREND_STATUS.NEEDS_GUIDANCE;
  }
  return CHECK_TREND_STATUS.OPERATIONAL_ISSUE;
};
