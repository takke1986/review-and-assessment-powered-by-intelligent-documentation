/**
 * Component to display individual review result items
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  ReviewJobDocument,
  ReviewResultDetail,
  REVIEW_RESULT,
  REVIEW_RESULT_STATUS,
  REVIEW_FILE_TYPE,
} from "../types";
import { overriddenByLabel } from "../utils/reviewReportModel";
import { useReviewJobDetail } from "../hooks/useReviewJobQueries";
import ReviewResultOverrideModal from "./ReviewResultOverrideModal";
import Button from "../../../components/Button";
import {
  HiChevronDown,
  HiChevronRight,
  HiPencil,
  HiChevronUp,
  HiEye,
  HiEyeOff,
} from "react-icons/hi";
import Spinner from "../../../components/Spinner";
import DocumentPreview from "../../../components/DocumentPreview";
import { isPdfFileName } from "../../../utils/officeFiles";
import ImagePreview from "../../../components/ImagePreview";
import ReviewItemCostBadge from "./ReviewItemCostBadge";
import { useReviewItemCost } from "../hooks/useReviewItemCost";
import ResultCard, { ResultCardVariant } from "../../../components/ResultCard";
import ExternalSourceItem from "./ExternalSourceItem";
import ImportanceBadge from "../../checklist/components/ImportanceBadge";

interface ReviewResultItemProps {
  result: ReviewResultDetail;
  hasChildren: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  confidenceThreshold: number;
  isLoadingChildren?: boolean;
  documents: ReviewJobDocument[];
  /** 判定を変えられない。再審査された古いジョブか、他の人が公開した審査 */
  readOnly?: boolean;
}

export default function ReviewResultItem({
  result,
  hasChildren,
  isExpanded,
  onToggleExpand,
  confidenceThreshold,
  isLoadingChildren,
  documents,
  readOnly = false,
}: ReviewResultItemProps) {
  const { t } = useTranslation();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [visibleReferencesCount, setVisibleReferencesCount] = useState(5); // 初期表示数
  const [showDetails, setShowDetails] = useState(false); // いかなる場合も詳細を最初は隠した状態に設定
  const costInfo = useReviewItemCost(result); // コスト情報を直接取得

  // 引き継いだ結果は、判定を下したジョブの文書で判定している。
  // そのジョブは詳細を開いたときにだけ読み込む
  const { job: judgedInJob, isLoading: isLoadingJudgedInJob } =
    useReviewJobDetail(
      showDetails && result.judgedInReviewJobId
        ? result.judgedInReviewJobId
        : null
    );
  const judgedDocuments: ReviewJobDocument[] = result.judgedInReviewJobId
    ? (judgedInJob?.documents ?? [])
    : documents;

  // Get source references
  // 根拠は判定に使った文書を指すので、その中にある文書だけを表示する
  const allSourceReferences = result.sourceReferences || [];
  const sourceReferences = allSourceReferences.filter((reference) =>
    judgedDocuments.some((doc) => doc.id === reference.documentId)
  );

  // Add style if confidence is below threshold
  const isBelowThreshold =
    result.confidenceScore !== null &&
    result.confidenceScore !== undefined &&
    result.confidenceScore < confidenceThreshold;

  // Determine badge color and text based on result
  const renderStatusBadge = () => {
    if (result.status === REVIEW_RESULT_STATUS.PROCESSING) {
      return (
        <span className="rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-800">
          {t("status.processing")}
        </span>
      );
    }

    if (result.status === REVIEW_RESULT_STATUS.FAILED) {
      return (
        <span className="bg-red-100 text-red-800 rounded-full px-2 py-1 text-xs">
          {t("status.failed")}
        </span>
      );
    }

    if (result.status === REVIEW_RESULT_STATUS.PENDING) {
      return (
        <span className="bg-yellow-100 text-yellow-800 rounded-full px-2 py-1 text-xs">
          {t("status.pending")}
        </span>
      );
    }

    if (result.result === REVIEW_RESULT.PASS) {
      return (
        <span className="rounded-full bg-green-100 px-2 py-1 text-xs text-green-800">
          {t("review.pass", "Pass")}
        </span>
      );
    }

    if (result.result === REVIEW_RESULT.FAIL) {
      return (
        <span className="bg-red-100 text-red-800 rounded-full px-2 py-1 text-xs">
          {t("review.fail", "Fail")}
        </span>
      );
    }

    return (
      <span className="bg-gray-100 text-gray-800 rounded-full px-2 py-1 text-xs">
        {t("common.unknown")}
      </span>
    );
  };

  // User override badge
  const renderUserOverrideBadge = () => {
    if (result.userOverride) {
      const who = overriddenByLabel(result, t);
      return (
        <span
          className="ml-2 rounded-full bg-aws-sea-blue-light bg-opacity-20 px-2 py-1 text-xs text-aws-sea-blue-light"
          // 公開した審査では、誰が決めたのかが要る。札を増やすと行が
          // 埋まるので、印に重ねて出す
          title={who || undefined}>
          {t("review.userOverride", "User Override")}
          {result.overriddenBy ? `: ${result.overriddenBy}` : ""}
        </span>
      );
    }
    return null;
  };

  // 再審査: 引き継いだ結果か、前回の判定を示す
  const renderHistoryBadge = () => {
    if (result.carriedOver) {
      return (
        <span className="ml-2 rounded-full bg-light-gray px-2 py-1 text-xs text-aws-squid-ink-light">
          {t("review.carriedOverBadge")}
        </span>
      );
    }
    if (result.previousResult?.result === REVIEW_RESULT.FAIL) {
      return (
        <span className="bg-red-100 text-red-800 ml-2 rounded-full px-2 py-1 text-xs">
          {t("review.previousFail")}
        </span>
      );
    }
    if (result.previousResult?.result === REVIEW_RESULT.PASS) {
      return (
        <span className="ml-2 rounded-full bg-green-100 px-2 py-1 text-xs text-green-800">
          {t("review.previousPass")}
        </span>
      );
    }
    return null;
  };

  // Display confidence score
  const renderConfidenceScore = () => {
    if (result.confidenceScore === null) return null;

    // Determine color based on confidence score
    const getScoreColor = () => {
      if (
        result.confidenceScore !== undefined &&
        result.confidenceScore >= confidenceThreshold
      )
        return "text-aws-lab";
      return "text-yellow";
    };

    return (
      <span
        className={`text-sm ${getScoreColor()} ${
          isBelowThreshold ? "font-bold" : ""
        }`}>
        {t("review.confidence", "Confidence")}:{" "}
        {result.confidenceScore !== undefined
          ? Math.round(result.confidenceScore * 100)
          : 0}
        %{isBelowThreshold && <span className="ml-1 text-yellow">⚠️</span>}
      </span>
    );
  };

  // Fallback if checkList is undefined
  if (!result.checkList) {
    return (
      <div className="rounded-md border border-light-gray bg-white p-4">
        <div className="text-red">
          {t("review.dataError", "Data Error")}:{" "}
          {t("review.noChecklistInfo", "No checklist information")} (ID:{" "}
          {result.checkId})
        </div>
        <div className="mt-2">
          <Button
            onClick={() => window.location.reload()}
            variant="secondary"
            size="sm">
            {t("common.retry")}
          </Button>
        </div>
      </div>
    );
  }

  // Determine card variant based on result status
  const getCardVariant = (): ResultCardVariant => {
    if (result.result === REVIEW_RESULT.PASS) return "success";
    if (result.result === REVIEW_RESULT.FAIL) return "error";
    return "default";
  };

  return (
    <>
      <ResultCard
        variant={getCardVariant()}
        emphasize={isBelowThreshold}
      >
        {/* 開閉の印と中身の2列。信頼度は上段に移したので、右端の列は空だった */}
        <div
          id={`result-item-${result.id}`}
          className="grid grid-cols-[auto_1fr] gap-2 sm:gap-4">
          {/* Expand/collapse button - 1st column */}
          <div className="pt-1">
            {hasChildren && (
              <Button
                onClick={onToggleExpand}
                variant="text"
                size="sm"
                className="p-0"
                disabled={isLoadingChildren}>
                {isExpanded ? (
                  isLoadingChildren ? (
                    <Spinner size="sm" />
                  ) : (
                    <HiChevronDown className="h-5 w-5" />
                  )
                ) : (
                  <HiChevronRight className="h-5 w-5" />
                )}
              </Button>
            )}
          </div>

          {/* Item information - 2nd column */}
          {/* min-w-0 が無いと、中身が長いときに列が縮まず画面からはみ出す */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* 項目名とバッジ。携帯では1行に収まらないので折り返す */}
              <div className="flex min-w-0 flex-wrap items-center gap-y-1">
                <div className="break-words font-medium text-aws-squid-ink-light">
                  {result.checkList.name}
                </div>
                <div className="ml-2">
                  {renderStatusBadge()}
                  {renderUserOverrideBadge()}
                  {renderHistoryBadge()}
                </div>
                {/* 信頼度スコアと料金を上段に表示 */}
                {!hasChildren && renderConfidenceScore() && (
                  <div className="ml-3 flex items-center space-x-2">
                    {renderConfidenceScore()}
                    {costInfo.hasCost && (
                      <ReviewItemCostBadge
                        formattedCost={costInfo.formattedCost}
                        size="sm"
                      />
                    )}
                  </div>
                )}
                {/* 重要度は信頼度の右に出す */}
                {!hasChildren && (
                  <ImportanceBadge
                    importance={result.checkList.importance}
                    className="ml-3"
                  />
                )}
              </div>

              {/* アクションボタンを上段の右側に配置 */}
              <div className="flex items-center space-x-3">
                <Button
                  onClick={() => setShowDetails(!showDetails)}
                  outline
                  size="sm"
                  className="text-aws-font-color-blue"
                  icon={
                    showDetails ? (
                      <HiEyeOff className="h-4 w-4" />
                    ) : (
                      <HiEye className="h-4 w-4" />
                    )
                  }>
                  {showDetails
                    ? t("review.hideDetails", "Hide Details")
                    : t("review.showDetails", "Show Details")}
                </Button>

                {/* 上書きボタンを同じ行に配置。
                    再審査された古いジョブでは出さない。直しても新しい方には
                    伝わらず、同じ項目が食い違って見えるだけになる */}
                {!hasChildren &&
                  !readOnly &&
                  result.status === REVIEW_RESULT_STATUS.COMPLETED && (
                    <Button
                      onClick={() => setIsModalOpen(true)}
                      outline
                      size="sm"
                      className="text-aws-font-color-blue"
                      icon={<HiPencil className="h-4 w-4" />}>
                      {t("review.overrideResult", "Override Result")}
                    </Button>
                  )}
              </div>
            </div>

            {/* 見られる画像の枚数に達した判定。全部を見たわけではないので、
                人が確かめられるようにここで断っておく。黙っていると
                「全部見たうえでの判定」だと思われる */}
            {result.reviewMeta?.imageLimitReached && (
              <div className="mt-1 rounded border border-aws-squid-ink-light/20 bg-yellow-50 px-2 py-1">
                <p className="text-xs text-aws-font-color-gray">
                  {t("review.imageLimitReached", {
                    seen: result.reviewMeta.imagesSeen ?? 0,
                  })}
                </p>
              </div>
            )}

            {/* 本文を一部しか読んでいない書類。「見つからない」判定では、読んだ
                範囲が判断の材料になるので、人が確かめられるように出す。
                合格の判定では、検索で見つけた箇所だけ読むのは普通なので目立たせない */}
            {result.reviewMeta?.coverage
              ?.filter((entry) => entry.read < entry.total)
              .map((entry) => (
                <div
                  key={entry.file}
                  className={`mt-1 rounded px-2 py-1 ${
                    result.result === REVIEW_RESULT.FAIL
                      ? "border border-aws-squid-ink-light/20 bg-yellow-50"
                      : ""
                  }`}>
                  <p className="text-xs text-aws-font-color-gray">
                    {t(
                      entry.unit === "page"
                        ? "review.coveragePages"
                        : "review.coverageSections",
                      {
                        file: entry.file,
                        total: entry.total,
                        read: entry.read,
                        unread: entry.unread,
                      }
                    )}
                  </p>
                </div>
              ))}

            {/* 短い説明文を表示 */}
            {result.shortExplanation && (
              <div className="mt-1">
                <p className="text-sm text-aws-font-color-gray">
                  {result.shortExplanation}
                </p>
              </div>
            )}

            {/* 説明文と抽出テキスト */}
            {showDetails &&
              (result.explanation ||
                result.previousResult ||
                result.extractedText ||
                result.userComment ||
                result.checkList.description) && (
                <div className="mt-3 grid grid-cols-1 gap-3">
                  {/* 項目の説明 */}
                  {result.checkList.description && (
                    <div className="rounded border border-light-gray bg-aws-paper-light p-3 text-sm">
                      <p className="mb-1 font-medium text-aws-squid-ink-light">
                        {t("review.itemDescription", "Item Description")}:
                      </p>
                      <p className="text-aws-font-color-gray">
                        {result.checkList.description}
                      </p>
                    </div>
                  )}

                  {/* 再審査: 元のジョブでの判定 */}
                  {result.previousResult && (
                    <div className="rounded border border-light-gray bg-aws-paper-light p-3 text-sm">
                      <p className="mb-1 font-medium text-aws-squid-ink-light">
                        {result.carriedOver
                          ? t("review.carriedOverFrom")
                          : t("review.previousDecision")}
                        {" · "}
                        <Link
                          to={`/review/${result.previousResult.reviewJobId}`}
                          className="font-normal text-aws-font-color-blue hover:underline">
                          {t("review.openSourceJob")}
                        </Link>
                      </p>
                      {!result.carriedOver && (
                        <>
                          <p className="text-aws-font-color-gray">
                            {result.previousResult.result === REVIEW_RESULT.FAIL
                              ? t("review.previousFail")
                              : result.previousResult.result ===
                                  REVIEW_RESULT.PASS
                                ? t("review.previousPass")
                                : t(`status.${result.previousResult.status}`)}
                            {result.previousResult.userOverride &&
                              ` (${t("review.userOverride", "User Override")})`}
                          </p>
                          {result.previousResult.explanation && (
                            <p className="mt-1 text-aws-font-color-gray">
                              {result.previousResult.explanation}
                            </p>
                          )}
                          {result.previousResult.userComment && (
                            <p className="mt-1 text-aws-font-color-gray">
                              {t("review.userComment", "User Comment")}:{" "}
                              {result.previousResult.userComment}
                            </p>
                          )}
                        </>
                      )}
                      {result.carriedOver &&
                        allSourceReferences.length > sourceReferences.length && (
                          <p className="text-aws-font-color-gray">
                            {t("review.carriedOverSources")}
                          </p>
                        )}
                    </div>
                  )}

                  {/* この判定に使った文書 */}
                  {!hasChildren &&
                    result.status === REVIEW_RESULT_STATUS.COMPLETED && (
                      <div className="rounded border border-light-gray bg-aws-paper-light p-3 text-sm">
                        <p className="mb-1 font-medium text-aws-squid-ink-light">
                          {t("review.judgedWithDocuments")}:
                        </p>
                        {result.judgedInReviewJobId && judgedInJob && (
                          <p className="mb-1 text-xs text-aws-font-color-gray">
                            {t("review.judgedInJob")}:{" "}
                            <Link
                              to={`/review/${judgedInJob.id}`}
                              className="text-aws-font-color-blue hover:underline">
                              {judgedInJob.name}
                            </Link>
                          </p>
                        )}
                        {isLoadingJudgedInJob ? (
                          <Spinner size="sm" />
                        ) : judgedDocuments.length > 0 ? (
                          <ul className="space-y-1">
                            {judgedDocuments.map((doc) => (
                              <li key={doc.id}>
                                <DocumentPreview
                                  s3Key={doc.s3Path}
                                  filename={doc.filename}
                                />
                                {doc.uploadDate && (
                                  <p className="text-xs text-aws-font-color-gray">
                                    {t("review.uploadedAt", {
                                      date: new Date(
                                        doc.uploadDate
                                      ).toLocaleString(),
                                    })}
                                  </p>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-aws-font-color-gray">
                            {result.judgedInReviewJobId
                              ? t("review.judgedInJobUnavailable")
                              : t("review.noDocuments")}
                          </p>
                        )}
                      </div>
                    )}

                  {result.explanation && (
                    <div className="rounded border border-light-gray bg-aws-paper-light p-3 text-sm">
                      <p className="mb-1 font-medium text-aws-squid-ink-light">
                        {t("review.aiDecision", "AI Decision")}:
                      </p>
                      <p className="text-aws-font-color-gray">
                        {result.explanation}
                      </p>
                    </div>
                  )}

                  {/* Display extracted text */}
                  {result.extractedText && result.extractedText.length > 0 && (
                    <div className="rounded border border-light-gray bg-aws-paper-light p-3 text-sm">
                      <p className="mb-1 font-medium text-aws-squid-ink-light">
                        {t("review.sourceText", "Source Text")}:
                      </p>
                      <div className="space-y-2">
                        {result.extractedText.map((citation, index) => (
                          <div
                            key={index}
                            className="rounded border border-light-gray bg-white p-2 text-aws-font-color-gray"
                          >
                            {citation}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Display source documents (list format) */}
                  {sourceReferences.length > 0 && (
                    <div className="mt-3 rounded border border-light-gray bg-aws-paper-light p-3 text-sm">
                      <p className="mb-1 font-medium text-aws-squid-ink-light">
                        {t("review.sourceDocuments", "Source Documents")}:
                      </p>
                      <p className="mb-2 text-sm text-aws-font-color-gray">
                        {t("review.sourceList", "Source List")} (
                        {sourceReferences.length}
                        {t("review.items", "items")})
                      </p>

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                        {sourceReferences
                          .slice(0, visibleReferencesCount)
                          .map((reference: any, index: number) => {
                            const doc = judgedDocuments.find(
                              (d) => d.id === reference.documentId
                            );
                            if (!doc) return null;

                            // 場所の示し方は種類で変わる。PDF はページ、
                            // Office は見出し。同じ判定を2回書くと片方だけ
                            // 直して食い違う
                            const pdf = isPdfFileName(doc.filename);

                            return (
                              <div
                                key={`${reference.documentId}-${
                                  reference.pageNumber || index
                                }`}
                                className="rounded border border-light-gray p-2">
                                {doc.fileType === REVIEW_FILE_TYPE.PDF ? (
                                  <DocumentPreview
                                    s3Key={doc.s3Path}
                                    filename={doc.filename}
                                    pageNumber={
                                      pdf ? reference.pageNumber : undefined
                                    }
                                    location={
                                      pdf ? undefined : reference.locationLabel
                                    }
                                  />
                                ) : doc.fileType === REVIEW_FILE_TYPE.IMAGE ? (
                                  <ImagePreview
                                    s3Key={doc.s3Path}
                                    filename={doc.filename}
                                    thumbnailHeight={80} // Smaller thumbnail size
                                    boundingBox={reference.boundingBox} // Pass bounding box info
                                  />
                                ) : null}
                              </div>
                            );
                          })}
                      </div>

                      {sourceReferences.length > visibleReferencesCount && (
                        <div className="mt-2 text-center">
                          <Button
                            onClick={() =>
                              setVisibleReferencesCount((prev) =>
                                prev === sourceReferences.length
                                  ? 5
                                  : sourceReferences.length
                              )
                            }
                            variant="text"
                            size="sm"
                            icon={
                              visibleReferencesCount ===
                              sourceReferences.length ? (
                                <HiChevronUp className="h-4 w-4" />
                              ) : (
                                <HiChevronDown className="h-4 w-4" />
                              )
                            }>
                            {visibleReferencesCount === sourceReferences.length
                              ? t("review.collapse", "Collapse")
                              : t("review.showAll", "Show All")}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* External Sources - Review level */}
                  {result.externalSources &&
                    result.externalSources.length > 0 && (
                      <div className="mt-4 border-t border-light-gray pt-4">
                        <p className="mb-2 text-sm font-medium text-aws-squid-ink-light">
                          {t("review.externalSources", "External Sources")}:
                        </p>
                        <div className="space-y-2">
                          {result.externalSources.map(
                            (source, idx: number) => (
                              <ExternalSourceItem key={idx} source={source} />
                            )
                          )}
                        </div>
                      </div>
                    )}

                  {/* User comments */}
                  {result.userComment && (
                    <div className="rounded bg-aws-sea-blue-light bg-opacity-10 p-3 text-sm">
                      <p className="mb-1 font-medium text-aws-squid-ink-light">
                        {t("review.userComment", "User Comment")}:
                      </p>
                      <p className="text-aws-font-color-gray">
                        {result.userComment}
                      </p>
                    </div>
                  )}
                </div>
              )}
          </div>

        </div>
      </ResultCard>

      {/* Override modal */}
      {isModalOpen && (
        <ReviewResultOverrideModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          result={result}
        />
      )}
    </>
  );
}
