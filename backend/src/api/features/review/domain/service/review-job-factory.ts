import { ulid } from "ulid";
import { NotFoundError, ValidationError } from "../../../../core/errors";
import { CheckRepository } from "../../../checklist/domain/repository";
import { CreateReviewJobRequest } from "../../routes/handlers";
import {
  REVIEW_RESULT_STATUS,
  REVIEW_JOB_STATUS,
  ReviewJobEntity,
  ReviewResultEntity,
} from "../model/review";

export const createInitialReviewJobModel = async (params: {
  req: CreateReviewJobRequest;
  deps: {
    checkRepo: CheckRepository;
  };
}): Promise<ReviewJobEntity> => {
  const { req, deps } = params;
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

  const targetItems = selectCheckItems(checkListSet, req.checkIds);

  const jobId = ulid();
  const initialResults = targetItems.map((checkList) => {
    return createInitialReviewResult(jobId, checkList.id);
  });

  console.log(
    `[createInitialReviewJobModel] initialResults has ${initialResults.length} items`
  );

  return {
    id: jobId,
    name: req.name,
    status: REVIEW_JOB_STATUS.PENDING,
    checkListSetId: req.checkListSetId,
    userId: req.userId,
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
