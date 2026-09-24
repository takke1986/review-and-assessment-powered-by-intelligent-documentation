import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  createChecklistItem,
  modifyCheckListItem,
  removeCheckListItem,
  getAvailableModels,
  updateCheckListItemModel,
} from "./checklist-item";
import type { CreateChecklistItemRequest } from "../routes/handlers";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../core/errors/application-errors";

const makeRequest = (): CreateChecklistItemRequest => ({
  Params: { setId: "set-1" },
  Body: { name: "Item", description: "Desc" },
});

describe("createChecklistItem authorization", () => {
  it("throws ForbiddenError when user is not owner", async () => {
    const repo = {
      findCheckListSetAccess: vi
        .fn()
        .mockResolvedValue({ id: "set-1", userId: "owner-1" }),
      markCheckListSetEdited: vi.fn().mockResolvedValue(undefined),
      findCheckListSetDetailById: vi.fn().mockResolvedValue({
        userId: "owner-1",
      }),
      checkSetEditable: vi.fn().mockResolvedValue(true),
      validateParentItem: vi.fn().mockResolvedValue(true),
      storeCheckListItem: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      createChecklistItem({
        req: makeRequest(),
        user: { userId: "other-1", isAdmin: false },
        deps: { repo },
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows owner to create checklist item", async () => {
    const repo = {
      findCheckListSetAccess: vi
        .fn()
        .mockResolvedValue({ id: "set-1", userId: "owner-1" }),
      markCheckListSetEdited: vi.fn().mockResolvedValue(undefined),
      findCheckListSetDetailById: vi.fn().mockResolvedValue({
        userId: "owner-1",
      }),
      checkSetEditable: vi.fn().mockResolvedValue(true),
      validateParentItem: vi.fn().mockResolvedValue(true),
      storeCheckListItem: vi.fn().mockResolvedValue(undefined),
    };

    await createChecklistItem({
      req: makeRequest(),
      user: { userId: "owner-1", isAdmin: false },
      deps: { repo },
    });

    expect(repo.storeCheckListItem).toHaveBeenCalled();
  });
});

describe("checklist item edit/delete authorization", () => {
  it("throws ForbiddenError when non-owner modifies item", async () => {
    const repo = {
      findCheckListSetAccess: vi
        .fn()
        .mockResolvedValue({ id: "set-1", userId: "owner-1" }),
      markCheckListSetEdited: vi.fn().mockResolvedValue(undefined),
      findCheckListSetDetailById: vi.fn().mockResolvedValue({
        userId: "owner-1",
      }),
      checkSetEditable: vi.fn().mockResolvedValue(true),
      findCheckListItemById: vi.fn().mockResolvedValue({
        id: "item-1",
        setId: "set-1",
        name: "Item",
        description: "Desc",
      }),
      updateCheckListItem: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      modifyCheckListItem({
        req: {
          Params: { setId: "set-1", itemId: "item-1" },
          Body: {
            name: "Updated",
            description: "Updated",
            resolveAmbiguity: false,
          },
        },
        user: { userId: "other-1", isAdmin: false },
        deps: { repo },
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError when non-owner deletes item", async () => {
    const repo = {
      findCheckListSetAccess: vi
        .fn()
        .mockResolvedValue({ id: "set-1", userId: "owner-1" }),
      markCheckListSetEdited: vi.fn().mockResolvedValue(undefined),
      findCheckListSetDetailById: vi.fn().mockResolvedValue({
        userId: "owner-1",
      }),
      checkSetEditable: vi.fn().mockResolvedValue(true),
      deleteCheckListItemById: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      removeCheckListItem({
        setId: "set-1",
        itemId: "item-1",
        user: { userId: "other-1", isAdmin: false },
        deps: { repo },
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("getAvailableModels", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns models from AVAILABLE_MODELS env var", () => {
    const models = [
      { modelId: "anthropic.claude-sonnet-4", displayName: "Claude Sonnet 4" },
      { modelId: "anthropic.claude-haiku-3", displayName: "Claude Haiku 3" },
    ];
    vi.stubEnv("AVAILABLE_MODELS", JSON.stringify(models));

    const result = getAvailableModels();

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      modelId: "anthropic.claude-sonnet-4",
      displayName: "Claude Sonnet 4",
    });
    expect(result[1]).toEqual({
      modelId: "anthropic.claude-haiku-3",
      displayName: "Claude Haiku 3",
    });
  });

  it("returns empty array when AVAILABLE_MODELS is not set", () => {
    vi.stubEnv("AVAILABLE_MODELS", "");

    const result = getAvailableModels();

    expect(result).toEqual([]);
  });

  it("returns empty array when AVAILABLE_MODELS is invalid JSON", () => {
    vi.stubEnv("AVAILABLE_MODELS", "not-json");

    const result = getAvailableModels();

    expect(result).toEqual([]);
  });

  it("filters out entries with missing modelId or displayName", () => {
    const models = [
      { modelId: "valid-model", displayName: "Valid" },
      { modelId: "", displayName: "Empty ID" },
      { modelId: "no-name", displayName: "" },
      { displayName: "Missing ID" },
      { modelId: "missing-name" },
    ];
    vi.stubEnv("AVAILABLE_MODELS", JSON.stringify(models));

    const result = getAvailableModels();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ modelId: "valid-model", displayName: "Valid" });
  });
});

describe("updateCheckListItemModel", () => {
  beforeEach(() => {
    vi.stubEnv(
      "AVAILABLE_MODELS",
      JSON.stringify([
        {
          modelId: "anthropic.claude-sonnet-4",
          displayName: "Claude Sonnet 4",
        },
      ])
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("updates modelId for a valid item owned by the user", async () => {
    const repo = {
      findCheckListSetAccess: vi
        .fn()
        .mockResolvedValue({ id: "set-1", userId: "owner-1" }),
      markCheckListSetEdited: vi.fn().mockResolvedValue(undefined),
      findCheckListSetDetailById: vi.fn().mockResolvedValue({
        userId: "owner-1",
      }),
      findCheckListItemById: vi.fn().mockResolvedValue({
        id: "item-1",
        setId: "set-1",
        name: "Item",
      }),
      updateCheckListItemModelId: vi.fn().mockResolvedValue(undefined),
    };

    await updateCheckListItemModel({
      setId: "set-1",
      itemId: "item-1",
      modelId: "anthropic.claude-sonnet-4",
      user: { userId: "owner-1", isAdmin: false },
      deps: { repo },
    });

    expect(repo.updateCheckListItemModelId).toHaveBeenCalledWith({
      itemId: "item-1",
      modelId: "anthropic.claude-sonnet-4",
    });
  });

  it("resets modelId to null (default fallback)", async () => {
    const repo = {
      findCheckListSetAccess: vi
        .fn()
        .mockResolvedValue({ id: "set-1", userId: "owner-1" }),
      markCheckListSetEdited: vi.fn().mockResolvedValue(undefined),
      findCheckListSetDetailById: vi.fn().mockResolvedValue({
        userId: "owner-1",
      }),
      findCheckListItemById: vi.fn().mockResolvedValue({
        id: "item-1",
        setId: "set-1",
        name: "Item",
      }),
      updateCheckListItemModelId: vi.fn().mockResolvedValue(undefined),
    };

    await updateCheckListItemModel({
      setId: "set-1",
      itemId: "item-1",
      modelId: null,
      user: { userId: "owner-1", isAdmin: false },
      deps: { repo },
    });

    expect(repo.updateCheckListItemModelId).toHaveBeenCalledWith({
      itemId: "item-1",
      modelId: null,
    });
  });

  it("throws NotFoundError when item does not exist", async () => {
    const repo = {
      findCheckListSetAccess: vi
        .fn()
        .mockResolvedValue({ id: "set-1", userId: "owner-1" }),
      markCheckListSetEdited: vi.fn().mockResolvedValue(undefined),
      findCheckListSetDetailById: vi.fn().mockResolvedValue({
        userId: "owner-1",
      }),
      findCheckListItemById: vi
        .fn()
        .mockRejectedValue(new NotFoundError("Item not found", "item-999")),
      updateCheckListItemModelId: vi.fn(),
    };

    await expect(
      updateCheckListItemModel({
        setId: "set-1",
        itemId: "item-999",
        modelId: "anthropic.claude-sonnet-4",
        user: { userId: "owner-1", isAdmin: false },
        deps: { repo },
      })
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(repo.updateCheckListItemModelId).not.toHaveBeenCalled();
  });

  it("throws ForbiddenError when non-owner updates model", async () => {
    const repo = {
      findCheckListSetAccess: vi
        .fn()
        .mockResolvedValue({ id: "set-1", userId: "owner-1" }),
      markCheckListSetEdited: vi.fn().mockResolvedValue(undefined),
      findCheckListSetDetailById: vi.fn().mockResolvedValue({
        userId: "owner-1",
      }),
      findCheckListItemById: vi.fn().mockResolvedValue({
        id: "item-1",
        setId: "set-1",
        name: "Item",
      }),
      updateCheckListItemModelId: vi.fn(),
    };

    await expect(
      updateCheckListItemModel({
        setId: "set-1",
        itemId: "item-1",
        modelId: "anthropic.claude-sonnet-4",
        user: { userId: "other-1", isAdmin: false },
        deps: { repo },
      })
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(repo.updateCheckListItemModelId).not.toHaveBeenCalled();
  });

  it("throws ValidationError when modelId is not in availableModels", async () => {
    const repo = {
      findCheckListSetAccess: vi
        .fn()
        .mockResolvedValue({ id: "set-1", userId: "owner-1" }),
      markCheckListSetEdited: vi.fn().mockResolvedValue(undefined),
      findCheckListSetDetailById: vi.fn().mockResolvedValue({
        userId: "owner-1",
      }),
      findCheckListItemById: vi.fn().mockResolvedValue({
        id: "item-1",
        setId: "set-1",
        name: "Item",
      }),
      updateCheckListItemModelId: vi.fn(),
    };

    await expect(
      updateCheckListItemModel({
        setId: "set-1",
        itemId: "item-1",
        modelId: "unknown-model-id",
        user: { userId: "owner-1", isAdmin: false },
        deps: { repo },
      })
    ).rejects.toBeInstanceOf(ValidationError);

    expect(repo.updateCheckListItemModelId).not.toHaveBeenCalled();
  });
});

describe("editing by the same department", () => {
  const colleague = {
    userId: "colleague-1",
    isAdmin: false,
    rawClaims: { "custom:departments": "営業部", "custom:name": "佐藤" },
  };
  const repoFor = () => ({
    findCheckListSetAccess: vi.fn().mockResolvedValue({
      id: "set-1",
      userId: "owner-1",
      departmentId: "営業部",
    }),
    markCheckListSetEdited: vi.fn().mockResolvedValue(undefined),
    checkSetEditable: vi.fn().mockResolvedValue(true),
    findCheckListItemById: vi.fn().mockResolvedValue({
      id: "item-1",
      setId: "set-1",
      name: "Item",
      description: "Desc",
    }),
    updateCheckListItem: vi.fn().mockResolvedValue(undefined),
    updateCheckListItemModelId: vi.fn().mockResolvedValue(undefined),
  });

  it("lets a colleague edit and records who did it", async () => {
    // 作成者が退職しても、部署の人が直せる。誰が直したかは残る
    const repo = repoFor();
    await modifyCheckListItem({
      req: {
        Params: { setId: "set-1", itemId: "item-1" },
        Body: {
          name: "Updated",
          description: "Updated",
          resolveAmbiguity: false,
        },
      },
      user: colleague,
      deps: { repo: repo as never },
    });
    expect(repo.updateCheckListItem).toHaveBeenCalledTimes(1);
    expect(repo.markCheckListSetEdited).toHaveBeenCalledWith({
      setId: "set-1",
      userId: "colleague-1",
      userName: "佐藤",
    });
  });

  it("does not record an edit that was rejected", async () => {
    const repo = repoFor();
    repo.checkSetEditable.mockResolvedValue(false);
    await expect(
      modifyCheckListItem({
        req: {
          Params: { setId: "set-1", itemId: "item-1" },
          Body: {
            name: "Updated",
            description: "Updated",
            resolveAmbiguity: false,
          },
        },
        user: colleague,
        deps: { repo: repo as never },
      })
    ).rejects.toThrow("Set is not editable");
    expect(repo.markCheckListSetEdited).not.toHaveBeenCalled();
  });

  it("refuses to change the model of an item in another checklist", async () => {
    // 直せるチェックリストの ID を使って、他のチェックリストの項目を変えられないこと
    const repo = repoFor();
    repo.findCheckListItemById.mockResolvedValue({
      id: "item-9",
      setId: "other-set",
      name: "Other",
      description: "",
    });
    await expect(
      updateCheckListItemModel({
        setId: "set-1",
        itemId: "item-9",
        modelId: null,
        user: colleague,
        deps: { repo: repo as never },
      })
    ).rejects.toThrow("Invalid setId");
    expect(repo.updateCheckListItemModelId).not.toHaveBeenCalled();
  });
});
