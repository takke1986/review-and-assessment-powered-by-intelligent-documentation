import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { HiPrinter } from "react-icons/hi";
import Button from "../../../components/Button";
import Breadcrumb from "../../../components/Breadcrumb";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { DetailSkeleton } from "../../../components/Skeleton";
import useHttp from "../../../hooks/useHttp";
import { useReviewJobDetail } from "../hooks/useReviewJobQueries";
import {
  REVIEW_RESULT,
  type GetReviewResultItemsResponse,
  type ReviewResultDetail,
} from "../types";
import {
  countVerdicts,
  filenamesById,
  flattenInOrder,
  formatSources,
  verdictLabel,
} from "../utils/reviewReportModel";

/**
 * 紙に出すための審査結果。
 *
 * PDF は作らない。ブラウザの印刷から「PDFとして保存」が使えるうえ、
 * 画面側で PDF を組み立てると日本語のフォントを数MB抱き込むことになる。
 *
 * 顧客にも渡す前提なので、社内の URL やジョブIDは載せない。代わりに
 * ジョブ名を大きく出す。社内で探すときは、一覧の検索窓にそのまま打てる
 */
export default function ReviewReportPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const http = useHttp();
  const { job, isLoading: isLoadingJob, error: jobError } = useReviewJobDetail(
    id || null
  );
  const [results, setResults] = useState<ReviewResultDetail[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  // 紙は一度に全部出る。画面のツリーと違って、開いた枝だけでは意味がない
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    http
      .getOnce<GetReviewResultItemsResponse>(
        `/review-jobs/${id}/results/items`,
        { includeAllChildren: true }
      )
      .then((response) => {
        if (cancelled) return;
        setResults(response.data.success ? response.data.data : []);
      })
      .catch((reason) => !cancelled && setError(reason));
    return () => {
      cancelled = true;
    };
    // http は毎描画で作り直されるので、ジョブが変わったときだけ読む
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (jobError || error) {
    return (
      <div className="mx-auto max-w-4xl p-8">
        <ErrorAlert
          error={jobError || String(error)}
          title={t("review.loadError")}
          message={t("review.loadErrorMessage")}
        />
      </div>
    );
  }

  if (isLoadingJob || !job || results === null) {
    return (
      <div className="mx-auto max-w-4xl p-8">
        <DetailSkeleton lines={10} />
      </div>
    );
  }

  const counts = countVerdicts(results);
  const filenameById = filenamesById(job.documents);
  const rows = flattenInOrder(results);

  return (
    <div className="mx-auto max-w-4xl bg-white p-8 text-aws-squid-ink-light">
      {/* 印刷には出さない操作の帯 */}
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Breadcrumb to={`/review/${job.id}`} label={t("review.backToDetail")} />
        <Button
          variant="primary"
          onClick={() => window.print()}
          icon={<HiPrinter className="h-5 w-5" />}>
          {t("review.report.print")}
        </Button>
      </div>

      {/* 表紙。開かなくても何の審査か分かるようにする */}
      <header className="mb-6 border-b-2 border-aws-squid-ink-light pb-4">
        <p className="text-sm text-aws-font-color-gray">
          {t("review.report.title")}
        </p>
        <h1 className="mt-1 text-3xl font-bold">{job.name}</h1>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-aws-font-color-gray">{t("review.checklist")}</dt>
          <dd>{job.checkList.name}</dd>
          {job.completedAt && (
            <>
              <dt className="text-aws-font-color-gray">
                {t("review.completedAt")}
              </dt>
              <dd>{new Date(job.completedAt).toLocaleDateString()}</dd>
            </>
          )}
          <dt className="text-aws-font-color-gray">{t("review.documents")}</dt>
          <dd>{job.documents.map((d) => d.filename).join("、") || "-"}</dd>
          <dt className="text-aws-font-color-gray">
            {t("review.report.summary")}
          </dt>
          <dd className="font-medium">
            {t("review.report.summaryValue", {
              total: counts.total,
              passed: counts.passed,
              failed: counts.failed,
            })}
          </dd>
        </dl>
      </header>

      <ol className="space-y-3">
        {rows.map(({ result, number, depth }) => {
          const failed = result.result === REVIEW_RESULT.FAIL;
          const sources = formatSources(result, filenameById, t);
          return (
            <li
              key={result.id}
              // 項目が紙の切れ目でちぎれると、判定と理由が別の紙に分かれる
              className="break-inside-avoid"
              style={{ marginLeft: `${depth * 1.25}rem` }}>
              <div className="flex items-baseline gap-2">
                <span className="shrink-0 tabular-nums text-aws-font-color-gray">
                  {number}
                </span>
                <span
                  className={
                    depth === 0 ? "font-bold" : "font-medium"
                  }>
                  {result.checkList.name}
                </span>
                {verdictLabel(result, t) && (
                  <span
                    className={`shrink-0 rounded border px-2 text-sm ${
                      failed
                        ? "border-red text-red"
                        : "border-light-gray text-aws-font-color-gray"
                    }`}>
                    {verdictLabel(result, t)}
                  </span>
                )}
              </div>
              {/* 直すべき点にだけ理由と根拠を書く。合格まで同じ厚みで書くと埋もれる */}
              {failed && (
                <div className="ml-6 mt-1 space-y-0.5 text-sm">
                  {(result.explanation || result.shortExplanation) && (
                    <p>
                      <span className="text-aws-font-color-gray">
                        {t("review.report.reason")}:{" "}
                      </span>
                      {result.explanation || result.shortExplanation}
                    </p>
                  )}
                  {sources.length > 0 && (
                    <p className="text-aws-font-color-gray">
                      {t("review.report.source")}: {sources.join("、")}
                    </p>
                  )}
                  {result.userOverride && result.userComment && (
                    <p>
                      <span className="text-aws-font-color-gray">
                        {t("review.userComment")}:{" "}
                      </span>
                      {result.userComment}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
