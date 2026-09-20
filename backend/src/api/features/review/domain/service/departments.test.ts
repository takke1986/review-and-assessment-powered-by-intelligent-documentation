import { describe, it, expect } from "vitest";
import { departmentsOf, resolveDepartment } from "./departments";
import type { RequestUser } from "../../../../core/middleware/authorization";

const user = (overrides: Partial<RequestUser> = {}): RequestUser =>
  ({ userId: "u-1", isAdmin: false, ...overrides }) as RequestUser;

describe("departmentsOf", () => {
  it("グループから読む。兼務はそのまま複数になる", () => {
    expect(
      departmentsOf(user({ "cognito:groups": ["dept-sales", "dept-legal"] }))
    ).toEqual(["sales", "legal"]);
  });

  it("部署以外のグループは混ぜない", () => {
    expect(
      departmentsOf(user({ "cognito:groups": ["admins", "dept-sales"] }))
    ).toEqual(["sales"]);
  });

  it("属性からも読む。区切りは読点でも空白でもよい", () => {
    expect(
      departmentsOf(
        user({ rawClaims: { "custom:departments": "sales, legal  audit" } })
      )
    ).toEqual(["sales", "legal", "audit"]);
  });

  it("両方に入っていても重複させない", () => {
    expect(
      departmentsOf(
        user({
          "cognito:groups": ["dept-sales"],
          rawClaims: { "custom:departments": "sales,legal" },
        })
      )
    ).toEqual(["sales", "legal"]);
  });

  it("属していなければ空。部署を使わない運用でも止まらない", () => {
    expect(departmentsOf(user())).toEqual([]);
    expect(departmentsOf(undefined)).toEqual([]);
  });
});

describe("resolveDepartment", () => {
  it("所属が1つなら選ぶまでもない", () => {
    expect(
      resolveDepartment({ user: user({ "cognito:groups": ["dept-sales"] }) })
    ).toBe("sales");
  });

  it("兼務で選ばれていなければ止める", () => {
    // 勝手に片方へ寄せると見せたくない相手に見え、部署なしで作ると
    // 同僚の履歴に出てこないことに誰も気づけない
    expect(() =>
      resolveDepartment({
        user: user({ "cognito:groups": ["dept-sales", "dept-legal"] }),
      })
    ).toThrow(/more than one department/);
  });

  it("兼務でも選ばれていればそれを使う", () => {
    expect(
      resolveDepartment({
        user: user({ "cognito:groups": ["dept-sales", "dept-legal"] }),
        chosen: "legal",
      })
    ).toBe("legal");
  });

  it("自分が属していない部署を指定されたら止める", () => {
    // 黙って無視すると、記録されたと思われる
    expect(() =>
      resolveDepartment({
        user: user({ "cognito:groups": ["dept-sales"] }),
        chosen: "finance",
      })
    ).toThrow(/do not belong/);
  });

  it("どこにも属していなければ部署なしで作る", () => {
    expect(resolveDepartment({ user: user() })).toBeUndefined();
  });
});
