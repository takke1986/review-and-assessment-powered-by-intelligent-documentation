import { REVIEW_JOB_STATUS } from "../model/review";

/**
 * このジョブを元に、もう一度審査を流せるか。
 *
 * 完了したジョブだけを対象にしていたが、それでは途中で終わった審査を
 * 救えない。10項目のうち8項目まで終わって落ちたジョブは、画面から何も
 * できず、文書を上げ直して最初からやり直すしかなかった。済んだ8項目の
 * 費用も時間も捨てることになる。
 *
 * 引き継ぎの処理は元から「完了した項目は写し、そうでない項目は審査し直す」
 * 作りなので、失敗も中止もそのまま続きから流せる。
 *
 * まだ走っているものは対象にしない。同じ項目を二重に審査してしまう
 */
export const canReviewAgain = (status: REVIEW_JOB_STATUS): boolean =>
  status === REVIEW_JOB_STATUS.COMPLETED ||
  status === REVIEW_JOB_STATUS.FAILED ||
  status === REVIEW_JOB_STATUS.CANCELLED;

/**
 * 途中で終わったジョブか。
 *
 * 画面の言い回しを変えるのに使う。完了なら「不合格を審査し直す」、
 * 途中で終わったなら「続きから」で、利用者のすることが違う
 */
export const endedEarly = (status: REVIEW_JOB_STATUS): boolean =>
  status === REVIEW_JOB_STATUS.FAILED || status === REVIEW_JOB_STATUS.CANCELLED;
