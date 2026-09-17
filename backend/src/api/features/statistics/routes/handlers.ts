import { FastifyReply, FastifyRequest } from "fastify";
import { getCheckFailureTrends } from "../usecase/check-failure-trends";

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
