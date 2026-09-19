import { FastifyRequest, FastifyReply } from "fastify";
import {
  getPromptTemplates,
  getPromptTemplateById,
  createPromptTemplate,
  updatePromptTemplate,
  deletePromptTemplate,
} from "../usecase/template";
import { NotFoundError } from "../../../core/errors";
import { PromptTemplateType } from "../domain/model/template";

export interface GetPromptTemplatesRequest {
  Params: {
    type: string;
  };
  Querystring: {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    search?: string;
  };
}

export interface GetPromptTemplateByIdRequest {
  Params: {
    id: string;
  };
}

export interface CreatePromptTemplateRequest {
  Body: {
    name: string;
    description?: string;
    prompt: string;
    type: string;
  };
}

export interface UpdatePromptTemplateRequest {
  Params: {
    id: string;
  };
  Body: {
    name?: string;
    description?: string;
    prompt?: string;
  };
}

export interface DeletePromptTemplateRequest {
  Params: {
    id: string;
  };
}

export const getPromptTemplatesHandler = async (
  request: FastifyRequest<GetPromptTemplatesRequest>,
  reply: FastifyReply
): Promise<void> => {
  const { type } = request.params;
  const userId = request.user?.userId;

  if (!userId) {
    reply.code(401).send({
      success: false,
      error: {
        message: "Authentication required",
      },
    });
    return;
  }

  const {
    page = 1,
    limit = 10,
    sortBy = "updatedAt",
    sortOrder = "desc",
    search,
  } = request.query;

  const pageNum = typeof page === "string" ? parseInt(page, 10) : page;
  const limitNum = typeof limit === "string" ? parseInt(limit, 10) : limit;

  const validSortFields = ["name", "description", "createdAt", "updatedAt"];
  const validSortBy = validSortFields.includes(sortBy) ? sortBy : "updatedAt";

  const result = await getPromptTemplates({
    userId,
    type: type as PromptTemplateType,
    page: pageNum,
    limit: limitNum,
    sortBy: validSortBy,
    sortOrder,
    search,
  });

  reply.code(200).send({
    success: true,
    data: {
      // これまでの呼び出し側が templates で受けているので、名前は変えない
      templates: result.items,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    },
  });
};

export const getPromptTemplateByIdHandler = async (
  request: FastifyRequest<GetPromptTemplateByIdRequest>,
  reply: FastifyReply
): Promise<void> => {
  const { id } = request.params;

  try {
    const template = await getPromptTemplateById({ id });

    reply.code(200).send({
      success: true,
      data: {
        template,
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      reply.code(404).send({
        success: false,
        error: {
          message: `Template with id ${id} not found`,
        },
      });
      return;
    }
    throw error;
  }
};

export const createPromptTemplateHandler = async (
  request: FastifyRequest<CreatePromptTemplateRequest>,
  reply: FastifyReply
): Promise<void> => {
  const userId = request.user?.userId;

  if (!userId) {
    reply.code(401).send({
      success: false,
      error: {
        message: "Authentication required",
      },
    });
    return;
  }

  const { name, description, prompt, type } = request.body;

  const template = await createPromptTemplate({
    request: {
      userId,
      name,
      description,
      prompt,
      type: type as PromptTemplateType,
    },
  });

  reply.code(201).send({
    success: true,
    data: {
      template,
    },
  });
};

export const updatePromptTemplateHandler = async (
  request: FastifyRequest<UpdatePromptTemplateRequest>,
  reply: FastifyReply
): Promise<void> => {
  const { id } = request.params;
  const { name, description, prompt } = request.body;

  try {
    const template = await updatePromptTemplate({
      request: {
        id,
        name,
        description,
        prompt,
      },
    });

    reply.code(200).send({
      success: true,
      data: {
        template,
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      reply.code(404).send({
        success: false,
        error: {
          message: `Template with id ${id} not found`,
        },
      });
      return;
    }
    throw error;
  }
};

export const deletePromptTemplateHandler = async (
  request: FastifyRequest<DeletePromptTemplateRequest>,
  reply: FastifyReply
): Promise<void> => {
  const { id } = request.params;

  try {
    await deletePromptTemplate({ id });

    reply.code(200).send({
      success: true,
      data: {},
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      reply.code(404).send({
        success: false,
        error: {
          message: `Template with id ${id} not found`,
        },
      });
      return;
    }
    throw error;
  }
};
