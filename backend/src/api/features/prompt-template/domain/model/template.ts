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
  /** どの部署のものか。同じ部署の人から見える */
  departmentId?: string;
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
    /** どの部署の仕事として記録するか。呼び出し側が resolveDepartment で決める */
    departmentId?: string;
  }): PromptTemplateEntity => {
    return {
      id: ulid(),
      userId: req.userId,
      // 保存も表示もこの名前を使う。検索と突き合わせられるよう、ここでそろえる
      name: normalizeForStorage(req.name),
      description: req.description,
      departmentId: req.departmentId,
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
