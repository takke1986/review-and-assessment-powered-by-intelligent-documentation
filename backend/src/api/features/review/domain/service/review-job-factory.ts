import { ulid } from "ulid";
import { NotFoundError, ValidationError } from "../../../../core/errors";
import { CheckRepository } from "../../../checklist/domain/repository";
import { CreateReviewJobRequest } from "../../routes/handlers";
import {
  REVIEW_JOB_STATUS,
  ReviewJobDocument,
  ReviewJobEntity,
  ReviewResultDetail,
} from "../model/review";
import { selectCheckItems } from "./check-item-selection";
import { createInitialReviewResult } from "./initial-review-result";
import {
  buildRerunDocuments,
  createRerunResults,
  normalizeRevisionNote,
} from "./review-rerun";

export const createInitialReviewJobModel = async (params: {
  req: CreateReviewJobRequest;
  deps: {
    checkRepo: CheckRepository;
  };
  /** 再審査の元になるジョブとその結果。所有者と状態は呼び出し側で確認済み */
  source?: {
    reviewJobId: string;
    results: ReviewResultDetail[];
    /** 元のジョブの文書。引き継ぎと差し替えの対象になる */
    documents?: ReviewJobDocument[];
  };
}): Promise<ReviewJobEntity> => {
  const { req, deps, source } = params;
  const { checkRepo } = deps;

  const checkListSet = await checkRepo.findCheckListItems(
    req.checkListSetId,
    undefined,
    true // Fetch all checklists
  );

  if (checkListSet.length === 0) {
    throw new NotFoundError(`ChecklistSet not found`, req.checkListSetId);
  }

  console.log(
    `[createInitialReviewJobModel] checkListSet has ${checkListSet.length} items`
  );

  const jobId = ulid();
  const initialResults = source
    ? createRerunResults(jobId, checkListSet, source.results, req.checkIds)
    : selectCheckItems(checkListSet, req.checkIds).map((checkList) =>
        createInitialReviewResult(jobId, checkList.id)
      );

  console.log(
    `[createInitialReviewJobModel] initialResults has ${initialResults.length} items`
  );

  return {
    id: jobId,
    name: req.name,
    status: REVIEW_JOB_STATUS.PENDING,
    checkListSetId: req.checkListSetId,
    userId: req.userId,
    // 誰が回したかを一覧に出すため、そのときの表示名を写し取る
    userName: req.userName,
    departmentId: req.departmentId,
    sourceReviewJobId: source?.reviewJobId,
    revisionNote: normalizeRevisionNote(req.revisionNote),
    documents: source
      ? buildRerunDocuments(req, source.documents ?? [])
      : buildDocuments(req),
    results: initialResults,
  };
};

/**
 * 通常の審査の文書。引き継ぎと差し替えは、再審査でしか指定できない。
 */
const buildDocuments = (
  req: Pick<CreateReviewJobRequest, "documents" | "keptDocumentIds">
): ReviewJobEntity["documents"] => {
  const documents = req.documents ?? [];
  if (
    (req.keptDocumentIds?.length ?? 0) > 0 ||
    documents.some((doc) => doc.replacesDocumentId)
  ) {
    throw new ValidationError(
      "Documents can be kept or replaced only in a re-review"
    );
  }
  return documents;
};
