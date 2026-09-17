import { describe, expect, it, vi } from "vitest";

/**
 * 合否で絞り込んだときの検索条件を確かめる。
 *
 * 親項目の判定は子から導いた値なので、子が合格・不合格の混在だと親は不合格になる。
 * 「合格」で絞ったときに親ごと消えると、合格の子にたどり着けなくなるため、
 * 子を持つ項目は絞り込みに関わらず返す必要がある。
 */
const makeClient = () => ({
  reviewResult: {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  },
  checkList: { findMany: vi.fn().mockResolvedValue([]) },
});

const loadRepository = async (client: ReturnType<typeof makeClient>) => {
  vi.resetModules();
  vi.doMock("../../../core/db", () => ({
    getPrismaClient: async () => client,
  }));
  const module = await import("./repository");
  return module.makePrismaReviewResultRepository(client as never);
};

describe("合否フィルタの検索条件", () => {
  it("子を持つ項目は、合格で絞っても条件から外れない", async () => {
    const client = makeClient();
    const repo = await loadRepository(client);

    await repo.findReviewResultsById({
      jobId: "job-1",
      filter: "pass" as never,
      includeAllChildren: false,
    });

    const where = client.reviewResult.findMany.mock.calls[0][0].where;
    const branches = where.AND?.flatMap((entry: any) => entry.OR ?? []) ?? [];
    expect(branches).toContainEqual({ checkList: { children: { some: {} } } });
    expect(branches).toContainEqual(
      expect.objectContaining({ result: "pass" })
    );
  });

  it("絞り込みが無いときは合否の条件を付けない", async () => {
    const client = makeClient();
    const repo = await loadRepository(client);

    await repo.findReviewResultsById({
      jobId: "job-1",
      includeAllChildren: false,
    });

    const where = client.reviewResult.findMany.mock.calls[0][0].where;
    expect(where.result).toBeUndefined();
    expect(where.AND).toBeUndefined();
  });
});
