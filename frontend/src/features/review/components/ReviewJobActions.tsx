import { useTranslation } from "react-i18next";
import Button from "../../../components/Button";
import ReviewResultExportButton from "./ReviewResultExportButton";
import ReviewResultTextButton from "./ReviewResultTextButton";
import { useReviewJobActions } from "../hooks/useReviewJobActions";
import { canReviewAgain, endedEarly } from "../reviewJobRules";
import { isJobRunning, type ReviewJobDetail } from "../types";

interface ReviewJobActionsProps {
  job: ReviewJobDetail;
  /** 状態が変わったら詳細を読み直す */
  onChanged: () => void;
}

/**
 * この審査に対してできること。
 *
 * 止める・公開する・もう一度流す・持ち出す、と種類が増えたので、
 * 見出しの中に並べたままだと何がいつ出るのか追えなくなっていた。
 *
 * 出す・出さないの判断はここに集める。直せるかどうかはサーバの返事に従い、
 * 画面では判定しない
 */
export default function ReviewJobActions({
  job,
  onChanged,
}: ReviewJobActionsProps) {
  const { t } = useTranslation();
  const actions = useReviewJobActions(job.id, onChanged);
  // 持ち主かどうかはサーバが答える。画面側で判定すると規則がずれる
  const canEdit = job.canEdit !== false;

  return (
    <>
      <div className="flex flex-col items-stretch gap-2 self-start">
        {/* 走っている審査は止められる。間違えて始めたときに、終わるまで
            待って費用も払うのはおかしい */}
        {canEdit && isJobRunning(job.status) && (
          <Button
            variant="danger"
            outline
            disabled={actions.isWorking}
            onClick={() => {
              if (window.confirm(t("review.cancelConfirm"))) {
                actions.cancel();
              }
            }}>
            {t("review.cancel")}
          </Button>
        )}

        {/* 社内への公開は画面から外した。承認も他部署への受け渡しも製品の
            外で運用するので使い道がなく、申込書の個人情報を全員に見せられる
            操作が残っているほうが危ない。
            仕組み（列と API）は残してあるので、要るようになったら戻せる */}
        {!canEdit && (
          <p className="rounded-lg border border-light-gray bg-aws-paper-light p-3 text-sm text-aws-font-color-gray">
            {t("review.sharedByOther")}
          </p>
        )}
      </div>

      {canReviewAgain(job.status) && (
        <div className="flex flex-col items-stretch gap-2 self-start">
          {/* 完了なら不合格を審査し直す。途中で終わっていれば続きから。
              することが違うので、言い回しを変える */}
          <Button
            to={`/review/create?source=${job.id}`}
            variant="primary"
            outline>
            {endedEarly(job.status)
              ? t("review.resumeReview")
              : t("review.rerunFailedItems")}
          </Button>

          {/* 紙に出す。顧客に渡したり綴じたりするのは画面の外 */}
          <Button to={`/review/${job.id}/report`} variant="secondary" outline>
            {t("review.report.open")}
          </Button>

          {/* 文章にして写す。メール文の下書きは生成AIに任せることが多い */}
          <ReviewResultTextButton
            jobId={job.id}
            jobName={job.name}
            checkListName={job.checkList.name}
            completedAt={job.completedAt}
            documents={job.documents}
          />

          {/* 表計算ソフトに持ち出す。並べ替えや集計は手元の方が早い */}
          <ReviewResultExportButton
            jobId={job.id}
            jobName={job.name}
            documents={job.documents}
          />
        </div>
      )}
    </>
  );
}
