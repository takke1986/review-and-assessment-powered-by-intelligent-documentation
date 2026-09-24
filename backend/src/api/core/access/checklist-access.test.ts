/**
 * チェックリストの権限。審査ジョブと違い、同じ部署の人も直せる。
 * 消せるのは作成者と管理者だけ
 */
import { describe, it, expect } from "vitest";
import {
  canUseCheckListSet,
  canEditCheckListSet,
  canDeleteCheckListSet,
  assertCanEditCheckListSetOrThrow,
  assertCanDeleteCheckListSetOrThrow,
} from "./checklist-access";
import type { RequestUser } from "../middleware/authorization";

const user = (userId: string, departments?: string, isAdmin = false) =>
  ({
    userId,
    isAdmin,
    ...(departments
      ? { rawClaims: { "custom:departments": departments } }
      : {}),
  }) as unknown as RequestUser;

const salesSet = { id: "set-1", userId: "creator", departmentId: "営業部" };

describe("checklist access", () => {
  it("lets the creator use, edit and delete", () => {
    const creator = user("creator", "営業部");
    expect(canUseCheckListSet(creator, salesSet)).toBe(true);
    expect(canEditCheckListSet(creator, salesSet)).toBe(true);
    expect(canDeleteCheckListSet(creator, salesSet)).toBe(true);
  });

  it("lets someone in the same department use and edit, but not delete", () => {
    // 作成者が退職しても、部署の人が保守を続けられる
    const colleague = user("colleague", "営業部");
    expect(canUseCheckListSet(colleague, salesSet)).toBe(true);
    expect(canEditCheckListSet(colleague, salesSet)).toBe(true);
    expect(canDeleteCheckListSet(colleague, salesSet)).toBe(false);
    expect(() =>
      assertCanDeleteCheckListSetOrThrow(colleague, salesSet, { api: "t" })
    ).toThrow();
  });

  it("counts a second department held concurrently", () => {
    expect(canEditCheckListSet(user("both", "法務部,営業部"), salesSet)).toBe(
      true
    );
  });

  it("keeps other departments out", () => {
    const legal = user("legal", "法務部");
    expect(canUseCheckListSet(legal, salesSet)).toBe(false);
    expect(() =>
      assertCanEditCheckListSetOrThrow(legal, salesSet, { api: "t" })
    ).toThrow("forbidden");
  });

  it("does not open a checklist without a department to anyone but its creator", () => {
    const noDepartmentSet = { id: "set-2", userId: "creator" };
    expect(
      canEditCheckListSet(user("colleague", "営業部"), noDepartmentSet)
    ).toBe(false);
    expect(canEditCheckListSet(user("nobody"), noDepartmentSet)).toBe(false);
  });

  it("lets an administrator do everything", () => {
    const admin = user("admin", "管理部", true);
    expect(canEditCheckListSet(admin, salesSet)).toBe(true);
    expect(canDeleteCheckListSet(admin, salesSet)).toBe(true);
  });

  it("refuses when the user is unknown", () => {
    // 一覧の絞り込みでは「利用者なし＝絞らない」だが、1件の許可では通さない
    expect(canUseCheckListSet(undefined, salesSet)).toBe(false);
    expect(canDeleteCheckListSet(undefined, salesSet)).toBe(false);
  });
});
