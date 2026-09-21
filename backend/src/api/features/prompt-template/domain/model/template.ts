import { ulid } from "ulid";
import { normalizeForStorage } from "../../../../core/utils/search-text";

export enum PromptTemplateType {
  CHECKLIST = "checklist",
  REVIEW = "review",
}

export interface PromptTemplateEntity {
  id: string;
  userId: string;
  name: string;
  description?: string;
  prompt: string;
  type: PromptTemplateType;
  createdAt: Date;
  updatedAt: Date;
}

export const PromptTemplateDomain = {
  fromCreateRequest: (req: {
    userId: string;
    name: string;
    description?: string;
    prompt: string;
    type: PromptTemplateType;
  }): PromptTemplateEntity => {
    return {
      id: ulid(),
      userId: req.userId,
      // 保存も表示もこの名前を使う。検索と突き合わせられるよう、ここでそろえる
      name: normalizeForStorage(req.name),
      description: req.description,
      prompt: req.prompt,
      type: req.type,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  },

  fromUpdateRequest: (
    existing: PromptTemplateEntity,
    req: {
      name?: string;
      description?: string;
      prompt?: string;
    }
  ): PromptTemplateEntity => {
    return {
      ...existing,
      name:
        req.name !== undefined ? normalizeForStorage(req.name) : existing.name,
      description:
        req.description !== undefined ? req.description : existing.description,
      prompt: req.prompt !== undefined ? req.prompt : existing.prompt,
      updatedAt: new Date(),
    };
  },
};
