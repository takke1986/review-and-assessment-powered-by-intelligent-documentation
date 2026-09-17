import { FastifyInstance } from "fastify";
import { getCheckFailureTrendsHandler } from "./handlers";

export function registerStatisticsRoutes(fastify: FastifyInstance): void {
  fastify.get("/checklist-sets/:setId/check-failure-trends", {
    handler: getCheckFailureTrendsHandler,
  });
}
