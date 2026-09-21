import { REVIEW_JOB_STATUS } from "./types";

/**
 * 審査ジョブに何ができるかの決まり。
 *
 * バックエンドの同名の判定（superseded-by-rerun / review-again）と
 * 同じ決め方にする。画面と API が食い違うと「ボタンは出るのに押すと
 * 弾かれる」ことになるため、こちらに寄せて1か所にまとめてある。
 *
 * 直せるかどうか（canEdit）はここに置かない。持ち主の判定は
 * サーバが答え、画面はその返事に従う
 */

/**
 * 再審査された古いジョブか。
 *
 * 再審査ジョブは作られた時点で元の結果を写すので、あとから元の判定を
 * 変えても新しい方には伝わらない。実行中の再審査も対象にする（写して
 * いる最中に変えられると決まらない）。失敗した再審査は数えない。
 * 元のジョブが唯一の結果なので、直せる必要がある
 */
export const isSupersededByRerun = (
  rerunJobs: Array<{ status: REVIEW_JOB_STATUS }> | undefined
): boolean =>
  (rerunJobs ?? []).some((rerun) => rerun.status !== REVIEW_JOB_STATUS.FAILED);

/**
 * このジョブに対して、もう一度審査に関する操作ができるか。
 *
 * 完了なら「不合格を審査し直す」（別のジョブを作る）、途中で終わって
 * いれば「続きから」（同じジョブを埋める）。
 * まだ走っているものは対象にしない。同じ項目を二重に審査してしまう
 */
export const canReviewAgain = (status: REVIEW_JOB_STATUS): boolean =>
  status === REVIEW_JOB_STATUS.COMPLETED ||
  status === REVIEW_JOB_STATUS.FAILED ||
  status === REVIEW_JOB_STATUS.CANCELLED;

/**
 * そのジョブのまま続きから流せるか。サーバの canResume と同じ決め方。
 *
 * 続きは条件が何も変わらない（同じ文書、同じチェックリスト、同じ部署）
 * ので、ジョブを増やさずに未判定の項目だけを埋める。中止したジョブが
 * 履歴に残り続けるのを避けるため
 */
export const canResume = (status: REVIEW_JOB_STATUS): boolean =>
  status === REVIEW_JOB_STATUS.FAILED ||
  status === REVIEW_JOB_STATUS.CANCELLED;

/**
 * 途中で終わったジョブか。
 *
 * 完了なら「不合格を審査し直す」、途中で終わったなら「続きから」で、
 * 利用者のすることが違うので、言い回しを変える
 */
export const endedEarly = (status: REVIEW_JOB_STATUS): boolean =>
  status === REVIEW_JOB_STATUS.FAILED ||
  status === REVIEW_JOB_STATUS.CANCELLED;
