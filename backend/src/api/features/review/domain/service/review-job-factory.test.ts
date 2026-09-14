import { describe, it, expect, vi } from "vitest";
import { createInitialReviewJobModel } from "./review-job-factory";
import { selectCheckItems } from "./check-item-selection";
import { ValidationError } from "../../../../core/errors";
import type { CheckRepository } from "../../../checklist/domain/repository";
import type { CheckListItemDetail } from "../../../checklist/domain/model/checklist";
import { REVIEW_FILE_TYPE, REVIEW_RESULT_STATUS } from "../model/review";

// A ─┬─ A1
//    └─ A2
// B ─── B1 ─── B1a
// C
const item = (id: string, parentId?: string): CheckListItemDetail => ({
  id,
  parentId,
  setId: "set-1",
  name: id,
  hasChildren: false,
});

const items = [
  item("A"),
  item("A1", "A"),
  item("A2", "A"),
  item("B"),
  item("B1", "B"),
  item("B1a", "B1"),
  item("C"),
];

const ids = (selected: CheckListItemDetail[]) =>
  selected.map((i) => i.id).sort();

describe("selectCheckItems", () => {
  it("returns every item when checkIds is omitted", () => {
    expect(ids(selectCheckItems(items, undefined))).toEqual(ids(items));
  });

  it("adds the ancestors of a selected item", () => {
    expect(ids(selectCheckItems(items, ["A1"]))).toEqual(["A", "A1"]);
  });

  it("adds every descendant of a selected parent", () => {
    expect(ids(selectCheckItems(items, ["B"]))).toEqual(["B", "B1", "B1a"]);
  });

  it("adds ancestors across several levels and keeps unrelated items out", () => {
    expect(ids(selectCheckItems(items, ["B1a", "C"]))).toEqual([
      "B",
      "B1",
      "B1a",
      "C",
    ]);
  });

  it("rejects an id that is not in the checklist set", () => {
    expect(() => selectCheckItems(items, ["A1", "other-set-item"])).toThrow(
      ValidationError
    );
  });

  it("rejects an empty selection rather than reviewing everything", () => {
    expect(() => selectCheckItems(items, [])).toThrow(ValidationError);
  });
});

describe("createInitialReviewJobModel", () => {
  const checkRepo = {
    findCheckListItems: vi.fn().mockResolvedValue(items),
  } as unknown as CheckRepository;

  const req = {
    name: "revised",
    checkListSetId: "set-1",
    documents: [
      {
        id: "doc-1",
        filename: "spec.pdf",
        s3Key: "review/original/doc-1/spec.pdf",
        fileType: REVIEW_FILE_TYPE.PDF,
      },
    ],
    userId: "user-1",
  };

  it("creates a pending result only for the selected items", async () => {
    const job = await createInitialReviewJobModel({
      req: { ...req, checkIds: ["A2"] },
      deps: { checkRepo },
    });

    expect(job.results.map((r) => r.checkId).sort()).toEqual(["A", "A2"]);
    expect(
      job.results.every(
        (r) =>
          r.reviewJobId === job.id && r.status === REVIEW_RESULT_STATUS.PENDING
      )
    ).toBe(true);
  });

  it("creates a result for every item when checkIds is omitted", async () => {
    const job = await createInitialReviewJobModel({
      req,
      deps: { checkRepo },
    });

    expect(job.results).toHaveLength(items.length);
  });
});
