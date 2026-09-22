import { describe, it, expect } from "vitest";
import { departmentsOf, resolveDepartment } from "./departments";
import type { RequestUser } from "../middleware/authorization";

const user = (overrides: Partial<RequestUser> = {}): RequestUser =>
  ({ userId: "u-1", isAdmin: false, ...overrides }) as RequestUser;

/** 部署の属性を持つ利用者 */
const withDepartments = (value: unknown) =>
  user({ rawClaims: { "custom:departments": value } });

describe("departmentsOf", () => {
  it("属性から読む。兼務はそのまま複数になる", () => {
    expect(departmentsOf(withDepartments("sales,legal"))).toEqual([
      "sales",
      "legal",
    ]);
  });

  it("区切りは読点でも分号でも空白でもよい。IdP によって変わる", () => {
    expect(departmentsOf(withDepartments("sales, legal;audit  procurement"))).toEqual(
      ["sales", "legal", "audit", "procurement"]
    );
  });

  it("同じ部署が二度入っていても重複させない", () => {
    expect(departmentsOf(withDepartments("sales, legal, sales"))).toEqual([
      "sales",
      "legal",
    ]);
  });

  it("グループは見ない。役割の管理に使うものなので混ぜない", () => {
    // ここを混ぜると、役割のグループを足したつもりで見える範囲が変わる
    expect(
      departmentsOf(user({ "cognito:groups": ["dept-sales", "admins"] }))
    ).toEqual([]);
  });

  it("属していなければ空。部署を使わない運用でも止まらない", () => {
    expect(departmentsOf(user())).toEqual([]);
    expect(departmentsOf(undefined)).toEqual([]);
    expect(departmentsOf(withDepartments(""))).toEqual([]);
    expect(departmentsOf(withDepartments("  ,  ; "))).toEqual([]);
  });

  it("属性が文字列でなければ空。IdP が配列で入れてきても落ちない", () => {
    expect(departmentsOf(withDepartments(["sales"]))).toEqual([]);
    expect(departmentsOf(withDepartments(42))).toEqual([]);
  });
});

describe("resolveDepartment", () => {
  it("所属が1つなら選ぶまでもない", () => {
    expect(
      resolveDepartment({ user: withDepartments("sales") })
    ).toBe("sales");
  });

  it("兼務で選ばれていなければ止める", () => {
    // 勝手に片方へ寄せると見せたくない相手に見え、部署なしで作ると
    // 同僚の履歴に出てこないことに誰も気づけない
    expect(() =>
      resolveDepartment({
        user: withDepartments("sales,legal"),
      })
    ).toThrow(/more than one department/);
  });

  it("兼務でも選ばれていればそれを使う", () => {
    expect(
      resolveDepartment({
        user: withDepartments("sales,legal"),
        chosen: "legal",
      })
    ).toBe("legal");
  });

  it("自分が属していない部署を指定されたら止める", () => {
    // 黙って無視すると、記録されたと思われる
    expect(() =>
      resolveDepartment({
        user: withDepartments("sales"),
        chosen: "finance",
      })
    ).toThrow(/do not belong/);
  });

  it("どこにも属していなければ部署なしで作る", () => {
    expect(resolveDepartment({ user: user() })).toBeUndefined();
  });
});
