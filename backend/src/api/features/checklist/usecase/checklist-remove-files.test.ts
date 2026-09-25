/**
 * チェックリストを消すと、そのファイルと、一緒に消える審査ジョブのファイルも
 * 消える。審査ジョブのキーは、行が消える前に控えておく
 */
import { describe, it, expect, vi } from "vitest";
import { removeChecklistSet } from "./checklist-set";

describe("removeChecklistSet", () => {
  it("deletes the checklist's files and those of the review jobs removed with it", async () => {
    process.env.DOCUMENT_BUCKET = "docs";
    const order: string[] = [];
    const repo = {
      findCheckListSetDetailById: vi.fn().mockResolvedValue({
        id: "SET1",
        userId: "u-1",
        documents: [{ id: "CD1", s3Key: "checklist/original/CD1/規程.pdf" }],
      }),
      deleteCheckListSetById: vi.fn(async () => {
        order.push("rows");
      }),
    };
    const deleteObject = vi.fn(async (_b: string, key: string) => {
      order.push(key);
    });
    await removeChecklistSet({
      checkListSetId: "SET1",
      user: { userId: "u-1", isAdmin: false },
      deps: {
        repo: repo as never,
        files: {
          repo: {
            findReviewJobsOfCheckListSet: vi.fn(async () => {
              order.push("jobs looked up");
              return [
                { id: "JOB1", documentKeys: ["review/original/D1/申込書.pdf"] },
              ];
            }),
            findReferencedChecklistKeys: vi.fn().mockResolvedValue(new Set()),
            findReferencedReviewKeys: vi.fn().mockResolvedValue(new Set()),
          } as never,
          listKeys: vi.fn().mockResolvedValue([]),
          deleteObject,
        },
      },
    });
    expect(order).toEqual([
      "jobs looked up",
      "rows",
      "checklist/original/CD1/規程.pdf",
      "review/original/D1/申込書.pdf",
    ]);
  });
});
