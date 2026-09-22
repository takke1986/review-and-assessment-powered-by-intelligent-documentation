import { describe, it, expect, vi, beforeEach } from "vitest";

const state = {
  documents: [] as Array<{ id: string; s3Path: string }>,
  digests: [] as any[],
  pages: [] as any[],
  images: [] as any[],
  deleted: [] as any[],
};

const tx = {
  reviewDocumentDigest: {
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
  vi.clearAllMocks();
});

describe("recordReading", () => {
  it("書類に紐づけて、書いた先と読めたページを残す", async () => {
    const result = await recordReading({
      reviewJobId: "job-1",
      records: [record()],
    });

    expect(result).toMatchObject({ recorded: 1, skipped: [] });
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

  it("読み直したときは前の記録を置き換える", async () => {
    await recordReading({ reviewJobId: "job-1", records: [record()] });

    expect(state.deleted[0]).toEqual({ reviewDocumentId: "doc-1" });
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

  it("記録が空でも何もしない", async () => {
    const result = await recordReading({ reviewJobId: "job-1", records: [] });

    expect(result).toEqual({ recorded: 0, skipped: [] });
  });
});
