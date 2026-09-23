import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * 画面に並べ替えのボタンがあるのに、サーバが許していない列があった。
 * 押しても既定の並びに落ちるだけで、誰も気づけなかった（文書の件数）。
 * 画面の列とサーバの許可列を突き合わせる。
 */

const repoRoot = path.resolve(__dirname, "../../../../../../..");

const read = (relative: string) =>
  fs.readFileSync(path.join(repoRoot, relative), "utf-8");

const serverFields = (): Set<string> => {
  const source = read("backend/src/api/features/review/routes/handlers.ts");
  const block = source.match(
    /const SORTABLE_FIELDS = \[([\s\S]*?)\] as const;/
  );
  if (!block) throw new Error("SORTABLE_FIELDS が見つからない");
  return new Set(
    Array.from(block[1].matchAll(/"([a-zA-Z]+)"/g)).map((m) => m[1])
  );
};

const screenColumns = (): Set<string> => {
  const source = read(
    "frontend/src/features/review/components/ReviewJobList.tsx"
  );
  // 並べられる列だけを見る（sortable: true が付いているもの）
  const columns = Array.from(
    source.matchAll(/key: "([a-zA-Z]+)",[\s\S]{0,400}?sortable: true/g)
  ).map((m) => m[1]);
  return new Set(columns);
};

describe("審査ジョブ一覧の並べ替え", () => {
  it("画面で並べられる列は、サーバも許している", () => {
    const allowed = serverFields();
    const missing = [...screenColumns()].filter((key) => !allowed.has(key));

    expect(missing).toEqual([]);
  });

  it("画面の列を1つも拾えていない、ということはない", () => {
    expect(screenColumns().size).toBeGreaterThan(0);
  });
});
