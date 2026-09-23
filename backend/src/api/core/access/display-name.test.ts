import { describe, expect, it } from "vitest";
import { displayNameOf } from "./display-name";
import type { RequestUser } from "../middleware/authorization";

const user = (claims: Record<string, unknown>): RequestUser =>
  ({ userId: "u1", isAdmin: false, rawClaims: claims }) as RequestUser;

describe("displayNameOf", () => {
  it("カスタム属性から名前を読む", () => {
    expect(displayNameOf(user({ "custom:name": "山田 太郎" }))).toBe(
      "山田 太郎"
    );
  });

  it("前後の空白は落とす", () => {
    expect(displayNameOf(user({ "custom:name": "  佐藤  " }))).toBe("佐藤");
  });

  it("属性が無ければ空。名前を持たない利用者もいる", () => {
    expect(displayNameOf(user({}))).toBeUndefined();
  });

  it("空文字は名前として扱わない", () => {
    // "" を保存すると、画面に空欄が並んで「取得できた」ように見える
    expect(displayNameOf(user({ "custom:name": "   " }))).toBeUndefined();
  });

  it("文字列以外は無視する", () => {
    expect(displayNameOf(user({ "custom:name": 123 }))).toBeUndefined();
  });

  it("利用者そのものが無くても落ちない", () => {
    expect(displayNameOf(undefined)).toBeUndefined();
  });

  it("グループは見ない。役割と名前を混ぜない", () => {
    expect(
      displayNameOf(user({ "cognito:groups": ["admin"], name: "別の場所" }))
    ).toBeUndefined();
  });
});
