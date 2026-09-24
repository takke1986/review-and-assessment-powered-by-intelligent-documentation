/**
 * プロンプトもチェックリストと同じ規則。同じ部署の人は見て直せるが消せない。
 * 以前は ID が分かれば誰でも読めて、書き換えられて、消せた
 */
import { describe, it, expect, vi } from "vitest";
import {
  getPromptTemplateById,
  updatePromptTemplate,
  deletePromptTemplate,
  getPromptTemplates,
} from "./template";
import { PromptTemplateType } from "../domain/model/template";
import type { PromptTemplateRepository } from "../domain/repository";
import type { RequestUser } from "../../../core/middleware/authorization";

const user = (userId: string, departments: string) =>
  ({
    userId,
    isAdmin: false,
    rawClaims: { "custom:departments": departments },
  }) as unknown as RequestUser;

const template = {
  id: "t-1",
  userId: "creator",
  departmentId: "営業部",
  name: "契約書",
  prompt: "p",
  type: PromptTemplateType.CHECKLIST,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const repo = () =>
  ({
    getPromptTemplates: vi.fn().mockResolvedValue({
      items: [template],
      total: 1,
      page: 1,
      limit: 10,
      totalPages: 1,
    }),
    getPromptTemplateById: vi.fn().mockResolvedValue(template),
    createPromptTemplate: vi.fn(),
    updatePromptTemplate: vi.fn(),
    deletePromptTemplate: vi.fn(),
  }) as unknown as PromptTemplateRepository;

const colleague = user("colleague", "営業部");
const legal = user("legal", "法務部");

describe("prompt template access", () => {
  it("lets the same department read and edit", async () => {
    const r = repo();
    await expect(
      getPromptTemplateById({ id: "t-1", user: colleague, deps: { repo: r } })
    ).resolves.toMatchObject({ id: "t-1" });
    await updatePromptTemplate({
      request: { id: "t-1", prompt: "new" },
      user: colleague,
      deps: { repo: r },
    });
    expect(r.updatePromptTemplate).toHaveBeenCalledTimes(1);
  });

  it("does not let the same department delete", async () => {
    const r = repo();
    await expect(
      deletePromptTemplate({ id: "t-1", user: colleague, deps: { repo: r } })
    ).rejects.toThrow();
    expect(r.deletePromptTemplate).not.toHaveBeenCalled();
  });

  it("keeps another department out", async () => {
    const r = repo();
    await expect(
      getPromptTemplateById({ id: "t-1", user: legal, deps: { repo: r } })
    ).rejects.toThrow("forbidden");
    await expect(
      updatePromptTemplate({
        request: { id: "t-1", prompt: "x" },
        user: legal,
        deps: { repo: r },
      })
    ).rejects.toThrow("forbidden");
    expect(r.updatePromptTemplate).not.toHaveBeenCalled();
  });

  it("tells the list whether each template can be deleted", async () => {
    const r = repo();
    const asColleague = await getPromptTemplates({
      type: PromptTemplateType.CHECKLIST,
      user: colleague,
      deps: { repo: r },
    });
    expect(asColleague.items[0].canDelete).toBe(false);
    const asCreator = await getPromptTemplates({
      type: PromptTemplateType.CHECKLIST,
      user: user("creator", "営業部"),
      deps: { repo: r },
    });
    expect(asCreator.items[0].canDelete).toBe(true);
  });
});
