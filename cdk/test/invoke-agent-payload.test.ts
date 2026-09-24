import { toAgentPayload } from "../lib/constructs/lambda/invoke-agent/index";
import { StepFunctionsInput } from "../lib/constructs/lambda/invoke-agent/types";

const event = (
  payload: Partial<StepFunctionsInput["preItemResult"]["Payload"]>,
) =>
  ({
    reviewJobId: "job-1",
    checkId: "check-1",
    reviewResultId: "result-1",
    preItemResult: {
      Payload: {
        checkName: "name",
        checkDescription: "desc",
        feedbackSummary: null,
        reviewGuidance: null,
        languageName: "Japanese",
        documentPaths: ["s3://b/k"],
        documentIds: ["d-1"],
        mcpServers: [],
        toolConfiguration: null,
        modelId: null,
        ...payload,
      },
    },
  }) as StepFunctionsInput;

describe("toAgentPayload", () => {
  test("着眼点をエージェントに渡す", () => {
    const out = toAgentPayload(event({ reviewGuidance: "第3条を見る" }));
    expect(out.reviewGuidance).toBe("第3条を見る");
  });

  test("着眼点が無ければ null を渡す", () => {
    expect(
      toAgentPayload(event({ reviewGuidance: null })).reviewGuidance,
    ).toBeNull();
    // 着眼点を入れる前の前処理が作った入力にはキーが無い
    const legacy = event({});
    delete (
      legacy.preItemResult.Payload as Partial<
        typeof legacy.preItemResult.Payload
      >
    ).reviewGuidance;
    expect(toAgentPayload(legacy).reviewGuidance).toBeNull();
  });

  test("過去の指摘の要約も渡す", () => {
    const out = toAgentPayload(event({ feedbackSummary: "summary" }));
    expect(out.feedbackSummary).toBe("summary");
  });
});
