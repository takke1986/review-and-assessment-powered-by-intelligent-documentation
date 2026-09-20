import { useApiClient } from "../../../hooks/useApiClient";
import { UserPreference, UpdateLanguageRequest } from "../types";

/**
 * 表示する言語を変える。
 *
 * かつて MCP サーバの設定を変える口もここにあったが、API 側にも型にも
 * 残っておらず、画面からも呼ばれていなかったので消した
 */
export function useUpdateLanguage() {
  const { useMutation } = useApiClient();
  const { mutateAsync, status, error } = useMutation<
    UserPreference,
    UpdateLanguageRequest
  >("put", "/user/preference/language");

  return {
    updateLanguage: mutateAsync,
    status,
    error,
  };
}
