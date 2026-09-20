import { describe, it, expect } from "vitest";
import { canEdit, canView, visibilityFilter } from "./review-job-visibility";

const me = { userId: "u-1", isAdmin: false };
const sales = { userId: "u-1", isAdmin: false, departments: ["sales"] };
const both = { userId: "u-1", isAdmin: false, departments: ["sales", "legal"] };
const admin = { userId: "u-admin", isAdmin: true };

describe("visibilityFilter", () => {
  it("一般の利用者には、自分のものと自分の部署のものだけ", () => {
    expect(visibilityFilter(sales)).toEqual({
      OR: [{ userId: "u-1" }, { departmentId: { in: ["sales"] } }],
    });
  });

  it("部署に属していなければ、自分のものだけ", () => {
    expect(visibilityFilter(me)).toEqual({ OR: [{ userId: "u-1" }] });
  });

  it("兼務なら、どちらの部署も条件に入る", () => {
    expect(visibilityFilter(both)).toEqual({
      OR: [{ userId: "u-1" }, { departmentId: { in: ["sales", "legal"] } }],
    });
  });

  it("管理者は絞らない。全部見える", () => {
    expect(visibilityFilter(admin)).toBeUndefined();
  });
});

describe("canView", () => {
  it("自分のジョブは、部署が付いていなくても見られる", () => {
    expect(canView(sales, { userId: "u-1" })).toBe(true);
  });

  it("同じ部署の審査は、他の人のものでも見られる", () => {
    expect(canView(sales, { userId: "u-2", departmentId: "sales" })).toBe(true);
  });

  it("違う部署の審査は見られない", () => {
    expect(canView(sales, { userId: "u-2", departmentId: "legal" })).toBe(
      false
    );
  });

  it("部署の付いていない他人の審査は見られない", () => {
    expect(canView(sales, { userId: "u-2" })).toBe(false);
  });

  it("兼務ならどちらの部署の審査も見られる", () => {
    expect(canView(both, { userId: "u-2", departmentId: "sales" })).toBe(true);
    expect(canView(both, { userId: "u-2", departmentId: "legal" })).toBe(true);
  });

  it("管理者は、部署を問わず見られる", () => {
    expect(canView(admin, { userId: "u-2", departmentId: "legal" })).toBe(true);
    expect(canView(admin, { userId: "u-2" })).toBe(true);
  });
});

describe("canEdit", () => {
  it("同じ部署で読めても、直せるのは作成者だけ", () => {
    // 見えることと直せることを混ぜない。ここが崩れると、
    // 誰が判定を決めたのか分からなくなる
    expect(canView(sales, { userId: "u-2", departmentId: "sales" })).toBe(true);
    expect(canEdit(sales, { userId: "u-2" })).toBe(false);
  });

  it("自分のジョブは直せる", () => {
    expect(canEdit(sales, { userId: "u-1" })).toBe(true);
  });

  it("管理者は直せる", () => {
    expect(canEdit(admin, { userId: "u-2" })).toBe(true);
  });
});
