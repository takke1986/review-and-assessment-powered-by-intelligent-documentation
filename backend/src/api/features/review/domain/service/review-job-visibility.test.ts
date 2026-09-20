import { describe, it, expect } from "vitest";
import {
  canEdit,
  canView,
  visibilityFilter,
} from "./review-job-visibility";

const me = { userId: "u-1", isAdmin: false };
const admin = { userId: "u-admin", isAdmin: true };

describe("visibilityFilter", () => {
  it("一般の利用者には、自分のものと公開されたものだけ", () => {
    expect(visibilityFilter(me)).toEqual({
      OR: [{ userId: "u-1" }, { sharedWithOrg: true }],
    });
  });

  it("管理者は絞らない", () => {
    expect(visibilityFilter(admin)).toBeUndefined();
  });
});

describe("canView", () => {
  it("自分のジョブは見られる", () => {
    expect(canView(me, { userId: "u-1", sharedWithOrg: false })).toBe(true);
  });

  it("公開されていない他人のジョブは見られない", () => {
    expect(canView(me, { userId: "u-2", sharedWithOrg: false })).toBe(false);
  });

  it("公開された他人のジョブは見られる", () => {
    expect(canView(me, { userId: "u-2", sharedWithOrg: true })).toBe(true);
  });

  it("管理者は公開されていなくても見られる", () => {
    expect(canView(admin, { userId: "u-2", sharedWithOrg: false })).toBe(true);
  });
});

describe("canEdit", () => {
  it("公開されていても、直せるのは作成者だけ", () => {
    // 見えることと直せることを混ぜない。ここが崩れると、
    // 誰が判定を決めたのか分からなくなる
    expect(canEdit(me, { userId: "u-2" })).toBe(false);
    expect(canView(me, { userId: "u-2", sharedWithOrg: true })).toBe(true);
  });

  it("自分のジョブは直せる", () => {
    expect(canEdit(me, { userId: "u-1" })).toBe(true);
  });

  it("管理者は直せる", () => {
    expect(canEdit(admin, { userId: "u-2" })).toBe(true);
  });
});
