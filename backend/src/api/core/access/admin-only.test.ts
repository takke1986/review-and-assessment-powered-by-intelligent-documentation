import { describe, it, expect, vi } from "vitest";
import { assertIsAdminOrThrow } from "./visibility";

/**
 * 全員で使う共有の設定（ツール設定）を守る関門。
 *
 * ここが効かないと、誰でも他人の使っている設定を作り替え・削除できる。
 * しかも壊れたことは審査の結果が変わって初めて分かるので、気づくのが遅い
 */
describe("assertIsAdminOrThrow", () => {
  it("管理者は通す", () => {
    expect(() =>
      assertIsAdminOrThrow({ userId: "u-1", isAdmin: true })
    ).not.toThrow();
  });

  it("一般の利用者は弾く", () => {
    expect(() =>
      assertIsAdminOrThrow({ userId: "u-1", isAdmin: false })
    ).toThrow(/administrator/);
  });

  it("部署に属していても、一般なら弾く", () => {
    // 部署は「誰と共有するか」であって、権限ではない
    expect(() =>
      assertIsAdminOrThrow({ userId: "u-1", isAdmin: false })
    ).toThrow(/administrator/);
  });

  it("利用者が分からなければ弾く", () => {
    expect(() => assertIsAdminOrThrow(undefined)).toThrow(/administrator/);
  });

  it("弾いたことを記録に残す", () => {
    // 誰が何を触ろうとしたかが分からないと、あとから追えない
    const warn = vi.fn();
    expect(() =>
      assertIsAdminOrThrow(
        { userId: "u-9", isAdmin: false },
        {
          api: "createToolConfiguration",
          logger: { warn },
        }
      )
    ).toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("createToolConfiguration")
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("u-9"));
  });
});
