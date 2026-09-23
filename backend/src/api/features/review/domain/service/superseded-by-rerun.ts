import { REVIEW_JOB_STATUS } from "../model/review";

/**
 * 再審査されたジョブかどうか。
 *
 * 再審査ジョブは作られた時点で元の結果を写す。あとから元の判定を変えても
 * 新しい方には伝わらないので、同じ項目が「元＝合格／最新＝不合格」と
 * 食い違って見える。集計は元のジョブの行を数えるため、古い方を直すと
 * 統計だけが動き、利用者が見ている最新の画面とずれる。
 *
 * 実行中の再審査も対象にする。いま結果を写している最中に元を変えると、
 * どちらが写るか決まらない。
 *
 * 失敗した再審査は数えない。その場合は元のジョブが唯一の結果なので、
 * 直せなくすると手詰まりになる
 */
export const isSupersededByRerun = (
  rerunJobs: Array<{ status: REVIEW_JOB_STATUS }> | undefined
): boolean =>
  (rerunJobs ?? []).some((rerun) => rerun.status !== REVIEW_JOB_STATUS.FAILED);
