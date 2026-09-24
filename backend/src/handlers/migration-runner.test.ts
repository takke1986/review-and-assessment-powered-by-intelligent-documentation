import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * マイグレーションの Lambda が、デプロイの成否を正しく伝えるか。
 *
 * デプロイのたびに CloudFormation から呼ばれる。ここで例外を投げないと、
 * マイグレーションが失敗しても DB が古いままデプロイが成功扱いになる
 * （実際に、NAT が止まっている時間に DB の接続情報を取りに行けず、
 * 列が無いまま新しいコードが動いて一覧が 500 になった）。
 */
const exec = vi.fn();
const getDatabaseUrl = vi.fn();
vi.mock("child_process", () => ({ exec: (...args: unknown[]) => exec(...args) }));
vi.mock("../utils/database", () => ({ getDatabaseUrl: () => getDatabaseUrl() }));

const run = async (event: unknown) => {
  const { handler } = await import("./migration-runner");
  return handler(event as never, {} as never, () => undefined);
};

/** prisma migrate の終わり方を決める */
const prismaExits = (code: number) =>
  exec.mockImplementation((_cmd: string, cb: (e: unknown, o: string, s: string) => void) =>
    cb(code === 0 ? null : Object.assign(new Error("failed"), { code }), "", "")
  );

describe("migration-runner", () => {
  beforeEach(() => {
    vi.resetModules();
    exec.mockReset();
    getDatabaseUrl.mockReset().mockResolvedValue("mysql://example");
  });

  it("CloudFormation から作成・更新で呼ばれたら migrate deploy を流す", async () => {
    prismaExits(0);
    const result = await run({
      RequestType: "Update",
      ResourceProperties: { command: "deploy" },
    });
    expect(exec.mock.calls[0][0]).toContain("prisma migrate deploy");
    expect(result).toEqual({ PhysicalResourceId: "prisma-migration" });
  });

  it("マイグレーションが失敗したら例外を投げる（デプロイを止めるため）", async () => {
    prismaExits(1);
    await expect(
      run({ RequestType: "Update", ResourceProperties: { command: "deploy" } })
    ).rejects.toThrow(/failed with exit code 1/);
  });

  it("DB の接続情報を取れなかったら例外を投げる", async () => {
    // NAT が止まっている時間は Secrets Manager に届かない
    getDatabaseUrl.mockRejectedValue(new Error("ETIMEDOUT"));
    await expect(
      run({ RequestType: "Create", ResourceProperties: { command: "deploy" } })
    ).rejects.toThrow(/ETIMEDOUT/);
    expect(exec).not.toHaveBeenCalled();
  });

  it("削除では DB に触らない", async () => {
    const result = await run({
      RequestType: "Delete",
      PhysicalResourceId: "prisma-migration",
    });
    expect(getDatabaseUrl).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
    expect(result).toEqual({ PhysicalResourceId: "prisma-migration" });
  });

  it("手動の呼び出し（{command}）もこれまでどおり受け付ける", async () => {
    prismaExits(0);
    await run({ command: "status" });
    expect(exec.mock.calls[0][0]).toContain("prisma migrate status");
  });
});
