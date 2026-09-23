import { describe, it, expect, vi } from "vitest";
import { createInitialReviewJobModel } from "./review-job-factory";
import { createRerunResults, failedLeafCheckIds } from "./review-rerun";
import { ValidationError } from "../../../../core/errors";
import type { CheckRepository } from "../../../checklist/domain/repository";
import {
  OVERRIDE_REASON,
  REVIEW_FILE_TYPE,
  REVIEW_RESULT,
  REVIEW_RESULT_STATUS,
  ReviewResultDetail,
  ReviewResultDomain,
  ReviewResultEntity,
} from "../model/review";

// A ─┬─ A1
//    └─ A2
// B ─── B1 ─── B1a
// C
const items = [
  { id: "A" },
  { id: "A1", parentId: "A" },
  { id: "A2", parentId: "A" },
  { id: "B" },
  { id: "B1", parentId: "B" },
  { id: "B1a", parentId: "B1" },
  { id: "C" },
];
const parentOf = new Map(items.map((i) => [i.id, i.parentId]));

const previous = (
  checkId: string,
  result: REVIEW_RESULT | undefined,
  extra: Partial<ReviewResultDetail> = {}
): ReviewResultDetail => ({
  id: `prev-${checkId}`,
  reviewJobId: "source-job",
  checkId,
  status: REVIEW_RESULT_STATUS.COMPLETED,
  result,
  confidenceScore: 0.9,
  explanation: `explanation of ${checkId}`,
  shortExplanation: `short ${checkId}`,
  sourceReferences: [{ documentId: "old-doc", pageNumber: 1 }],
  userOverride: false,
  inputTokens: 3,
  outputTokens: 400,
  totalCost: 0.006,
  createdAt: new Date(),
  updatedAt: new Date(),
  checkList: {
    id: checkId,
    setId: "set-1",
    name: checkId,
    parentId: parentOf.get(checkId),
  },
  hasChildren: false,
  ...extra,
});

const sourceResults = [
  previous("A", REVIEW_RESULT.FAIL),
  previous("A1", REVIEW_RESULT.PASS),
  previous("A2", REVIEW_RESULT.FAIL),
  previous("B", REVIEW_RESULT.FAIL),
  previous("B1", REVIEW_RESULT.FAIL),
  previous("B1a", REVIEW_RESULT.FAIL),
  // A person overrode C to pass.
  previous("C", REVIEW_RESULT.PASS, {
    userOverride: true,
    userComment: "checked by hand",
  }),
];

const byCheckId = (results: ReviewResultEntity[]) =>
  new Map(results.map((r) => [r.checkId, r]));

const pendingIds = (results: ReviewResultEntity[]) =>
  results
    .filter((r) => r.status === REVIEW_RESULT_STATUS.PENDING)
    .map((r) => r.checkId)
    .sort();

describe("failedLeafCheckIds", () => {
  it("returns failed and unfinished leaves, using overridden results", () => {
    expect(
      failedLeafCheckIds([
        ...sourceResults.filter((r) => r.checkId !== "A1"),
        previous("A1", undefined, { status: REVIEW_RESULT_STATUS.FAILED }),
      ]).sort()
    ).toEqual(["A1", "A2", "B1a"]);
  });
});

describe("createRerunResults", () => {
  it("reviews the failed leaves and their ancestors again by default", () => {
    const results = createRerunResults("new-job", items, sourceResults);

    expect(results).toHaveLength(items.length);
    expect(pendingIds(results)).toEqual(["A", "A2", "B", "B1", "B1a"]);
  });

  it("carries over completed results without their cost", () => {
    const results = byCheckId(
      createRerunResults("new-job", items, sourceResults)
    );

    const a1 = results.get("A1")!;
    expect(a1).toMatchObject({
      reviewJobId: "new-job",
      status: REVIEW_RESULT_STATUS.COMPLETED,
      result: REVIEW_RESULT.PASS,
      explanation: "explanation of A1",
      sourceReferences: [{ documentId: "old-doc", pageNumber: 1 }],
      previousResultId: "prev-A1",
      carriedOver: true,
    });
    expect(a1.id).not.toBe("prev-A1");
    expect(a1.totalCost).toBeUndefined();
    expect(a1.inputTokens).toBeUndefined();
    expect(a1.outputTokens).toBeUndefined();

    expect(results.get("C")).toMatchObject({
      result: REVIEW_RESULT.PASS,
      userOverride: true,
      userComment: "checked by hand",
      carriedOver: true,
    });
  });

  it("links the results it reviews again to the previous ones", () => {
    const results = byCheckId(
      createRerunResults("new-job", items, sourceResults)
    );

    expect(results.get("A2")).toMatchObject({
      status: REVIEW_RESULT_STATUS.PENDING,
      previousResultId: "prev-A2",
    });
    expect(results.get("A2")!.carriedOver).toBeFalsy();
    expect(results.get("A2")!.result).toBeUndefined();
  });

  it("reviews only the items given in checkIds and carries over the rest", () => {
    const results = byCheckId(
      createRerunResults("new-job", items, sourceResults, ["C"])
    );

    expect(pendingIds(Array.from(results.values()))).toEqual(["C"]);
    expect(results.get("A2")).toMatchObject({
      result: REVIEW_RESULT.FAIL,
      carriedOver: true,
    });
  });

  it("reviews an item again when the source did not finish it", () => {
    const unfinished = sourceResults.map((r) =>
      r.checkId === "A2"
        ? previous("A2", undefined, { status: REVIEW_RESULT_STATUS.FAILED })
        : r
    );

    const results = byCheckId(
      createRerunResults("new-job", items, unfinished, ["C"])
    );

    expect(results.get("A2")).toMatchObject({
      status: REVIEW_RESULT_STATUS.PENDING,
      previousResultId: "prev-A2",
    });
  });

  it("keeps a partial source job partial", () => {
    const partial = [
      previous("A", REVIEW_RESULT.PASS),
      previous("A1", REVIEW_RESULT.PASS),
    ];

    const results = createRerunResults("new-job", items, partial, ["C"]);

    expect(results.map((r) => r.checkId).sort()).toEqual(["A", "A1", "C"]);
    expect(byCheckId(results).get("C")!.previousResultId).toBeUndefined();
  });

  it("refuses a rerun when nothing failed and no items are given", () => {
    const allPassed = sourceResults.map((r) =>
      previous(r.checkId, REVIEW_RESULT.PASS)
    );

    expect(() => createRerunResults("new-job", items, allPassed)).toThrow(
      ValidationError
    );
  });
});

describe("createInitialReviewJobModel with a source job", () => {
  it("records the source job on the new job", async () => {
    const checkRepo = {
      findCheckListItems: vi.fn().mockResolvedValue(
        items.map((i) => ({
          ...i,
          setId: "set-1",
          name: i.id,
          hasChildren: false,
        }))
      ),
    } as unknown as CheckRepository;

    const job = await createInitialReviewJobModel({
      req: {
        name: "revised",
        checkListSetId: "set-1",
        documents: [
          {
            id: "doc-2",
            filename: "spec-v2.pdf",
            s3Key: "review/original/doc-2/spec-v2.pdf",
            fileType: REVIEW_FILE_TYPE.PDF,
          },
        ],
        userId: "user-1",
        sourceReviewJobId: "source-job",
      },
      deps: { checkRepo },
      source: { reviewJobId: "source-job", results: sourceResults },
    });

    expect(job.sourceReviewJobId).toBe("source-job");
    expect(job.results.every((r) => r.reviewJobId === job.id)).toBe(true);
    expect(pendingIds(job.results)).toEqual(["A", "A2", "B", "B1", "B1a"]);
  });
});

describe("再審査での、覆された記録の扱い", () => {
  const overridden = previous("C", REVIEW_RESULT.PASS, {
    userOverride: true,
    userComment: "角印でも可",
    aiResult: REVIEW_RESULT.FAIL,
    overrideReason: OVERRIDE_REASON.CRITERIA_INTERPRETATION,
    overriddenBy: "reviewer@example.com",
    overriddenAt: new Date("2026-09-20T00:00:00Z"),
  });

  it("引き継ぐ結果は、AI の判定と覆した理由も持っていく", () => {
    // C は審査し直さない（A1 だけを選ぶ）ので引き継がれる
    const results = createRerunResults(
      "new-job",
      items,
      [...sourceResults.filter((r) => r.checkId !== "C"), overridden],
      ["A1"]
    );

    const carried = results.find((r) => r.checkId === "C")!;
    expect(carried.carriedOver).toBe(true);
    expect(carried.aiResult).toBe(REVIEW_RESULT.FAIL);
    expect(carried.overrideReason).toBe(
      OVERRIDE_REASON.CRITERIA_INTERPRETATION
    );
    // 人が覆したという事実そのものも残る
    expect(carried.userOverride).toBe(true);
    // 誰がいつ決めたかも引き継ぐ。引き継ぎは同じ判定の写しなので
    expect(carried.overriddenBy).toBe("reviewer@example.com");
    expect(carried.overriddenAt).toEqual(new Date("2026-09-20T00:00:00Z"));
  });

  it("引き継いだ結果をもう一度覆しても、AI の判定は最初のまま", () => {
    const results = createRerunResults(
      "new-job",
      items,
      [...sourceResults.filter((r) => r.checkId !== "C"), overridden],
      ["A1"]
    );
    const carried = results.find((r) => r.checkId === "C")!;

    const again = ReviewResultDomain.fromOverrideRequest({
      current: {
        ...carried,
        checkList: overridden.checkList,
        hasChildren: false,
      },
      result: REVIEW_RESULT.FAIL,
      userComment: "やはり不合格",
    });

    // ここが引き継がれていないと、いまの判定（人のもの）を AI の判定として
    // 拾ってしまい、向きが逆に記録される
    expect(again.aiResult).toBe(REVIEW_RESULT.FAIL);
  });

  it("審査し直す項目では、前回の理由を持ち越さない", () => {
    const results = createRerunResults(
      "new-job",
      items,
      [...sourceResults.filter((r) => r.checkId !== "C"), overridden],
      ["C"]
    );

    const rejudged = results.find((r) => r.checkId === "C")!;
    expect(rejudged.carriedOver).toBeFalsy();
    expect(rejudged.overrideReason).toBeUndefined();
    expect(rejudged.aiResult).toBeUndefined();
    expect(rejudged.userOverride).toBe(false);
    // 審査し直したのだから、前に誰が覆したかは持ち越さない
    expect(rejudged.overriddenBy).toBeUndefined();
    expect(rejudged.overriddenAt).toBeUndefined();
  });
});
