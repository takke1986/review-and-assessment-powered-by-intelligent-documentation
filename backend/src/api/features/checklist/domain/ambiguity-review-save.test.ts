/**
 * 曖昧さの検出結果の保存。項目の一部だけを書き換えるので、名前などを
 * 渡さなくても落ちないこと。以前は項目全体の変換に通していて、名前の
 * 正規化で落ち、チェックリストの作成がすべて失敗していた
 */
import { describe, it, expect, vi } from "vitest";
import { makePrismaCheckRepository } from "./repository";

describe("updateAmbiguityReview", () => {
  it("saves only the detection result", async () => {
    const update = vi.fn().mockResolvedValue({});
    const repo = await makePrismaCheckRepository({
      checkList: { update },
    } as never);
    const detectedAt = new Date("2026-09-25T00:00:00Z");

    await repo.updateAmbiguityReview({
      itemId: "item-1",
      ambiguityReview: { suggestions: ["金額の基準を書く"], detectedAt },
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: {
        ambiguityReview: {
          suggestions: ["金額の基準を書く"],
          detectedAt: detectedAt.toISOString(),
        },
      },
    });
  });
});
