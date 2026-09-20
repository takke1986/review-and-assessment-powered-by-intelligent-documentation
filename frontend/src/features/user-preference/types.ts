import { ApiResponse } from "../../types/api";

export interface UserPreference {
  id: string;
  userId: string;
  language: string;
  createdAt: string;
  updatedAt: string;
  /**
   * 属している部署。兼務があるので複数。サーバが答える。
   * 画面がトークンから自分で読むと、サーバの決め方とずれる
   */
  departments?: string[];
}

export interface UpdateLanguageRequest {
  language: string;
}

export type GetUserPreferenceResponse = ApiResponse<UserPreference>;
export type UpdateLanguageResponse = ApiResponse<UserPreference>;
