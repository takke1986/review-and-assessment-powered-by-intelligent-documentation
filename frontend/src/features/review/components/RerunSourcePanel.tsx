import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ReviewJobDetail } from "../types";

export interface RerunSourcePanelProps {
  /** 再審査の元になるジョブ。読み込むまでは null */
  sourceJob: ReviewJobDetail | null;
}

/**
 * 再審査の作成画面で、チェックリストの選択の代わりに元のジョブを示す。
 * 再審査では元のジョブと同じチェックリストを使う。
 */
export default function RerunSourcePanel({ sourceJob }: RerunSourcePanelProps) {
  const { t } = useTranslation();

  return (
    <div className="rounded-md border border-light-gray bg-white p-4 shadow-sm dark:bg-aws-squid-ink-dark">
      <h3 className="text-lg font-medium text-aws-squid-ink-light dark:text-aws-font-color-white-dark">
        {t("review.rerunSourceJob")}
      </h3>
      {sourceJob ? (
        <>
          <p className="mt-2">
            <Link
              to={`/review/${sourceJob.id}`}
              className="text-aws-font-color-blue hover:underline">
              {sourceJob.name}
            </Link>
          </p>
          <p className="mt-1 text-sm text-aws-font-color-gray">
            {t("review.checklist")}: {sourceJob.checkList.name}
          </p>
        </>
      ) : (
        <div className="flex items-center justify-center p-8">
          <div className="border-primary h-8 w-8 animate-spin rounded-full border-b-2 border-t-2"></div>
        </div>
      )}
    </div>
  );
}
