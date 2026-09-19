import { PrismaClient, getPrismaClient, Prisma } from "../../../core/db";
import { PaginatedResponse } from "../../../common/types";
import { NotFoundError } from "../../../core/errors";
import { ToolConfigurationEntity } from "./model/tool-configuration";

export interface ToolConfigurationRepository {
  create(config: ToolConfigurationEntity): Promise<void>;
  findAll(params?: {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    search?: string;
  }): Promise<PaginatedResponse<ToolConfigurationEntity>>;
  findById(id: string): Promise<ToolConfigurationEntity>;
  delete(id: string): Promise<void>;
  isUsedByCheckLists(id: string): Promise<boolean>;
}

export const makePrismaToolConfigurationRepository = async (
  clientInput: PrismaClient | null = null
): Promise<ToolConfigurationRepository> => {
  const client = clientInput || (await getPrismaClient());

  const create = async (config: ToolConfigurationEntity): Promise<void> => {
    await client.toolConfiguration.create({
      data: {
        id: config.id,
        name: config.name,
        description: config.description,
        knowledgeBase: config.knowledgeBase
          ? (config.knowledgeBase as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        codeInterpreter: config.codeInterpreter,
        mcpConfig: config.mcpConfig
          ? (config.mcpConfig as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      },
    });
  };

  const findAll = async (
    params: {
      page?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      /** 名前の一部。増えてくると一覧から探せないため */
      search?: string;
    } = {}
  ): Promise<PaginatedResponse<ToolConfigurationEntity>> => {
    const {
      page = 1,
      limit = 10,
      sortBy = "createdAt",
      sortOrder = "desc",
      search,
    } = params;

    const needle = search?.trim();
    const where = needle ? { name: { contains: needle } } : {};

    const [configs, total] = await Promise.all([
      client.toolConfiguration.findMany({
        where,
        // 使用状況は関連の件数なので、件数で並べる
        orderBy:
          sortBy === "usageCount"
            ? { checkLists: { _count: sortOrder } }
            : { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: {
            select: { checkLists: true },
          },
        },
      }),
      client.toolConfiguration.count({ where }),
    ]);

    const items = configs.map((config) => ({
      id: config.id,
      name: config.name,
      description: config.description || undefined,
      knowledgeBase: config.knowledgeBase
        ? (config.knowledgeBase as any)
        : undefined,
      codeInterpreter: config.codeInterpreter,
      mcpConfig: config.mcpConfig ? (config.mcpConfig as any) : undefined,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
      usageCount: (config as any)._count.checkLists,
    }));

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  };

  const findById = async (id: string): Promise<ToolConfigurationEntity> => {
    const config = await client.toolConfiguration.findUnique({
      where: { id },
    });

    if (!config) {
      throw new NotFoundError("Tool configuration not found", id);
    }

    return {
      id: config.id,
      name: config.name,
      description: config.description || undefined,
      knowledgeBase: config.knowledgeBase
        ? (config.knowledgeBase as any)
        : undefined,
      codeInterpreter: config.codeInterpreter,
      mcpConfig: config.mcpConfig ? (config.mcpConfig as any) : undefined,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  };

  const deleteConfig = async (id: string): Promise<void> => {
    await client.toolConfiguration.delete({
      where: { id },
    });
  };

  const isUsedByCheckLists = async (id: string): Promise<boolean> => {
    const count = await client.checkList.count({
      where: { toolConfigurationId: id },
    });
    return count > 0;
  };

  return {
    create,
    findAll,
    findById,
    delete: deleteConfig,
    isUsedByCheckLists,
  };
};
