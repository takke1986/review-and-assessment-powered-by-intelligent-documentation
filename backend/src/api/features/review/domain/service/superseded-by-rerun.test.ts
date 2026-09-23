import { describe, it, expect } from "vitest";
import { isSupersededByRerun } from "./superseded-by-rerun";
import { REVIEW_JOB_STATUS } from "../model/review";

describe("isSupersededByRerun", () => {
  it("再審査されていなければ、そのジョブが最新", () => {
    expect(isSupersededByRerun([])).toBe(false);
    expect(isSupersededByRerun(undefined)).toBe(false);
  });

  it("完了した再審査があれば、元のジョブは古い", () => {
    expect(isSupersededByRerun([{ status: REVIEW_JOB_STATUS.COMPLETED }])).toBe(
      true
    );
  });

  it("実行中の再審査でも古い扱いにする（結果を写している最中に変えられると困る）", () => {
    expect(
      isSupersededByRerun([{ status: REVIEW_JOB_STATUS.PROCESSING }])
    ).toBe(true);
    expect(isSupersededByRerun([{ status: REVIEW_JOB_STATUS.PENDING }])).toBe(
      true
    );
  });

  it("失敗した再審査は数えない。元のジョブが唯一の結果なので直せる必要がある", () => {
    expect(isSupersededByRerun([{ status: REVIEW_JOB_STATUS.FAILED }])).toBe(
      false
    );
  });

  it("失敗と完了が混ざっていれば、完了の方を見る", () => {
    expect(
      isSupersededByRerun([
        { status: REVIEW_JOB_STATUS.FAILED },
        { status: REVIEW_JOB_STATUS.COMPLETED },
      ])
    ).toBe(true);
  });
});
