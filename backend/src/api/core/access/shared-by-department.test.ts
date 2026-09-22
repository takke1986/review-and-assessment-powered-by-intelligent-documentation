/**
 * チェックリストとプロンプトが、審査ジョブと同じ規則で共有されているか。
 *
 * 判定そのもの（visibility.ts）は単体で試してある。ここで確かめるのは、
 * 一覧が本当にその判定を通っているかどうか。繋ぎ忘れると「同じ部署なのに
 * 見えない」という形で出て、しかも誰も気づけない。
 */
import { describe, it, expect, vi } from "vitest";
import { getAllChecklistSets } from "../../features/checklist/usecase/checklist-set";
import { makePrismaCheckRepository } from "../../features/checklist/domain/repository";
import { getPromptTemplates } from "../../features/prompt-template/usecase/template";
import { makePrismaPromptTemplateRepository } from "../../features/prompt-template/domain/repository";
import { PromptTemplateType } from "../../features/prompt-template/domain/model/template";
import type { RequestUser } from "../middleware/authorization";

const bothDepartments = {
  userId: "u-both",
  isAdmin: false,
  rawClaims: { "custom:departments": "営業部,法務部" },
} as unknown as RequestUser;

const noDepartment = { userId: "u-none", isAdmin: false } as unknown as RequestUser;

const admin = {
  userId: "u-admin",
  isAdmin: true,
  rawClaims: { "custom:departments": "管理部" },
} as unknown as RequestUser;

/** findMany に渡った where を覗くための、最小限の偽クライアント */
const fakeClient = (model: "checkListSet" | "promptTemplate") => {
  const seen: { where?: Record<string, unknown> } = {};
  return {
    seen,
    client: {
      [model]: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          seen.where = where;
          return [];
        }),
        count: vi.fn(async () => 0),
      },
    },
  };
};

/** where の中から、見える範囲の条件（AND に入れてある）を取り出す */
const visibility = (where: Record<string, unknown> | undefined) =>
  (where?.AND as Array<Record<string, unknown>> | undefined)?.find(
    (c) => "OR" in c
  );

const checklistsAs = async (user: RequestUser) => {
  const { seen, client } = fakeClient("checkListSet");
  const repo = await makePrismaCheckRepository(client as never);
  await getAllChecklistSets({ user, deps: { repo } } as never);
  return visibility(seen.where);
};

const promptsAs = async (user: RequestUser) => {
  const { seen, client } = fakeClient("promptTemplate");
  const repo = await makePrismaPromptTemplateRepository(client as never);
  await getPromptTemplates({
    user,
    type: PromptTemplateType.CHECKLIST,
    deps: { repo },
  } as never);
  return visibility(seen.where);
};

describe.each([
  ["チェックリスト", checklistsAs],
  ["プロンプト", promptsAs],
])("%s の一覧", (_name, listAs) => {
  it("兼務の人には、自分のものと両方の部署のものが見える", async () => {
    expect(await listAs(bothDepartments)).toEqual({
      OR: [
        { userId: "u-both" },
        { departmentId: { in: ["営業部", "法務部"] } },
      ],
    });
  });

  it("部署に属していなければ、自分のものだけ（これまでと同じ）", async () => {
    expect(await listAs(noDepartment)).toEqual({ OR: [{ userId: "u-none" }] });
  });

  it("管理者は、部署があっても絞らない", async () => {
    expect(await listAs(admin)).toBeUndefined();
  });
});
