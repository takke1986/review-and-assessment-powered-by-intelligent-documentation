import { ulid } from "ulid";
import { ValidationError } from "../../../../core/errors";
import { MAX_REVISION_NOTE_LENGTH } from "../../../../constants";
import { CreateReviewJobRequest } from "../../routes/handlers";
import {
  REVIEW_RESULT,
  REVIEW_RESULT_STATUS,
  ReviewJobDocument,
  ReviewJobEntity,
  ReviewResultDetail,
  ReviewResultEntity,
} from "../model/review";
import { leafResults, selectCheckItems } from "./check-item-selection";
import { createInitialReviewResult } from "./initial-review-result";

/**
 * 再審査で、もう一度審査する項目の既定値。
 * 元のジョブで不合格だった子項目と、審査が完了しなかった子項目。
 * 人が判定を上書きしていれば、上書き後の判定で決める。
 */
export const failedLeafCheckIds = (results: ReviewResultDetail[]): string[] => {
  return leafResults(results)
    .filter(
      (result) =>
        result.status !== REVIEW_RESULT_STATUS.COMPLETED ||
        result.result === REVIEW_RESULT.FAIL
    )
    .map((result) => result.checkId);
};

/**
 * 再審査ジョブの結果を作る。
 *
 * - 審査し直す項目（checkIds、省略時は元のジョブで不合格だった項目）と
 *   その子孫・祖先は審査待ちにする。祖先の判定は子の結果から集計し直す
 * - それ以外で、元のジョブで完了していた項目は判定と根拠を引き継ぐ。
 *   費用はこのジョブでかかっていないので引き継がない
 * - 元のジョブで完了しなかった項目は、引き継ぐ判定がないので審査する
 * - 元のジョブに結果がない項目は、指定しない限り含めない
 *   （一部の項目だけを審査したジョブの範囲を広げない）
 *
 * どの結果も、元のジョブの同じ項目の結果を previousResultId で指す。
 */
export const createRerunResults = (
  reviewJobId: string,
  items: Array<{ id: string; parentId?: string }>,
  sourceResults: ReviewResultDetail[],
  checkIds?: string[]
): ReviewResultEntity[] => {
  const rerunCheckIds = checkIds ?? failedLeafCheckIds(sourceResults);
  if (checkIds === undefined && rerunCheckIds.length === 0) {
    throw new ValidationError(
      "The source review job has no failed items to review again"
    );
  }

  const pendingIds = new Set(
    selectCheckItems(items, rerunCheckIds).map((item) => item.id)
  );
  const previousByCheckId = new Map(
    sourceResults.map((result) => [result.checkId, result])
  );

  return items
    .filter((item) => pendingIds.has(item.id) || previousByCheckId.has(item.id))
    .map((item) => {
      const initial = createInitialReviewResult(reviewJobId, item.id);
      const previous = previousByCheckId.get(item.id);
      if (!previous) {
        return initial;
      }

      if (
        pendingIds.has(item.id) ||
        previous.status !== REVIEW_RESULT_STATUS.COMPLETED
      ) {
        return { ...initial, previousResultId: previous.id };
      }

      return {
        ...initial,
        status: REVIEW_RESULT_STATUS.COMPLETED,
        result: previous.result,
        confidenceScore: previous.confidenceScore,
        explanation: previous.explanation,
        shortExplanation: previous.shortExplanation,
        extractedText: previous.extractedText,
        userOverride: previous.userOverride,
        userComment: previous.userComment,
        sourceReferences: previous.sourceReferences,
        externalSources: previous.externalSources,
        previousResultId: previous.id,
        carriedOver: true,
        // 判定に使った文書は、判定を下したジョブにある。
        // 引き継ぎを重ねても、最初に判定したジョブを指し続ける
        judgedInReviewJobId:
          previous.judgedInReviewJobId ?? previous.reviewJobId,
      };
    });
};

/**
 * 再審査の文書を組み立てる。
 *
 * - keptDocumentIds の文書は、元のジョブの文書を引き継ぐ。同じ S3 のファイルを
 *   指す新しい文書にし、元のアップロード日時を保つ
 * - アップロードした文書は、replacesDocumentId があれば元の文書の差し替え、
 *   なければ追加
 * - どちらにも含まれない元の文書は、このジョブでは使わない
 *
 * 引き継がれずに外れた文書があると、複数の文書を見比べる項目が片方の文書だけで
 * 審査されてしまうため、画面では引き継ぎを既定にしている。
 */
export const buildRerunDocuments = (
  req: Pick<CreateReviewJobRequest, "documents" | "keptDocumentIds">,
  sourceDocuments: ReviewJobDocument[]
): ReviewJobEntity["documents"] => {
  const sourceIds = new Set(sourceDocuments.map((doc) => doc.id));
  const keptIds = req.keptDocumentIds ?? [];
  const uploaded = req.documents ?? [];
  const replacedIds = uploaded
    .map((doc) => doc.replacesDocumentId)
    .filter((id): id is string => !!id);

  const unknownIds = [...keptIds, ...replacedIds].filter(
    (id) => !sourceIds.has(id)
  );
  if (unknownIds.length > 0) {
    throw new ValidationError(
      `Documents not found in the source review job: ${unknownIds.join(", ")}`
    );
  }
  if (
    new Set(keptIds).size !== keptIds.length ||
    new Set(replacedIds).size !== replacedIds.length
  ) {
    throw new ValidationError(
      "A source document can be kept or replaced only once"
    );
  }
  const keptAndReplaced = keptIds.filter((id) => replacedIds.includes(id));
  if (keptAndReplaced.length > 0) {
    throw new ValidationError(
      `A source document cannot be both kept and replaced: ${keptAndReplaced.join(", ")}`
    );
  }

  const kept = sourceDocuments
    .filter((doc) => keptIds.includes(doc.id))
    .map((doc) => ({
      id: ulid(),
      filename: doc.filename,
      s3Key: doc.s3Path,
      fileType: doc.fileType,
      uploadDate: doc.uploadDate,
      carriedFromDocumentId: doc.id,
    }));

  return [...kept, ...uploaded];
};

/**
 * 再審査の変更メモを整える。前後の空白を除き、空ならメモなしとして扱う。
 */
export const normalizeRevisionNote = (note?: string): string | undefined => {
  const trimmed = note?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length > MAX_REVISION_NOTE_LENGTH) {
    throw new ValidationError(
      `A revision note can be at most ${MAX_REVISION_NOTE_LENGTH} characters`
    );
  }
  return trimmed;
};
