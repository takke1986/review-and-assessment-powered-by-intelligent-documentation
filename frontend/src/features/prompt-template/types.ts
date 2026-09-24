import { ApiResponse } from "../../types/api";

export enum PromptTemplateType {
  CHECKLIST = "checklist",
  REVIEW = "review",
}

export interface PromptTemplate {
  id: string;
  userId: string;
  name: string;
  description?: string;
  prompt: string;
  /** 兼務のときに選ばれた部署。所属していなければサーバが弾く */
  departmentId?: string;
  type: PromptTemplateType;
  /** 見ている人が消せるか。作成者と管理者だけ。同じ部署の人は直せるが消せない */
  canDelete?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePromptTemplateRequest {
  name: string;
  description?: string;
  prompt: string;
  type: PromptTemplateType;
  /** 共有先の部署。兼務のときにモーダルで選ばれる。省略すると所属から決まる */
  departmentId?: string;
}

export interface UpdatePromptTemplateRequest {
  name?: string;
  description?: string;
  prompt?: string;
}

/**
 * 編集モーダルが保存時に渡すもの。作るときだけ部署が付く
 * （既存のものは共有先を変えない）
 */
export interface PromptTemplateEditorData extends UpdatePromptTemplateRequest {
  departmentId?: string;
}

export type GetPromptTemplatesResponse = ApiResponse<{
  templates: PromptTemplate[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}>;

export type GetPromptTemplateResponse = ApiResponse<{
  template: PromptTemplate;
}>;

export type CreatePromptTemplateResponse = ApiResponse<{
  template: PromptTemplate;
}>;

export type UpdatePromptTemplateResponse = ApiResponse<{
  template: PromptTemplate;
}>;

export type DeletePromptTemplateResponse = ApiResponse<Record<string, never>>;
