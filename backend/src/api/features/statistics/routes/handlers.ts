import { FastifyReply, FastifyRequest } from "fastify";
import { getCheckFailureTrends } from "../usecase/check-failure-trends";
import { getCheckListSetTrends } from "../usecase/check-list-set-trends";
import { isSetTrendSortKey } from "../service/set-trend-summary";

export const getCheckFailureTrendsHandler = async (
  request: FastifyRequest<{ Params: { setId: string } }>,
  reply: FastifyReply
): Promise<void> => {
  const trends = await getCheckFailureTrends({
    checkListSetId: request.params.setId,
    user: request.user!,
  });

  reply.code(200).send({ success: true, data: trends });
};

export const getCheckListSetTrendsHandler = async (
  request: FastifyRequest<{
    Querystring: {
      page?: string;
      limit?: string;
      sortBy?: string;
      sortOrder?: string;
      search?: string;
      includeUnreviewed?: string;
    };
  }>,
  reply: FastifyReply
): Promise<void> => {
  const query = request.query;
  const trends = await getCheckListSetTrends({
    user: request.user!,
    page: query.page ? Number(query.page) : undefined,
    limit: query.limit ? Number(query.limit) : undefined,
    // 知らない列名で落ちないよう、想定外は既定に落とす
    sortBy: isSetTrendSortKey(query.sortBy) ? query.sortBy : undefined,
    sortOrder: query.sortOrder === "asc" ? "asc" : "desc",
    search: query.search,
    includeUnreviewed: query.includeUnreviewed === "true",
  });

  reply.code(200).send({ success: true, data: trends });
};
