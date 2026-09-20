import { PrismaClient, getPrismaClient } from "../../../core/db";
import {
  CHECK_TREND_STATUS,
  decideCheckTrendStatus,
} from "../service/check-trend-status";
import {
  GuidanceEffect,
  splitByGuidance,
} from "../service/guidance-effect";

/** 審査結果の合否。DB には小文字で入る */
const RESULT_FAIL = "fail";
const RESULT_PASS = "pass";
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
  /** 直近で不合格になった審査ジョブ。結果を見に行く先。無ければ null */
  lastFailedReviewJobId: string | null;
  /** 再審査で引き継いだ回数。審査し直していないことを示すのに使う */
  carriedOverCount: number;
  /** AI が合格にしたものを人が不合格に直した回数。見落とし */
  missedCount: number;
  /** AI が不合格にしたものを人が合格に戻した回数。厳しすぎ */
  overturnedToPassCount: number;
  /** 着眼点を書いたあと、覆されにくくなったか。着眼点が無ければ null */
  guidanceEffect: GuidanceEffect | null;
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

      const [totals, failures, carriedOvers, overturns] = await Promise.all([
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
          // reviewJobId は ULID なので、最大値がそのまま直近のジョブになる
          _max: { updatedAt: true, reviewJobId: true },
        }),
        // 引き継ぎは判定の重複なので数には入れないが、「審査し直していない」
        // 項目を一覧から消さないために、別に数えておく
        client.reviewResult.groupBy({
          by: ["checkId"],
          where: { ...judged, carriedOver: true },
          _count: { _all: true },
        }),
        // 人が覆した判定を向き別に数える。AI の判定を記録する前の結果は
        // 向きが分からないので、aiResult が入っているものだけ数える
        client.reviewResult.groupBy({
          by: ["checkId", "aiResult", "result"],
          where: { ...judged, userOverride: true, aiResult: { not: null } },
          _count: { _all: true },
        }),
      ]);

      // 着眼点を書いた項目だけ、書く前と後で覆された率を比べる。
      // 前後で分けるには判定1件ずつの日時が要るので、ここだけ行を読む。
      // 着眼点を書いた項目は多くないので、読む量は知れている
      const guided = await client.checkList.findMany({
        where: { checkListSetId, reviewGuidanceUpdatedAt: { not: null } },
        select: { id: true, reviewGuidanceUpdatedAt: true },
      });
      const guidedResults =
        guided.length === 0
          ? []
          : await client.reviewResult.findMany({
              where: { ...judged, checkId: { in: guided.map((g) => g.id) } },
              select: {
                checkId: true,
                createdAt: true,
                userOverride: true,
                aiResult: true,
                result: true,
              },
            });
      const effectByCheckId = new Map(
        guided.map((item) => [
          item.id,
          splitByGuidance({
            writtenAt: item.reviewGuidanceUpdatedAt!,
            results: guidedResults.filter((row) => row.checkId === item.id),
          }),
        ])
      );

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
      // 向きごとの回数。同じ判定に覆した（コメントだけ足した）ものは数えない
      const countOverturns = (checkId: string, from: string, to: string) =>
        overturns
          .filter(
            (row) =>
              row.checkId === checkId &&
              row.aiResult === from &&
              row.result === to
          )
          .reduce((sum, row) => sum + row._count._all, 0);

      return checkIds
        .map((checkId) => {
          const total = totalByCheckId.get(checkId);
          const failure = failureByCheckId.get(checkId);
          const reviewedCount = total?._count._all ?? 0;
          const failedCount = failure?._count._all ?? 0;
          const failRate = reviewedCount === 0 ? 0 : failedCount / reviewedCount;
          const averageConfidence = total?._avg.confidenceScore ?? null;
          const carriedOverCount = carriedByCheckId.get(checkId)?._count._all ?? 0;
          const missedCount = countOverturns(checkId, RESULT_PASS, RESULT_FAIL);
          const overturnedToPassCount = countOverturns(
            checkId,
            RESULT_FAIL,
            RESULT_PASS
          );
          return {
            checkId,
            name: nameById.get(checkId) ?? "",
            reviewedCount,
            failedCount,
            failRate,
            averageConfidence,
            lastFailedAt: failure?._max.updatedAt ?? null,
            lastFailedReviewJobId: failure?._max.reviewJobId ?? null,
            carriedOverCount,
            missedCount,
            overturnedToPassCount,
            guidanceEffect: effectByCheckId.get(checkId) ?? null,
            status: decideCheckTrendStatus({
              reviewedCount,
              carriedOverCount,
              failRate,
              averageConfidence,
              missedCount,
              overturnedToPassCount,
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
