import { FastifyInstance } from "fastify";
import {
  getCheckFailureTrendsHandler,
  getCheckListSetTrendsHandler,
} from "./handlers";

export function registerStatisticsRoutes(fastify: FastifyInstance): void {
  // 横断一覧。:setId より先に書く必要はないが、並びを揃えて読みやすくする
  fastify.get("/checklist-set-trends", {
    handler: getCheckListSetTrendsHandler,
  });
  fastify.get("/checklist-sets/:setId/check-failure-trends", {
    handler: getCheckFailureTrendsHandler,
  });
}
