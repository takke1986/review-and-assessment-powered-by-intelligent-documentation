import { assertIsAdminOrThrow } from "../../../core/access/visibility";
import { FastifyRequest, FastifyReply } from "fastify";
import { parseListQuery } from "../../../common/pagination";
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

/** 並べられるのは列と、関連の件数（使用状況）だけ */
const SORTABLE_FIELDS = [
  "name",
  "createdAt",
  "updatedAt",
  "usageCount",
] as const;

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
  const result = await getAllToolConfigurations(
    parseListQuery(request.query, SORTABLE_FIELDS, "createdAt")
  );
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
  // 全員が使う共有の設定なので、作れるのは管理者だけ。
  // 見るほうは絞らない（チェックリストから張られたリンクが開けなくなる）
  assertIsAdminOrThrow(request.user, {
    api: "createToolConfiguration",
    logger: console,
  });
  const config = await createToolConfiguration({
    request: request.body,
  });
  reply.code(201).send({ success: true, data: config });
};

export const deleteToolConfigurationHandler = async (
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> => {
  // 消すと、それを使っているチェックリスト項目の設定まで失われる
  assertIsAdminOrThrow(request.user, {
    api: "deleteToolConfiguration",
    logger: console,
  });
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
