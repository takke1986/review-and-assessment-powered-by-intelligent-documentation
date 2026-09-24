/**
 * プレビューは送られてきた command を実行する。管理者以外が呼べないこと
 */
import { describe, it, expect, vi } from "vitest";

const { previewMcpTools } = vi.hoisted(() => ({ previewMcpTools: vi.fn() }));
vi.mock("../domain/service/mcp-tools-service", () => ({ previewMcpTools }));

import { previewMcpToolsHandler } from "./handlers";

const reply = () => {
  const r: any = { code: vi.fn(() => r), send: vi.fn(() => r) };
  return r;
};
const request = (isAdmin: boolean) =>
  ({
    user: { userId: "u-1", isAdmin },
    body: { mcpConfig: { s: { command: "sh", args: ["-c", "id"] } } },
  }) as any;

describe("previewMcpToolsHandler", () => {
  it("refuses a regular user without running anything", async () => {
    await expect(
      previewMcpToolsHandler(request(false), reply())
    ).rejects.toThrow();
    expect(previewMcpTools).not.toHaveBeenCalled();
  });

  it("lets an administrator preview", async () => {
    previewMcpTools.mockResolvedValue([]);
    const r = reply();
    await previewMcpToolsHandler(request(true), r);
    expect(previewMcpTools).toHaveBeenCalledTimes(1);
    expect(r.code).toHaveBeenCalledWith(200);
  });
});
