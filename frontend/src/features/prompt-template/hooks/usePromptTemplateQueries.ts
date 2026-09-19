import { useApiClient } from "../../../hooks/useApiClient";
import {
  GetPromptTemplatesResponse,
  GetPromptTemplateResponse,
  PromptTemplateType,
} from "../types";

export const getPromptTemplatesKey = (
  type: PromptTemplateType,
  params?: {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    search?: string;
  }
) => {
  const query = new URLSearchParams();
  if (params?.page) query.append("page", String(params.page));
  if (params?.limit) query.append("limit", String(params.limit));
  if (params?.sortBy) query.append("sortBy", params.sortBy);
  if (params?.sortOrder) query.append("sortOrder", params.sortOrder);
  // 絞り込みはサーバ側で行う。画面側で絞ると、そのページの分しか対象にならない
  if (params?.search?.trim()) query.append("search", params.search.trim());
  const suffix = query.toString();
  return `/prompt-templates/${type}${suffix ? `?${suffix}` : ""}`;
};

export const getPromptTemplateKey = (id: string | null) =>
  id ? `/prompt-templates/id/${id}` : null;

/**
 * プロンプトテンプレートの一覧。
 *
 * 一覧画面はページで区切って見るが、チェックリスト作成画面は選択肢として
 * 全部から選ぶ必要がある。呼ぶ側が limit を決められるようにしてある。
 */
export function usePromptTemplates(
  type: PromptTemplateType,
  params?: {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    search?: string;
  }
) {
  const url = getPromptTemplatesKey(type, params);
  const { data, isLoading, error, refetch } =
    useApiClient().useQuery<GetPromptTemplatesResponse>(url);

  return {
    templates: data?.templates || [],
    total: data?.total ?? 0,
    page: data?.page ?? params?.page ?? 1,
    limit: data?.limit ?? params?.limit ?? 10,
    totalPages: data?.totalPages ?? 0,
    isLoading,
    error,
    refetch,
  };
}

export function usePromptTemplate(id: string | null) {
  const url = getPromptTemplateKey(id);
  const { data, isLoading, error } =
    useApiClient().useQuery<GetPromptTemplateResponse>(url);

  return {
    template: data?.template,
    isLoading,
    isError: !!error,
  };
}
