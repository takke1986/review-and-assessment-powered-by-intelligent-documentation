import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { ReviewQueueProcessor } from "../lib/constructs/review-queue";

const makeTemplate = (props: Record<string, unknown> = {}) => {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, "TestStack");
  new ReviewQueueProcessor(stack, "TestQueue", {
    environment: { STATE_MACHINE_ARN: "arn:aws:states:::stateMachine:test" },
    ...props,
  });
  return Template.fromStack(stack);
};

describe("ReviewQueueProcessor", () => {
  test("メッセージは既定で20回まで受け取ってからデッドレターキューへ移る", () => {
    const template = makeTemplate();

    template.hasResourceProperties("AWS::SQS::Queue", {
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 20 }),
    });
  });

  test("受信回数の上限は指定できる", () => {
    const template = makeTemplate({ maxReceiveCount: 7 });

    template.hasResourceProperties("AWS::SQS::Queue", {
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 7 }),
    });
  });

  test("エラー用 Lambda を渡すと、デッドレターキューを読む Lambda ができる", () => {
    const template = makeTemplate({ errorLambdaName: "error-lambda" });

    // 本キューの消費者とデッドレターキューの消費者で2つ
    template.resourceCountIs("AWS::Lambda::Function", 2);
    template.resourceCountIs("AWS::Lambda::EventSourceMapping", 2);
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({ ERROR_LAMBDA_NAME: "error-lambda" }),
      },
    });
  });

  test("エラー用 Lambda を渡さなければ、デッドレターキューの消費者は作らない", () => {
    const template = makeTemplate();

    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.resourceCountIs("AWS::Lambda::EventSourceMapping", 1);
  });
});
