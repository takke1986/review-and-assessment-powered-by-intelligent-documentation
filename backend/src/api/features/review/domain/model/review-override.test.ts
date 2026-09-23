import { describe, it, expect } from "vitest";
import {
  OVERRIDE_REASON,
  REVIEW_RESULT,
  ReviewResultDomain,
  type ReviewResultDetail,
} from "./review";

const current = (
  overrides: Partial<ReviewResultDetail> = {}
): ReviewResultDetail =>
  ({
    id: "r-1",
    reviewJobId: "job-1",
    checkId: "check-1",
    status: "completed",
    result: REVIEW_RESULT.FAIL,
    userOverride: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    checkList: { id: "check-1", setId: "set-1", name: "項目" },
    hasChildren: false,
    ...overrides,
  }) as ReviewResultDetail;

describe("fromOverrideRequest", () => {
  it("keeps the verdict the AI gave, so the direction stays readable", () => {
    const updated = ReviewResultDomain.fromOverrideRequest({
      current: current({
        result: REVIEW_RESULT.FAIL,
        aiResult: REVIEW_RESULT.FAIL,
      }),
      result: REVIEW_RESULT.PASS,
      userComment: "角印でも可",
      overrideReason: OVERRIDE_REASON.CRITERIA_INTERPRETATION,
    });

    expect(updated.result).toBe(REVIEW_RESULT.PASS);
    expect(updated.aiResult).toBe(REVIEW_RESULT.FAIL);
    expect(updated.userOverride).toBe(true);
    expect(updated.overrideReason).toBe(
      OVERRIDE_REASON.CRITERIA_INTERPRETATION
    );
  });

  it("recovers the AI verdict for a result judged before this was recorded", () => {
    // aiResult がまだ入っていない古い結果。まだ誰も覆していないなら、
    // いまの result が AI の判定そのもの
    const updated = ReviewResultDomain.fromOverrideRequest({
      current: current({ result: REVIEW_RESULT.PASS, aiResult: undefined }),
      result: REVIEW_RESULT.FAIL,
      userComment: "見落としている",
    });

    expect(updated.aiResult).toBe(REVIEW_RESULT.PASS);
  });

  it("does not mistake an earlier human verdict for the AI's", () => {
    // すでに人が覆したあとの結果。いまの result は人の判断なので、
    // これを AI の判定として記録してはいけない
    const updated = ReviewResultDomain.fromOverrideRequest({
      current: current({
        result: REVIEW_RESULT.PASS,
        userOverride: true,
        aiResult: undefined,
      }),
      result: REVIEW_RESULT.FAIL,
      userComment: "やはり不合格",
    });

    expect(updated.aiResult).toBeUndefined();
  });

  it("keeps the first AI verdict when a result is overridden twice", () => {
    const first = ReviewResultDomain.fromOverrideRequest({
      current: current({
        result: REVIEW_RESULT.FAIL,
        aiResult: REVIEW_RESULT.FAIL,
      }),
      result: REVIEW_RESULT.PASS,
      userComment: "一度目",
    });

    const second = ReviewResultDomain.fromOverrideRequest({
      current: first,
      result: REVIEW_RESULT.FAIL,
      userComment: "戻す",
    });

    expect(second.aiResult).toBe(REVIEW_RESULT.FAIL);
  });
});

describe("覆した人の記録", () => {
  it("覆した人と日時を残す", () => {
    const before = Date.now();
    const updated = ReviewResultDomain.fromOverrideRequest({
      current: current({ aiResult: REVIEW_RESULT.FAIL }),
      result: REVIEW_RESULT.PASS,
      userComment: "角印でも可",
      overriddenBy: "reviewer@example.com",
    });

    expect(updated.overriddenBy).toBe("reviewer@example.com");
    expect(updated.overriddenAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("誰か分からないときは残さない。嘘の名前を書くより空の方がよい", () => {
    const updated = ReviewResultDomain.fromOverrideRequest({
      current: current(),
      result: REVIEW_RESULT.PASS,
      userComment: "",
    });

    expect(updated.overriddenBy).toBeUndefined();
  });

  it("覆し直すと、記録は新しい人に変わる", () => {
    const first = ReviewResultDomain.fromOverrideRequest({
      current: current({ aiResult: REVIEW_RESULT.FAIL }),
      result: REVIEW_RESULT.PASS,
      userComment: "一度目",
      overriddenBy: "a@example.com",
    });
    const second = ReviewResultDomain.fromOverrideRequest({
      current: first,
      result: REVIEW_RESULT.FAIL,
      userComment: "戻す",
      overriddenBy: "b@example.com",
    });

    expect(second.overriddenBy).toBe("b@example.com");
    // AI の判定は最初のまま
    expect(second.aiResult).toBe(REVIEW_RESULT.FAIL);
  });
});
