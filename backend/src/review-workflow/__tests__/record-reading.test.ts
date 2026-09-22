import { describe, it, expect, vi, beforeEach } from "vitest";

const state = {
  documents: [] as Array<{ id: string; s3Path: string }>,
  digests: [] as any[],
  pages: [] as any[],
  images: [] as any[],
  deleted: [] as any[],
  upserted: [] as any[],
};

const tx = {
  reviewDocumentDigest: {
    upsert: vi.fn(async (args: any) => {
      state.upserted.push(args.create);
      return args.create;
    }),
    deleteMany: vi.fn(async (args: any) => {
      state.deleted.push(args.where);
      return { count: 0 };
    }),
    create: vi.fn(async (args: any) => {
      state.digests.push(args.data);
      return args.data;
    }),
  },
  reviewDocumentPage: {
    createMany: vi.fn(async (args: any) => {
      state.pages.push(...args.data);
      return { count: args.data.length };
    }),
  },
  reviewDocumentImage: {
    createMany: vi.fn(async (args: any) => {
      state.images.push(...args.data);
      return { count: args.data.length };
    }),
  },
};

vi.mock("../../api/core/db", () => ({
  getPrismaClient: async () => ({
    reviewDocument: {
      findMany: async () => state.documents,
    },
    $transaction: async (fn: any) => fn(tx),
    reviewDocumentDigest: tx.reviewDocumentDigest,
  }),
}));

import { recordReading } from "../review-reading/record-reading";

const record = (overrides: any = {}) => ({
  documentKey: "review/original/a/設計書.pdf",
  s3Key: "digest/job-1/review/original/a/設計書.pdf.json",
  pages: [
    { pageNumber: 1, wasRead: true, hasFigure: true, charCount: 120 },
    { pageNumber: 2, wasRead: true, hasFigure: false, charCount: 80 },
  ],
  images: [{ name: "image1.png", hasText: true, hasDescription: false }],
  ...overrides,
});

beforeEach(() => {
  state.documents = [{ id: "doc-1", s3Path: "review/original/a/設計書.pdf" }];
  state.digests = [];
  state.pages = [];
  state.images = [];
  state.deleted = [];
  state.upserted = [];
  vi.clearAllMocks();
});

describe("recordReading", () => {
  it("書類に紐づけて、書いた先と読めたページを残す", async () => {
    const result = await recordReading({
      reviewJobId: "job-1",
      records: [record()],
    });

    expect(result).toMatchObject({ recorded: 1, skipped: [], notNeeded: 0 });
    expect(state.digests[0]).toMatchObject({
      reviewDocumentId: "doc-1",
      s3Key: "digest/job-1/review/original/a/設計書.pdf.json",
      status: "completed",
    });
    expect(state.pages.map((p) => p.pageNumber)).toEqual([1, 2]);
    expect(state.images[0]).toMatchObject({ name: "image1.png", hasText: true });
  });

  it("一部しか読めていなければ partial にする", async () => {
    await recordReading({
      reviewJobId: "job-1",
      records: [
        record({
          pages: [
            { pageNumber: 1, wasRead: true, hasFigure: false, charCount: 10 },
            { pageNumber: 2, wasRead: false, hasFigure: false, charCount: 0 },
          ],
        }),
      ],
    });

    expect(state.digests[0].status).toBe("partial");
  });

  it("1ページも読めていなければ failed にする", async () => {
    await recordReading({
      reviewJobId: "job-1",
      records: [
        record({
          pages: [
            { pageNumber: 1, wasRead: false, hasFigure: false, charCount: 0 },
          ],
        }),
      ],
    });

    expect(state.digests[0].status).toBe("failed");
  });

  it("読むページが無かった書類は no_pages にする", async () => {
    // Office のように、文字を XML から直に取れてページを持たない書類。
    // completed と混ぜると「読んだ結果、問題なし」と区別できなくなる
    await recordReading({
      reviewJobId: "job-1",
      records: [record({ pages: [] })],
    });

    expect(state.digests[0].status).toBe("no_pages");
    expect(state.pages).toHaveLength(0);
  });

  it("読み直したときは前の記録を置き換える", async () => {
    await recordReading({ reviewJobId: "job-1", records: [record()] });

    expect(state.deleted[0]).toEqual({ reviewDocumentId: "doc-1" });
  });

  it("先読みを通らなかった書類は not_needed として残す", async () => {
    // 小さい書類は先読みを通らない。行が無いままだと「不要だった」のか
    // 「記録に失敗した」のかが区別できない
    state.documents = [
      { id: "doc-1", s3Path: "review/original/a/設計書.pdf" },
      { id: "doc-2", s3Path: "review/original/b/小さい.pdf" },
    ];

    const result = await recordReading({
      reviewJobId: "job-1",
      records: [record()],
    });

    expect(result).toMatchObject({ recorded: 1, notNeeded: 1 });
    expect(state.upserted).toHaveLength(1);
    expect(state.upserted[0]).toMatchObject({
      reviewDocumentId: "doc-2",
      status: "not_needed",
      s3Key: null,
    });
  });

  it("既に記録がある書類は、先読み不要で上書きしない", async () => {
    // upsert の update を空にしてあるので、読めたページが消えない
    await recordReading({ reviewJobId: "job-1", records: [record()] });

    expect(state.upserted).toHaveLength(0);
  });

  it("対応する書類が無ければ、審査は止めずに記録だけ諦める", async () => {
    const result = await recordReading({
      reviewJobId: "job-1",
      records: [record({ documentKey: "review/original/どこにも無い.pdf" })],
    });

    expect(result.recorded).toBe(0);
    expect(result.skipped).toEqual(["review/original/どこにも無い.pdf"]);
    expect(state.digests).toHaveLength(0);
  });

  it("記録が空でも、先読み不要として残す", async () => {
    const result = await recordReading({ reviewJobId: "job-1", records: [] });

    // 記録すべきものが無くても、先読みを通らなかった印は残す
    expect(result).toMatchObject({ recorded: 0, skipped: [] });
    expect(state.upserted[0]).toMatchObject({
      reviewDocumentId: "doc-1",
      status: "not_needed",
      s3Key: null,
    });
  });
});
