import { FastifyRequest, FastifyReply } from "fastify";
import {
  createToolConfiguration,
  getAllToolConfigurations,
  getToolConfigurationById,
  deleteToolConfiguration,
} from "../usecase/tool-configuration";
import { KnowledgeBaseConfig } from "../domain/model/tool-configuration";
import { previewMcpTools } from "../domain/service/mcp-tools-service";

export interface CreateToolConfigurationRequest {
  name: string;
  description?: string;
  knowledgeBase?: KnowledgeBaseConfig[];
  codeInterpreter: boolean;
  mcpConfig?: any;
}

export const getAllToolConfigurationsHandler = async (
  request: FastifyRequest<{
    Querystring: {
      page?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      search?: string;
    };
  }>,
  reply: FastifyReply
): Promise<void> => {
  const {
    page = 1,
    limit = 10,
    sortBy = "createdAt",
    sortOrder = "desc",
    search,
  } = request.query;

  const pageNum = typeof page === "string" ? parseInt(page, 10) : page;
  const limitNum = typeof limit === "string" ? parseInt(limit, 10) : limit;

  // 並べられるのは列と、関連の件数（使用状況）だけ
  const validSortFields = ["name", "createdAt", "updatedAt", "usageCount"];
  const validSortBy = validSortFields.includes(sortBy) ? sortBy : "createdAt";

  const result = await getAllToolConfigurations({
    page: pageNum,
    limit: limitNum,
    sortBy: validSortBy,
    sortOrder,
    search,
  });
  reply.code(200).send({ success: true, data: result });
};

export const getToolConfigurationByIdHandler = async (
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> => {
  const config = await getToolConfigurationById({
    id: request.params.id,
  });
  reply.code(200).send({ success: true, data: config });
};

export const createToolConfigurationHandler = async (
  request: FastifyRequest<{ Body: CreateToolConfigurationRequest }>,
  reply: FastifyReply
): Promise<void> => {
  const config = await createToolConfiguration({
    request: request.body,
  });
  reply.code(201).send({ success: true, data: config });
};

export const deleteToolConfigurationHandler = async (
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> => {
  await deleteToolConfiguration({ id: request.params.id });
  reply.code(200).send({ success: true });
};

export const previewMcpToolsHandler = async (
  request: FastifyRequest<{ Body: { mcpConfig: any } }>,
  reply: FastifyReply
): Promise<void> => {
  try {
    const results = await previewMcpTools(request.body.mcpConfig);
    reply.code(200).send({ success: true, data: results });
  } catch (error) {
    reply.code(500).send({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
