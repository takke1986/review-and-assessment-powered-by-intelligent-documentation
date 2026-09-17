import { PrismaClient, getPrismaClient } from "../../../core/db";
import {
  CHECK_TREND_STATUS,
  decideCheckTrendStatus,
} from "../service/check-trend-status";

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
  /** 再審査で引き継いだ回数。審査し直していないことを示すのに使う */
  carriedOverCount: number;
  /** 次に何をすべきかを示す状態 */
  status: CHECK_TREND_STATUS;
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

      const [totals, failures, carriedOvers] = await Promise.all([
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
        // 引き継ぎは判定の重複なので数には入れないが、「審査し直していない」
        // 項目を一覧から消さないために、別に数えておく
        client.reviewResult.groupBy({
          by: ["checkId"],
          where: { ...judged, carriedOver: true },
          _count: { _all: true },
        }),
      ]);

      const checkIds = [
        ...new Set([
          ...totals.map((total) => total.checkId),
          ...carriedOvers.map((carried) => carried.checkId),
        ]),
      ];
      if (checkIds.length === 0) {
        return [];
      }

      const names = await client.checkList.findMany({
        where: { id: { in: checkIds } },
        select: { id: true, name: true },
      });
      const nameById = new Map(names.map((item) => [item.id, item.name]));
      const failureByCheckId = new Map(
        failures.map((failure) => [failure.checkId, failure])
      );
      const totalByCheckId = new Map(
        totals.map((total) => [total.checkId, total])
      );
      const carriedByCheckId = new Map(
        carriedOvers.map((carried) => [carried.checkId, carried])
      );

      return checkIds
        .map((checkId) => {
          const total = totalByCheckId.get(checkId);
          const failure = failureByCheckId.get(checkId);
          const reviewedCount = total?._count._all ?? 0;
          const failedCount = failure?._count._all ?? 0;
          const failRate = reviewedCount === 0 ? 0 : failedCount / reviewedCount;
          const averageConfidence = total?._avg.confidenceScore ?? null;
          const carriedOverCount = carriedByCheckId.get(checkId)?._count._all ?? 0;
          return {
            checkId,
            name: nameById.get(checkId) ?? "",
            reviewedCount,
            failedCount,
            failRate,
            averageConfidence,
            lastFailedAt: failure?._max.updatedAt ?? null,
            carriedOverCount,
            status: decideCheckTrendStatus({
              reviewedCount,
              carriedOverCount,
              failRate,
              averageConfidence,
            }),
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
