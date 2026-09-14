import { ulid } from "ulid";
import { NotFoundError, ValidationError } from "../../../../core/errors";
import { CheckRepository } from "../../../checklist/domain/repository";
import { CreateReviewJobRequest } from "../../routes/handlers";
import {
  REVIEW_RESULT,
  REVIEW_RESULT_STATUS,
  REVIEW_JOB_STATUS,
  ReviewJobEntity,
  ReviewResultDetail,
  ReviewResultEntity,
} from "../model/review";

export const createInitialReviewJobModel = async (params: {
  req: CreateReviewJobRequest;
  deps: {
    checkRepo: CheckRepository;
  };
  /** 再審査の元になるジョブとその結果。所有者と状態は呼び出し側で確認済み */
  source?: {
    reviewJobId: string;
    results: ReviewResultDetail[];
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
    sourceReviewJobId: source?.reviewJobId,
    documents: req.documents,
    results: initialResults,
  };
};

/**
 * 審査するチェック項目を決める。
 *
 * checkIds を省略するとすべての項目を返す。指定した場合は、指定した項目に加えて
 * - 子孫: 親を指定したら、その配下もすべて審査する
 * - 祖先: 審査結果のツリー表示と、子の結果から親の判定を決める集計に必要
 * を含める。審査の実行と集計はジョブにある結果だけを見るため、
 * ここで結果を作らなかった項目は審査されない。
 */
export const selectCheckItems = <T extends { id: string; parentId?: string }>(
  items: T[],
  checkIds?: string[]
): T[] => {
  if (checkIds === undefined) {
    return items;
  }
  if (checkIds.length === 0) {
    throw new ValidationError("At least one check item is required");
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  const unknownIds = checkIds.filter((id) => !byId.has(id));
  if (unknownIds.length > 0) {
    throw new ValidationError(
      `Check items not found in the checklist set: ${unknownIds.join(", ")}`
    );
  }

  const childrenOf = new Map<string, string[]>();
  for (const item of items) {
    if (item.parentId) {
      const siblings = childrenOf.get(item.parentId) ?? [];
      siblings.push(item.id);
      childrenOf.set(item.parentId, siblings);
    }
  }

  const selected = new Set<string>();
  const addWithDescendants = (id: string) => {
    if (selected.has(id)) return;
    selected.add(id);
    for (const childId of childrenOf.get(id) ?? []) {
      addWithDescendants(childId);
    }
  };
  checkIds.forEach(addWithDescendants);

  for (const id of Array.from(selected)) {
    let parentId = byId.get(id)?.parentId;
    while (parentId && !selected.has(parentId)) {
      selected.add(parentId);
      parentId = byId.get(parentId)?.parentId;
    }
  }

  return items.filter((item) => selected.has(item.id));
};

/**
 * 再審査で、もう一度審査する項目の既定値。
 * 元のジョブで不合格だった子項目と、審査が完了しなかった子項目。
 * 人が判定を上書きしていれば、上書き後の判定で決める。
 */
export const failedLeafCheckIds = (results: ReviewResultDetail[]): string[] => {
  const parentIds = new Set(
    results
      .map((result) => result.checkList.parentId)
      .filter((parentId): parentId is string => !!parentId)
  );

  return results
    .filter((result) => !parentIds.has(result.checkId))
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

const createInitialReviewResult = (
  reviewJobId: string,
  checkId: string
): ReviewResultEntity => {
  return {
    id: ulid(),
    reviewJobId,
    checkId,
    status: REVIEW_RESULT_STATUS.PENDING,
    userOverride: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
};
