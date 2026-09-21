import { ulid } from "ulid";
import { normalizeForStorage } from "../../../../core/utils/search-text";

export interface KnowledgeBaseConfig {
  knowledgeBaseId: string;
  dataSourceIds?: string[];
}

export interface ToolConfigurationEntity {
  id: string;
  name: string;
  description?: string;
  knowledgeBase?: KnowledgeBaseConfig[];
  codeInterpreter: boolean;
  mcpConfig?: any;
  createdAt: Date;
  updatedAt: Date;
}

export const ToolConfigurationDomain = {
  fromCreateRequest: (req: {
    name: string;
    description?: string;
    knowledgeBase?: KnowledgeBaseConfig[];
    codeInterpreter: boolean;
    mcpConfig?: any;
  }): ToolConfigurationEntity => {
    return {
      id: ulid(),
      // 保存も表示もこの名前を使う。検索と突き合わせられるよう、ここでそろえる
      name: normalizeForStorage(req.name),
      description: req.description,
      knowledgeBase: req.knowledgeBase,
      codeInterpreter: req.codeInterpreter,
      mcpConfig: req.mcpConfig,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  },
};
