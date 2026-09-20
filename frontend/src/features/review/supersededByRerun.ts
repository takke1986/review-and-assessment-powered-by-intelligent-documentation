import { REVIEW_JOB_STATUS } from "./types";

/**
 * 再審査されたジョブかどうか。バックエンドの同名の判定と同じ決め方にする。
 *
 * 再審査ジョブは作られた時点で元の結果を写すので、あとから元の判定を変えても
 * 新しい方には伝わらない。同じ項目が食い違って見えるだけになる。
 * 実行中の再審査も対象にする（写している最中に変えられると決まらない）。
 * 失敗した再審査は数えない。元のジョブが唯一の結果なので、直せる必要がある
 */
export const isSupersededByRerun = (
  rerunJobs: Array<{ status: REVIEW_JOB_STATUS }> | undefined
): boolean =>
  (rerunJobs ?? []).some((rerun) => rerun.status !== REVIEW_JOB_STATUS.FAILED);
