import { describe, it, expect, vi } from "vitest";

vi.mock("../../api/features/review/domain/repository", () => ({}));
vi.mock(
  "../../api/features/review/domain/review-result-repository",
  () => ({})
);

import { normalizeVerdict } from "./post-review-item";

describe("normalizeVerdict", () => {
  it("keeps pass and fail, whatever the case", () => {
    expect(normalizeVerdict("pass")).toBe("pass");
    expect(normalizeVerdict(" PASS ")).toBe("pass");
    expect(normalizeVerdict("Fail")).toBe("fail");
  });

  it("treats anything else as fail", () => {
    // 以前はそのまま保存され、画面にも集計にも合否が出なかった
    for (const raw of ["合格", "n/a", "", undefined, null, true]) {
      expect(normalizeVerdict(raw)).toBe("fail");
    }
  });
});
