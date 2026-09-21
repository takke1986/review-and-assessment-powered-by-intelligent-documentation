import { describe, it, expect } from "vitest";
import { normalizeForStorage, normalizeSearchTerm } from "./search-text";

// macOS が作るファイル名は「カ」+ 結合濁点。利用者が打つのは合成済みの「ガ」
const 分解 = "ガス"; // ガス
const 合成 = "ガス"; // ガス

describe("normalizeForStorage", () => {
  it("分解された濁点を合成済みにそろえる", () => {
    expect(normalizeForStorage(分解)).toBe(合成);
  });

  it("表示にそのまま使うので前後の空白や大文字小文字は変えない", () => {
    expect(normalizeForStorage(" Gas 検査 ")).toBe(" Gas 検査 ");
  });
});

describe("normalizeSearchTerm", () => {
  it("分解形で打たれても合成済みと同じ検索語になる", () => {
    expect(normalizeSearchTerm(分解)).toBe(normalizeSearchTerm(合成));
  });

  it("前後の空白は落とす", () => {
    expect(normalizeSearchTerm("  見積書  ")).toBe("見積書");
  });

  it("空白だけと未指定は指定なしとして扱う", () => {
    expect(normalizeSearchTerm("   ")).toBeUndefined();
    expect(normalizeSearchTerm(undefined)).toBeUndefined();
  });
});
