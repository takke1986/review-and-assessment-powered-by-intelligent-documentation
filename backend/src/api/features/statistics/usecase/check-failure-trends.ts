import {
  CheckRepository,
  makePrismaCheckRepository,
} from "../../checklist/domain/repository";
import {
  assertHasOwnerAccessOrThrow,
  RequestUser,
} from "../../../core/middleware/authorization";
import {
  CheckFailureTrendRow,
  StatisticsRepository,
  makePrismaStatisticsRepository,
} from "../domain/repository";

export interface CheckFailureTrends {
  /** チェックリストの審査ジョブの数。少ないときは傾向として弱いことが分かる */
  reviewJobCount: number;
  items: CheckFailureTrendRow[];
}

/**
 * チェックリストの中で、どの項目が不合格になりがちかを返す。
 */
export const getCheckFailureTrends = async (params: {
  checkListSetId: string;
  user: RequestUser;
  deps?: {
    repo?: StatisticsRepository;
    checkRepo?: CheckRepository;
  };
}): Promise<CheckFailureTrends> => {
  const checkRepo =
    params.deps?.checkRepo || (await makePrismaCheckRepository());
  const checkListSet = await checkRepo.findCheckListSetDetailById(
    params.checkListSetId
  );
  assertHasOwnerAccessOrThrow(params.user, checkListSet.userId, {
    api: "getCheckFailureTrends",
    resourceId: params.checkListSetId,
    logger: console,
  });

  const repo = params.deps?.repo || (await makePrismaStatisticsRepository());
  const [items, reviewJobCount] = await Promise.all([
    repo.findCheckFailureTrends({ checkListSetId: params.checkListSetId }),
    repo.countReviewJobs({ checkListSetId: params.checkListSetId }),
  ]);

  return { reviewJobCount, items };
};
