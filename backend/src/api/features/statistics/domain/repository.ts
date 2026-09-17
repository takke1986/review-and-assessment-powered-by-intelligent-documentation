import { PrismaClient, getPrismaClient } from "../../../core/db";

/** 審査結果の合否。DB には小文字で入る */
const RESULT_FAIL = "fail";
const STATUS_COMPLETED = "completed";

export interface CheckFailureTrendRow {
  checkId: string;
  name: string;
  /** 審査した回数（引き継ぎを除く） */
  reviewedCount: number;
  failedCount: number;
  /** 0〜1。reviewedCount が 0 のときは 0 */
  failRate: number;
  /** 信頼度の平均。値が無ければ null */
  averageConfidence: number | null;
  /** 直近で不合格になった日時。無ければ null */
  lastFailedAt: Date | null;
}

export interface StatisticsRepository {
  findCheckFailureTrends(params: {
    checkListSetId: string;
  }): Promise<CheckFailureTrendRow[]>;
  countReviewJobs(params: { checkListSetId: string }): Promise<number>;
}

export const makePrismaStatisticsRepository = async (
  clientInput?: PrismaClient
): Promise<StatisticsRepository> => {
  const client = clientInput || (await getPrismaClient());

  return {
    /**
     * チェック項目ごとに、審査した回数と不合格の回数を数える。
     *
     * - 親項目は子から導いた結果を持つので、子を持たない項目だけを数える
     * - 再審査で引き継いだ結果（carriedOver）は同じ判定の重複なので除く
     * - 人が上書きした結果は、上書き後の合否がそのまま入っている
     */
    async findCheckFailureTrends({ checkListSetId }) {
      const judged = {
        status: STATUS_COMPLETED,
        carriedOver: false,
        result: { not: null },
        reviewJob: { checkListSetId },
        checkList: { children: { none: {} } },
      };

      const [totals, failures] = await Promise.all([
        client.reviewResult.groupBy({
          by: ["checkId"],
          where: judged,
          _count: { _all: true },
          _avg: { confidenceScore: true },
        }),
        client.reviewResult.groupBy({
          by: ["checkId"],
          where: { ...judged, result: RESULT_FAIL },
          _count: { _all: true },
          _max: { updatedAt: true },
        }),
      ]);

      if (totals.length === 0) {
        return [];
      }

      const names = await client.checkList.findMany({
        where: { id: { in: totals.map((total) => total.checkId) } },
        select: { id: true, name: true },
      });
      const nameById = new Map(names.map((item) => [item.id, item.name]));
      const failureByCheckId = new Map(
        failures.map((failure) => [failure.checkId, failure])
      );

      return totals
        .map((total) => {
          const failure = failureByCheckId.get(total.checkId);
          const reviewedCount = total._count._all;
          const failedCount = failure?._count._all ?? 0;
          return {
            checkId: total.checkId,
            name: nameById.get(total.checkId) ?? "",
            reviewedCount,
            failedCount,
            failRate: reviewedCount === 0 ? 0 : failedCount / reviewedCount,
            averageConfidence: total._avg.confidenceScore ?? null,
            lastFailedAt: failure?._max.updatedAt ?? null,
          };
        })
        .sort(
          (a, b) =>
            b.failRate - a.failRate ||
            b.failedCount - a.failedCount ||
            a.name.localeCompare(b.name)
        );
    },

    async countReviewJobs({ checkListSetId }) {
      return client.reviewJob.count({ where: { checkListSetId } });
    },
  };
};
