/**
 * 過去の指摘の要約は、チェックリストを直せる人が消せる。
 * 要約はこの項目のこれからの審査に入るので、他部署の人には消させない
 */
import { describe, it, expect, vi } from "vitest";
import { clearCheckListItemFeedbackSummary } from "./checklist-item";

const repo = () => ({
  findCheckListSetAccess: vi
    .fn()
    .mockResolvedValue({
      id: "set-1",
      userId: "owner",
      departmentId: "営業部",
    }),
  findCheckListItemById: vi
    .fn()
    .mockResolvedValue({ id: "item-1", setId: "set-1", name: "金額" }),
  clearFeedbackSummary: vi.fn().mockResolvedValue(undefined),
  markCheckListSetEdited: vi.fn().mockResolvedValue(undefined),
});
const user = (userId: string, departments: string) =>
  ({
    userId,
    isAdmin: false,
    rawClaims: { "custom:departments": departments },
  }) as never;

describe("clearCheckListItemFeedbackSummary", () => {
  it("lets someone in the same department clear it, and records the edit", async () => {
    const r = repo();
    await clearCheckListItemFeedbackSummary({
      setId: "set-1",
      itemId: "item-1",
      user: user("colleague", "営業部"),
      deps: { repo: r as never },
    });
    expect(r.clearFeedbackSummary).toHaveBeenCalledWith("item-1");
    expect(r.markCheckListSetEdited).toHaveBeenCalledTimes(1);
  });

  it("keeps another department out", async () => {
    const r = repo();
    await expect(
      clearCheckListItemFeedbackSummary({
        setId: "set-1",
        itemId: "item-1",
        user: user("legal", "法務部"),
        deps: { repo: r as never },
      })
    ).rejects.toThrow("forbidden");
    expect(r.clearFeedbackSummary).not.toHaveBeenCalled();
  });

  it("refuses an item of another checklist", async () => {
    const r = repo();
    r.findCheckListItemById.mockResolvedValue({ id: "item-9", setId: "other" });
    await expect(
      clearCheckListItemFeedbackSummary({
        setId: "set-1",
        itemId: "item-9",
        user: user("owner", "営業部"),
        deps: { repo: r as never },
      })
    ).rejects.toThrow("Invalid setId");
  });
});
