import { ValidationError } from "../../../core/errors";
import {
  CheckListItemDomain,
  CheckListItemEntity,
  parseCheckItemImportance,
} from "../domain/model/checklist";
import {
  getAvailableModels as getAvailableModelsFromEnv,
  ModelInfo,
} from "../domain/model/available-models";
import {
  CheckRepository,
  makePrismaCheckRepository,
} from "../domain/repository";
import {
  CreateChecklistItemRequest,
  UpdateChecklistItemRequest,
} from "../routes/handlers";
import { RequestUser } from "../../../core/middleware/authorization";
import {
  assertCanEditCheckListSetOrThrow,
  assertCanUseCheckListSetOrThrow,
} from "../../../core/access/checklist-access";
import { displayNameOf } from "../../../core/access/display-name";
import { MAX_REVIEW_GUIDANCE_LENGTH } from "../../../constants";

/** 直せるか。作成者のほか、同じ部署の人と管理者も直せる */
const assertChecklistSetEditor = async (params: {
  user: RequestUser;
  setId: string;
  repo: CheckRepository;
  api: string;
}): Promise<void> => {
  const set = await params.repo.findCheckListSetAccess(params.setId);
  assertCanEditCheckListSetOrThrow(params.user, set, {
    api: params.api,
    logger: console,
  });
};

/**
 * 誰が最後に直したかを残す。部署の誰でも直せるので、これが無いと
 * 変わった理由を聞く相手が分からない。直す処理が成功したあとに呼ぶ
 */
const markEdited = (
  repo: CheckRepository,
  setId: string,
  user: RequestUser
): Promise<void> =>
  repo.markCheckListSetEdited({
    setId,
    userId: user.userId,
    userName: displayNameOf(user),
  });

export const createChecklistItem = async (params: {
  req: CreateChecklistItemRequest;
  user: RequestUser;
  deps?: {
    repo?: CheckRepository;
  };
}): Promise<void> => {
  const repo = params.deps?.repo || (await makePrismaCheckRepository());

  const { req } = params;
  const { setId } = req.Params;
  const { parentId, importance } = req.Body;

  await assertChecklistSetEditor({
    user: params.user,
    setId,
    repo,
    api: "createChecklistItem",
  });

  const isEditable = await repo.checkSetEditable({
    setId: params.req.Params.setId,
  });
  if (!isEditable) {
    throw new ValidationError("Set is not editable");
  }

  if (parentId != null) {
    const isValid = repo.validateParentItem({
      parentItemId: parentId,
      setId,
    });
    if (!isValid) {
      throw new ValidationError("Invalid parent item");
    }
  }

  if (importance !== undefined && !parseCheckItemImportance(importance)) {
    throw new ValidationError(`Invalid importance: "${importance}"`);
  }

  const item = CheckListItemDomain.fromCreateRequest(req);
  await repo.storeCheckListItem({
    item,
  });
  await markEdited(repo, setId, params.user);
};

export const getCheckListItem = async (params: {
  itemId: string;
  user: RequestUser;
  deps?: {
    repo?: CheckRepository;
  };
}): Promise<CheckListItemEntity> => {
  const repo = params.deps?.repo || (await makePrismaCheckRepository());

  const { itemId } = params;
  const checkListItem = await repo.findCheckListItemById(itemId);

  assertCanUseCheckListSetOrThrow(
    params.user,
    await repo.findCheckListSetAccess(checkListItem.setId),
    { api: "getCheckListItem", logger: console }
  );

  return checkListItem;
};

export const modifyCheckListItem = async (params: {
  req: UpdateChecklistItemRequest;
  user: RequestUser;
  deps?: {
    repo?: CheckRepository;
  };
}): Promise<void> => {
  const repo = params.deps?.repo || (await makePrismaCheckRepository());

  await assertChecklistSetEditor({
    user: params.user,
    setId: params.req.Params.setId,
    repo,
    api: "modifyCheckListItem",
  });

  const isEditable = await repo.checkSetEditable({
    setId: params.req.Params.setId,
  });
  if (!isEditable) {
    throw new ValidationError("Set is not editable");
  }
  const currentItem = await repo.findCheckListItemById(
    params.req.Params.itemId
  );
  const newItem = CheckListItemDomain.createUpdatedItem(currentItem, {
    name: params.req.Body.name,
    description: params.req.Body.description,
    resolveAmbiguity: params.req.Body.resolveAmbiguity,
  });
  if (currentItem.setId !== newItem.setId) {
    throw new ValidationError("Invalid setId");
  }

  await repo.updateCheckListItem({
    newItem,
  });
  await markEdited(repo, params.req.Params.setId, params.user);
};

export const removeCheckListItem = async (params: {
  setId: string;
  itemId: string;
  user: RequestUser;
  deps?: {
    repo?: CheckRepository;
  };
}): Promise<void> => {
  const repo = params.deps?.repo || (await makePrismaCheckRepository());

  await assertChecklistSetEditor({
    user: params.user,
    setId: params.setId,
    repo,
    api: "removeCheckListItem",
  });

  const isEditable = await repo.checkSetEditable({
    setId: params.setId,
  });
  if (!isEditable) {
    throw new ValidationError("Set is not editable");
  }
  const { itemId } = params;

  await repo.deleteCheckListItemById({
    itemId,
  });
  await markEdited(repo, params.setId, params.user);
};

export const bulkAssignToolConfiguration = async (params: {
  checkIds: string[];
  toolConfigurationId: string | null;
  user: RequestUser;
  deps?: { repo?: CheckRepository };
}): Promise<number> => {
  const repo = params.deps?.repo || (await makePrismaCheckRepository());
  if (params.checkIds.length === 0) {
    return 0;
  }

  const setIds = await repo.findSetIdsForCheckItems(params.checkIds);
  if (setIds.length > 1) {
    throw new ValidationError("Mixed checklist set ids are not supported");
  }
  const [setId] = setIds;
  await assertChecklistSetEditor({
    user: params.user,
    setId,
    repo,
    api: "bulkAssignToolConfiguration",
  });
  const updatedCount = await repo.bulkUpdateToolConfiguration({
    checkIds: params.checkIds,
    toolConfigurationId: params.toolConfigurationId,
  });
  if (updatedCount > 0) {
    await markEdited(repo, setId, params.user);
  }
  return updatedCount;
};

/**
 * 利用可能なモデル一覧を取得する
 */
export const getAvailableModels = (): ModelInfo[] => {
  return getAvailableModelsFromEnv();
};

/**
 * チェックリスト項目のモデル ID を更新する
 */
export const updateCheckListItemModel = async (params: {
  setId: string;
  itemId: string;
  modelId: string | null;
  user: RequestUser;
  deps?: {
    repo?: CheckRepository;
  };
}): Promise<void> => {
  const repo = params.deps?.repo || (await makePrismaCheckRepository());

  await assertChecklistSetEditor({
    user: params.user,
    setId: params.setId,
    repo,
    api: "updateCheckListItemModel",
  });

  // 権限を確かめたチェックリストの項目であることを確かめる。無いと、
  // 直せるチェックリストの ID を使って、他のチェックリストの項目を変えられる
  const item = await repo.findCheckListItemById(params.itemId);
  if (item.setId !== params.setId) {
    throw new ValidationError("Invalid setId");
  }

  // modelId が指定されている場合、availableModels に含まれるか検証
  if (params.modelId !== null) {
    const availableModels = getAvailableModelsFromEnv();
    const isValid = availableModels.some((m) => m.modelId === params.modelId);
    if (!isValid) {
      throw new ValidationError(
        `Invalid modelId: "${params.modelId}" is not in availableModels`
      );
    }
  }

  await repo.updateCheckListItemModelId({
    itemId: params.itemId,
    modelId: params.modelId,
  });
  await markEdited(repo, params.setId, params.user);
};

/**
 * チェックリスト項目の重要度を更新する。
 * 重要度は審査結果の表示と絞り込みにだけ使い、判定には影響しないので、
 * モデルの変更と同じく、審査ジョブのあるチェックリストでも変更できる
 */
export const updateCheckListItemImportance = async (params: {
  setId: string;
  itemId: string;
  importance: string;
  user: RequestUser;
  deps?: {
    repo?: CheckRepository;
  };
}): Promise<void> => {
  const repo = params.deps?.repo || (await makePrismaCheckRepository());

  await assertChecklistSetEditor({
    user: params.user,
    setId: params.setId,
    repo,
    api: "updateCheckListItemImportance",
  });

  const importance = parseCheckItemImportance(params.importance);
  if (!importance) {
    throw new ValidationError(`Invalid importance: "${params.importance}"`);
  }

  // 権限を確かめたチェックリストの項目であることを確かめる
  const item = await repo.findCheckListItemById(params.itemId);
  if (item.setId !== params.setId) {
    throw new ValidationError("Invalid setId");
  }

  await repo.updateCheckListItemImportance({
    itemId: params.itemId,
    importance,
  });
  await markEdited(repo, params.setId, params.user);
};

/**
 * チェック項目の着眼点を更新する。
 * 着眼点は次の審査から効く補助情報で、過去の結果は変わらないため、
 * 審査ジョブのあるチェックリストでも書ける
 */
export const updateCheckListItemReviewGuidance = async (params: {
  setId: string;
  itemId: string;
  reviewGuidance: string;
  user: RequestUser;
  deps?: {
    repo?: CheckRepository;
  };
}): Promise<void> => {
  const repo = params.deps?.repo || (await makePrismaCheckRepository());

  await assertChecklistSetEditor({
    user: params.user,
    setId: params.setId,
    repo,
    api: "updateCheckListItemReviewGuidance",
  });

  const guidance = (params.reviewGuidance ?? "").trim();
  // 長すぎる文章は費用が読めなくなるうえ、本来の指示を薄めるので上限を設ける
  if (guidance.length > MAX_REVIEW_GUIDANCE_LENGTH) {
    throw new ValidationError(
      `Review guidance is too long: ${guidance.length} > ${MAX_REVIEW_GUIDANCE_LENGTH}`
    );
  }

  // 権限を確かめたチェックリストの項目であることを確かめる
  const item = await repo.findCheckListItemById(params.itemId);
  if (item.setId !== params.setId) {
    throw new ValidationError("Invalid setId");
  }

  const next = guidance === "" ? null : guidance;
  await repo.updateCheckListItemReviewGuidance({
    itemId: params.itemId,
    reviewGuidance: next,
    // 同じ文言で保存し直しても、書いた日は動かさない。
    // 効果を測る起点になるので、実際に変えたときだけ更新する
    changed: (item.reviewGuidance ?? null) !== next,
  });
  await markEdited(repo, params.setId, params.user);
};

/**
 * 過去の指摘の要約を消す。
 *
 * 要約は、判定を上書きしたときのコメントから自動で作られ、この項目の
 * これからの審査すべてに入る。中身が不適切でも以前は誰にも見えず、
 * 消す手段も無かった。チェックリストを直せる人が消せるようにする。
 * 着眼点と同じく次の審査から効くだけなので、審査ジョブのある
 * チェックリストでも消せる
 */
export const clearCheckListItemFeedbackSummary = async (params: {
  setId: string;
  itemId: string;
  user: RequestUser;
  deps?: {
    repo?: CheckRepository;
  };
}): Promise<void> => {
  const repo = params.deps?.repo || (await makePrismaCheckRepository());

  await assertChecklistSetEditor({
    user: params.user,
    setId: params.setId,
    repo,
    api: "clearCheckListItemFeedbackSummary",
  });

  // 権限を確かめたチェックリストの項目であることを確かめる
  const item = await repo.findCheckListItemById(params.itemId);
  if (item.setId !== params.setId) {
    throw new ValidationError("Invalid setId");
  }

  await repo.clearFeedbackSummary(params.itemId);
  await markEdited(repo, params.setId, params.user);
};
