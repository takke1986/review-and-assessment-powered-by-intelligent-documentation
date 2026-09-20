import { useParams, useNavigate, Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { mutate } from "swr";
import { useTranslation } from "react-i18next";
import ReviewResultTree from "../components/ReviewResultTree";
import ReviewResultFilter from "../components/ReviewResultFilter";
import { FilterType } from "../hooks/useReviewResultQueries";
import { useReviewJobDetail } from "../hooks/useReviewJobQueries";
import { useJobCompletionNotice } from "../hooks/useJobCompletionNotice";
import { isSupersededByRerun } from "../supersededByRerun";
import { ErrorAlert } from "../../../components/ErrorAlert";
import Slider from "../../../components/Slider";
import { DetailSkeleton } from "../../../components/Skeleton";
import { isJobRunning, REVIEW_JOB_STATUS } from "../types";
import Breadcrumb from "../../../components/Breadcrumb";
import TotalReviewCostSummary from "../components/TotalReviewCostSummary";
import Button from "../../../components/Button";
import ReviewJobDocuments from "../components/ReviewJobDocuments";
import ReviewResultExportButton from "../components/ReviewResultExportButton";
import ReviewResultTextButton from "../components/ReviewResultTextButton";
import ImportanceFilter from "../../checklist/components/ImportanceFilter";
import type { ImportanceFilterValue } from "../../checklist/types";

export default function ReviewDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Start with showing fail items
  const [filter, setFilter] = useState<FilterType>("fail");
  const [importanceFilter, setImportanceFilter] =
    useState<ImportanceFilterValue>("all");
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.7);

  // Get review job details
  const {
    job,
    isLoading: isLoadingJob,
    error: jobError,
    refetch: refetchJob,
  } = useReviewJobDetail(id || null);

  // 開いているジョブが終わったら知らせる。別のタブに移っていても届く
  useJobCompletionNotice(useMemo(() => (job ? [job] : []), [job]));

  // 再審査されたジョブの判定は変えられない
  const isSuperseded = isSupersededByRerun(job?.rerunJobs);

  // 実行中は、項目の審査が終わるたびに結果のツリーも読み直す。
  // 最後に親の判定がまとまるので、ジョブの状態が変わったときも読み直す
  const completedCount = job?.progress?.completed;
  const jobStatus = job?.status;
  useEffect(() => {
    if (!id || completedCount === undefined) {
      return;
    }
    mutate(
      (key) =>
        typeof key === "string" &&
        key.startsWith(`/review-jobs/${id}/results`)
    );
  }, [id, completedCount, jobStatus]);

  // When filter state changes
  const handleFilterChange = (newFilter: FilterType) => {
    setFilter(newFilter);
  };

  // Loading state
  if (isLoadingJob) {
    return <DetailSkeleton lines={8} />;
  }

  // Error state
  if (jobError) {
    return (
      <div className="mt-4">
        <ErrorAlert
          error={jobError}
          title={t("review.loadError")}
          message={t("review.loadErrorMessage")}
          retry={() => {
            refetchJob();
          }}
        />
        <div className="mt-4">
          <Breadcrumb to="/review" label={t("review.backToList")} />
        </div>
      </div>
    );
  }

  // If job not found
  if (!job) {
    return (
      <div className="mt-4">
        <ErrorAlert
          error={t("review.jobNotFound")}
          title={t("common.error")}
          message={t("review.jobNotFound")}
          retry={() => refetchJob()}
        />
        <div className="mt-4">
          <Breadcrumb to="/review" label={t("review.backToList")} />
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Breadcrumb to="/review" label={t("review.backToList")} />
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-aws-squid-ink-light">
              {job.name}
            </h1>
          </div>
          <div className="mt-3 flex items-center justify-between">
            {/* 合計料金表示 */}
            {job.totalCost && (
              <TotalReviewCostSummary
                formattedTotalCost={`$${job.totalCost.toFixed(4)}`}
                summary={{
                  totalInputTokens: job.totalInputTokens || 0,
                  totalOutputTokens: job.totalOutputTokens || 0,
                  itemCount: job.totalCost > 0 ? 1 : 0,
                }}
              />
            )}
          </div>
          <p className="text-aws-font-color-gray">
            {t("review.checklist")}: {job.checkList.name}
          </p>
          {/* 再審査でつながったジョブ */}
          {job.sourceReviewJob && (
            <p className="text-aws-font-color-gray">
              {t("review.rerunOf")}:{" "}
              <Link
                to={`/review/${job.sourceReviewJob.id}`}
                className="text-aws-font-color-blue hover:underline">
                {job.sourceReviewJob.name}
              </Link>
            </p>
          )}
          {job.revisionNote && (
            <p className="whitespace-pre-wrap text-aws-font-color-gray">
              {t("review.revisionNote")}: {job.revisionNote}
            </p>
          )}
          {job.rerunJobs && job.rerunJobs.length > 0 && (
            <div className="text-aws-font-color-gray">
              {t("review.rerunJobs")}:
              <ul className="ml-5 list-disc">
                {job.rerunJobs.map((rerun) => (
                  <li key={rerun.id}>
                    <Link
                      to={`/review/${rerun.id}`}
                      className="text-aws-font-color-blue hover:underline">
                      {rerun.name}
                    </Link>{" "}
                    <span className="text-sm">
                      ({t(`status.${rerun.status}`)},{" "}
                      {new Date(rerun.createdAt).toLocaleString()})
                    </span>
                    {rerun.revisionNote && (
                      <p className="whitespace-pre-wrap text-sm">
                        {rerun.revisionNote}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-aws-font-color-gray">
            {t("review.status")}:&nbsp;
            <span
              className={`font-medium ${
                job.status === REVIEW_JOB_STATUS.COMPLETED
                  ? "text-green-600"
                  : job.status === REVIEW_JOB_STATUS.FAILED
                    ? "text-red-600"
                    : "text-yellow-600"
              }`}>
              {t(`status.${job.status}`)}
            </span>
          </p>
          {/* 実行中は、審査が終わった項目の数を出す */}
          {isJobRunning(job.status) && job.progress && (
            <div className="text-aws-font-color-gray">
              <p>
                {t("review.progress", {
                  completed: job.progress.completed,
                  total: job.progress.total,
                })}
              </p>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={job.progress.total}
                aria-valuenow={job.progress.completed}
                className="mt-1 h-2 w-64 max-w-full overflow-hidden rounded bg-light-gray">
                <div
                  className="h-full bg-aws-sea-blue-light transition-all"
                  style={{
                    width: `${
                      job.progress.total > 0
                        ? (job.progress.completed / job.progress.total) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}
          <p className="text-aws-font-color-gray">
            {t("review.createdAt")}: {new Date(job.createdAt).toLocaleString()}
          </p>
          {job.completedAt && (
            <p className="text-aws-font-color-gray">
              {t("review.completedAt", "Completed At")}:{" "}
              {new Date(job.completedAt).toLocaleString()}
            </p>
          )}
        </div>
        {job.status === REVIEW_JOB_STATUS.COMPLETED && (
          <div className="flex flex-col items-stretch gap-2 self-start">
            {/* 不合格の項目を、差し替えた文書で審査し直す */}
            <Button
              to={`/review/create?source=${job.id}`}
              variant="primary"
              outline>
              {t("review.rerunFailedItems")}
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
      </div>

      {/* 審査した文書（再審査では差し替え前と差し替え後） */}
      <ReviewJobDocuments
        documents={job.documents}
        sourceJob={job.sourceReviewJob}
      />

      {/* Error details */}
      {job.hasError && job.errorDetail && (
        <div className="mb-6">
          <ErrorAlert
            error={job.errorDetail}
            title={t("common.processingError")}
            message={job.errorDetail}
          />
        </div>
      )}

      {/* Review results */}
      <div className="rounded-lg border border-light-gray bg-white p-6 shadow-md">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-medium text-aws-squid-ink-light">
              {t("review.results")}
            </h2>
            {/* 再審査されたジョブでは判定を変えられない。ボタンが無い理由を
                書かないと、権限の問題だと思われる */}
            {isSuperseded && job.rerunJobs?.[0] && (
              <p className="mt-1 text-sm text-aws-font-color-gray">
                {t("review.supersededByRerun")}{" "}
                <Link
                  to={`/review/${job.rerunJobs[0].id}`}
                  className="text-aws-font-color-blue hover:underline">
                  {job.rerunJobs[0].name}
                </Link>
              </p>
            )}
            {/* 項目を選んで作ったジョブ。選ばなかった項目は結果に出ない */}
            {job.checkItemCounts &&
              job.checkItemCounts.reviewed < job.checkItemCounts.total && (
                <p className="mt-1 text-sm text-aws-font-color-gray">
                  {t("review.partialCheckItems", {
                    reviewed: job.checkItemCounts.reviewed,
                    total: job.checkItemCounts.total,
                  })}
                </p>
              )}
          </div>
          {/* 携帯では幅いっぱいに。w-64 だと画面からはみ出す */}
          <div className="w-full sm:w-64">
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={confidenceThreshold}
              onChange={setConfidenceThreshold}
              label={t("review.confidenceThreshold")}
            />
          </div>
        </div>

        {/* Filtering */}
        <div className="flex flex-wrap items-center gap-x-6">
          <ReviewResultFilter filter={filter} onChange={handleFilterChange} />
          <ImportanceFilter
            value={importanceFilter}
            onChange={setImportanceFilter}
            name="review-importance-filter"
            className="mb-4"
          />
        </div>

        {/* Tree view */}
        <ReviewResultTree
          jobId={id!}
          confidenceThreshold={confidenceThreshold}
          maxDepth={2}
          filter={filter}
          importanceFilter={importanceFilter}
        />
      </div>
    </div>
  );
}
