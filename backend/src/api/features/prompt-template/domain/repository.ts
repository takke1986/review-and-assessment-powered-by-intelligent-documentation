import { PrismaClient, getPrismaClient } from "../../../core/db";
import { normalizeSearchTerm } from "../../../core/utils/search-text";
import { PaginatedResponse } from "../../../common/types";
import {
  ListParams,
  resolvePaging,
  toPaginatedResponse,
} from "../../../common/pagination";
import { NotFoundError } from "../../../core/errors";
import { PromptTemplateEntity, PromptTemplateType } from "./model/template";

export interface PromptTemplateRepository {
  getPromptTemplates(
    userId: string,
    type: PromptTemplateType,
    params?: ListParams
  ): Promise<PaginatedResponse<PromptTemplateEntity>>;
  getPromptTemplateById(id: string): Promise<PromptTemplateEntity>;
  createPromptTemplate(template: PromptTemplateEntity): Promise<void>;
  updatePromptTemplate(template: PromptTemplateEntity): Promise<void>;
  deletePromptTemplate(id: string): Promise<void>;
}

export const makePrismaPromptTemplateRepository = async (
  clientInput: PrismaClient | null = null
): Promise<PromptTemplateRepository> => {
  const client = clientInput || (await getPrismaClient());

  const getPromptTemplates = async (
    userId: string,
    type: PromptTemplateType,
    params: ListParams = {}
  ): Promise<PaginatedResponse<PromptTemplateEntity>> => {
    const paging = resolvePaging(params, "updatedAt");
    const { sortBy, sortOrder } = paging;

    const needle = normalizeSearchTerm(params.search);
    const where = {
      userId,
      type,
      ...(needle ? { name: { contains: needle } } : {}),
    };

    const [templates, total] = await Promise.all([
      client.promptTemplate.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: paging.skip,
        take: paging.take,
      }),
      client.promptTemplate.count({ where }),
    ]);

    const items = templates.map((template) => ({
      id: template.id,
      userId: template.userId,
      name: template.name,
      description: template.description || undefined,
      prompt: template.prompt,
      type: template.type as PromptTemplateType,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    }));

    return toPaginatedResponse(items, total, paging);
  };

  const getPromptTemplateById = async (
    id: string
  ): Promise<PromptTemplateEntity> => {
    const template = await client.promptTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundError("Prompt template not found", id);
    }

    return {
      id: template.id,
      userId: template.userId,
      name: template.name,
      description: template.description || undefined,
      prompt: template.prompt,
      type: template.type as PromptTemplateType,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  };

  const createPromptTemplate = async (
    template: PromptTemplateEntity
  ): Promise<void> => {
    // 新しいテンプレートを作成
    await client.promptTemplate.create({
      data: {
        id: template.id,
        userId: template.userId,
        name: template.name,
        description: template.description,
        prompt: template.prompt,
        type: template.type,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
      },
    });
  };

  const updatePromptTemplate = async (
    template: PromptTemplateEntity
  ): Promise<void> => {
    // テンプレートを更新
    await client.promptTemplate.update({
      where: { id: template.id },
      data: {
        name: template.name,
        description: template.description,
        prompt: template.prompt,
        updatedAt: template.updatedAt,
      },
    });
  };

  const deletePromptTemplate = async (id: string): Promise<void> => {
    await client.promptTemplate.delete({
      where: { id },
    });
  };

  return {
    getPromptTemplates,
    getPromptTemplateById,
    createPromptTemplate,
    updatePromptTemplate,
    deletePromptTemplate,
  };
};
