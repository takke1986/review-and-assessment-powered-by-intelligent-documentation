/**
 * 兼務のある人から見た、部署管理のふるまい。
 *
 * 部署の読み取り（departments.ts）と見える範囲の判定（review-job-visibility.ts）は
 * それぞれ単体で試してある。ここで確かめるのは**配線**、つまり利用者が API を
 * 叩いたときに、その判断が本当に呼ばれているかどうか。
 *
 * 配線の間違いは「見えるはずのものが見えない」「見えてはいけないものが見える」
 * という形で出る。前者は気づかれにくく、後者は気づいたときには手遅れなので、
 * 単体で正しいだけでは足りない。
 *
 * 兼務を主役にしているのは、そこだけ判断が分かれるため。所属が1つなら
 * 「自分の部署」で済むが、営業と法務を兼ねる人の審査を法務の同僚に見せて
 * よいとは限らない。
 *
 * 所属は Cognito のカスタム属性 `custom:departments` に入る。グループは
 * 役割の管理に使うので、部署には使わない
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createReviewJobHandler } from "../routes/handlers";
import {
  computeGlobalConcurrency,
  createReviewJob,
  getAllReviewJobs,
  getReviewCostSummary,
} from "../usecase/review-job";
import { makePrismaReviewJobRepository } from "../domain/repository";
import type { RequestUser } from "../../../core/middleware/authorization";

vi.mock("../usecase/review-job", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../usecase/review-job")>();
  return {
    ...actual,
    computeGlobalConcurrency: vi.fn(),
    createReviewJob: vi.fn(),
  };
});

/** 営業と法務を兼ねる人 */
const bothDepartments = {
  userId: "u-both",
  isAdmin: false,
  rawClaims: { "custom:departments": "sales,legal" },
} as unknown as RequestUser;

/** 営業だけの人 */
const salesOnly = {
  userId: "u-sales",
  isAdmin: false,
  rawClaims: { "custom:departments": "sales" },
} as unknown as RequestUser;

/** どこにも属していない人 */
const noDepartment = {
  userId: "u-none",
  isAdmin: false,
} as unknown as RequestUser;

const admin = {
  userId: "u-admin",
  isAdmin: true,
} as unknown as RequestUser;

describe("審査を作るとき", () => {
  const create = async (user: RequestUser, body: Record<string, unknown>) => {
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };
    await createReviewJobHandler({ body, user } as never, reply as never);
    return vi.mocked(createReviewJob).mock.calls.at(-1)?.[0].requestBody;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(computeGlobalConcurrency).mockResolvedValue({
      isLimit: false,
    } as never);
    vi.mocked(createReviewJob).mockResolvedValue(undefined);
  });

  it("兼務の人が部署を選ばなければ、作らせずに止める", async () => {
    // 勝手に片方へ寄せると見せたくない相手に見え、部署なしで作ると同僚の
    // 履歴に出てこない。どちらも黙って起きるので、ここで止める
    await expect(
      create(bothDepartments, { name: "契約書の審査" })
    ).rejects.toThrow(/more than one department/);
    expect(createReviewJob).not.toHaveBeenCalled();
  });

  it("兼務の人が選んだ部署で記録する", async () => {
    expect(
      (await create(bothDepartments, { name: "審査", departmentId: "legal" }))
        ?.departmentId
    ).toBe("legal");
  });

  it("兼務でも、属していない部署を送られたら止める", async () => {
    // 画面では選べないが、API を直に叩けば送れてしまう
    await expect(
      create(bothDepartments, { name: "審査", departmentId: "finance" })
    ).rejects.toThrow(/do not belong/);
    expect(createReviewJob).not.toHaveBeenCalled();
  });

  it("所属が1つなら、選ばなくてもその部署になる", async () => {
    expect((await create(salesOnly, { name: "審査" }))?.departmentId).toBe(
      "sales"
    );
  });

  it("どこにも属していなければ、部署なしで作れる", async () => {
    // 部署を使わない運用でも止まらないようにしてある
    expect(
      (await create(noDepartment, { name: "審査" }))?.departmentId
    ).toBeUndefined();
  });
});

describe("一覧を出すとき", () => {
  /** findMany に渡った where を覗くための、最小限の偽クライアント */
  const listAs = async (user: RequestUser) => {
    const seen: { where?: Record<string, unknown> } = {};
    const client = {
      reviewJob: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          seen.where = where;
          return [];
        }),
        count: vi.fn(async () => 0),
      },
      // 一覧は、項目を選んで作ったジョブを見分けるためにチェックリストも読む。
      // ここでは見える範囲の条件だけが知りたいので、空で返す
      checkList: { findMany: vi.fn(async () => []) },
    };
    const repo = await makePrismaReviewJobRepository(client as never);
    await getAllReviewJobs({ user, deps: { repo } } as never);
    const where = seen.where ?? {};
    // 見える範囲の条件は、検索の OR と混ざらないよう AND に入れてある
    return (where.AND as Array<Record<string, unknown>> | undefined)?.[0];
  };

  it("兼務の人の一覧には、どちらの部署の審査も入る", async () => {
    expect(await listAs(bothDepartments)).toEqual({
      OR: [{ userId: "u-both" }, { departmentId: { in: ["sales", "legal"] } }],
    });
  });

  it("所属が1つなら、その部署だけが入る", async () => {
    expect(await listAs(salesOnly)).toEqual({
      OR: [{ userId: "u-sales" }, { departmentId: { in: ["sales"] } }],
    });
  });

  it("どこにも属していない人には、自分の審査だけ", async () => {
    // 空の in を足すと、読む人が「部署なしの審査が見える」と誤解する。
    // 条件そのものを足さない
    expect(await listAs(noDepartment)).toEqual({ OR: [{ userId: "u-none" }] });
  });

  it("管理者の一覧は絞らない", async () => {
    expect(await listAs(admin)).toBeUndefined();
  });
});

describe("費用のページ", () => {
  const summarizeAs = async (user: RequestUser) => {
    const summarizeReviewCost = vi.fn(async () => ({}) as never);
    await getReviewCostSummary({
      user,
      deps: { repo: { summarizeReviewCost } as never },
    });
    return vi.mocked(summarizeReviewCost).mock.calls.at(-1)?.[0] as {
      ownerUserId?: string;
    };
  };

  it("一般の利用者は自分の審査ぶんだけ。兼務でも部署ぶんは足されない", async () => {
    // 一覧とは見え方が違う。一覧には同じ部署の同僚の審査も出るが、費用には
    // 出ない。いまのふるまいをここに留めておく
    expect((await summarizeAs(bothDepartments)).ownerUserId).toBe("u-both");
  });

  it("管理者は全体を見る", async () => {
    expect((await summarizeAs(admin)).ownerUserId).toBeUndefined();
  });
});
