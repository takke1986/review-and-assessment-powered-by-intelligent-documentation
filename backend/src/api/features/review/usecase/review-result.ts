import {
  OVERRIDE_REASON,
  REVIEW_RESULT,
  ReviewResultDetail,
  ReviewResultDomain,
} from "../domain/model/review";
import {
  ReviewResultRepository,
  makePrismaReviewResultRepository,
  ReviewJobRepository,
  makePrismaReviewJobRepository,
} from "../domain/repository";
import { updateCheckResultCascade } from "../domain/service/review-result-cascade-update";
import { isSupersededByRerun } from "../domain/service/superseded-by-rerun";
import {
  assertHasOwnerAccessOrThrow,
  RequestUser,
} from "../../../core/middleware/authorization";
import { parseCheckItemImportance } from "../../checklist/domain/model/checklist";
import { ValidationError } from "../../../core/errors";

export const getReviewResults = async (params: {
  reviewJobId: string;
  parentId?: string;
  filter?: REVIEW_RESULT;
  includeAllChildren?: boolean;
  /** 重要度で絞り込む。値は high / medium / low */
  importance?: string;
  user?: RequestUser;
  deps?: {
    repo?: ReviewResultRepository;
    reviewJobRepo?: ReviewJobRepository;
  };
}): Promise<ReviewResultDetail[]> => {
  const repo = params.deps?.repo || (await makePrismaReviewResultRepository());
  const reviewJobRepo =
    params.deps?.reviewJobRepo || (await makePrismaReviewJobRepository());

  // 所有者チェックを行う（管理者はパス）
  const job = await reviewJobRepo.findReviewJobById({
    reviewJobId: params.reviewJobId,
  });
  assertHasOwnerAccessOrThrow(params.user, job.userId, {
    api: "getReviewResults",
    resourceId: job.id,
    logger: console,
  });

  const importance = params.importance
    ? parseCheckItemImportance(params.importance)
    : undefined;
  if (params.importance && !importance) {
    throw new ValidationError(`Invalid importance: "${params.importance}"`);
  }

  const reviewResults = await repo.findReviewResultsById({
    jobId: params.reviewJobId,
    parentId: params.parentId,
    filter: params.filter,
    includeAllChildren: params.includeAllChildren || false,
    importance,
  });
  return reviewResults;
};

export const overrideReviewResult = async (params: {
  reviewJobId: string;
  resultId: string;
  result: REVIEW_RESULT;
  userComment: string;
  /** 覆した理由。傾向で「AI のどこが外れたか」を読むために使う */
  overrideReason?: OVERRIDE_REASON;
  user?: RequestUser;
  deps?: {
    repo?: ReviewResultRepository;
    reviewJobRepo?: ReviewJobRepository;
  };
}): Promise<void> => {
  const repo = params.deps?.repo || (await makePrismaReviewResultRepository());

  const current = await repo.findDetailedReviewResultById({
    resultId: params.resultId,
  });

  // ジョブ所有者の検証
  const reviewJobRepo =
    params.deps?.reviewJobRepo || (await makePrismaReviewJobRepository());
  const job = await reviewJobRepo.findReviewJobById({
    reviewJobId: current.reviewJobId,
  });
  assertHasOwnerAccessOrThrow(params.user, job.userId, {
    api: "overrideReviewResult",
    resourceId: job.id,
    logger: console,
  });

  // 再審査されたジョブの判定は変えられない。変えても新しいジョブには
  // 伝わらず、同じ項目が食い違って見えるだけになる。
  // 画面でもボタンを隠すが、API を直に叩かれても通らないようにする
  if (isSupersededByRerun(job.rerunJobs)) {
    throw new ValidationError(
      "This review job has been re-reviewed. Change the verdict on the newest job instead."
    );
  }

  const updated = ReviewResultDomain.fromOverrideRequest({
    current,
    result: params.result,
    userComment: params.userComment,
    overrideReason: params.overrideReason,
  });

  await updateCheckResultCascade({
    updated,
    deps: {
      reviewResultRepo: repo,
    },
  });
};
