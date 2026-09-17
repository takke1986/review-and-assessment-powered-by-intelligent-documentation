import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { NagSuppressions } from "cdk-nag/lib/nag-suppressions";
import { Construct } from "constructs";
import * as path from "path";

export interface ReviewQueueProcessorProps {
  /**
   * Environment variables for the review queue consumer Lambda.
   */
  environment?: { [key: string]: string };

  /**
   * Lambda log retention days (see parameter-schema.ts).
   */
  lambdaLogRetentionDays?: number;

  /**
   * メッセージがデッドレターキューへ移るまでの受信回数。
   * @default 20
   */
  maxReceiveCount?: number;

  /**
   * デッドレターキューに落ちたジョブを失敗として記録する Lambda の名前。
   * 渡すと、デッドレターキューを読む Lambda を作る。
   */
  errorLambdaName?: string;
}

export class ReviewQueueProcessor extends Construct {
  public readonly lambdaFunction: lambda.Function;
  public readonly queue: sqs.Queue;
  /** デッドレターキューを読む Lambda（errorLambdaName を渡したときだけ作る） */
  public deadLetterFunction?: lambda.Function;

  constructor(
    scope: Construct,
    id: string,
    props: ReviewQueueProcessorProps = {},
  ) {
    super(scope, id);

    const dlq = new sqs.Queue(this, "ReviewDLQ", {
      queueName: `${cdk.Stack.of(this).stackName}-ReviewDLQ.fifo`,
      fifo: true,
      enforceSSL: true,
      retentionPeriod: cdk.Duration.days(14),
    });

    this.queue = new sqs.Queue(this, "MainQueue", {
      queueName: `${cdk.Stack.of(this).stackName}-ReviewQueue.fifo`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      fifo: true,
      visibilityTimeout: cdk.Duration.minutes(18),
      retentionPeriod: cdk.Duration.days(4),
      deliveryDelay: cdk.Duration.seconds(0),
      contentBasedDeduplication: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: props.maxReceiveCount ?? 20,
      },
    });

    this.lambdaFunction = new lambda.Function(this, "PythonFunction", {
      runtime: lambda.Runtime.PYTHON_3_14,
      handler: "handler.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "consumer")),
      timeout: cdk.Duration.minutes(6),
      memorySize: 512,
      environment: {
        REVIEW_QUEUE_URL: this.queue.queueUrl,
        ...props.environment,
      },
      logGroup: new cdk.aws_logs.LogGroup(this, "pythonFunctionLog", {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        retention: cdk.aws_logs.RetentionDays.THREE_YEARS,
      }),
    });

    const eventSource = new lambdaEventSources.SqsEventSource(this.queue, {
      batchSize: 1,
      reportBatchItemFailures: true,
    });

    this.lambdaFunction.addEventSource(eventSource);

    this.lambdaFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["lambda:InvokeFunction"],
        resources: ["*"],
      }),
    );

    this.lambdaFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["states:ListExecutions", "states:StartExecution"],
        resources: ["*"],
      }),
    );

    this.queue.grantConsumeMessages(this.lambdaFunction);
    this.queue.grantSendMessages(this.lambdaFunction);

    // デッドレターキューに落ちたメッセージは誰も見ないままになり、ジョブが「待機中」に
    // 見え続ける。読み取って、審査ジョブを失敗として記録する。
    if (props.errorLambdaName) {
      this.deadLetterFunction = new lambda.Function(
        this,
        "DeadLetterFunction",
        {
          runtime: lambda.Runtime.PYTHON_3_14,
          handler: "handler.lambda_handler",
          code: lambda.Code.fromAsset(path.join(__dirname, "dead-letter")),
          timeout: cdk.Duration.minutes(1),
          memorySize: 256,
          environment: {
            ERROR_LAMBDA_NAME: props.errorLambdaName,
            LOG_LEVEL: props.environment?.LOG_LEVEL ?? "INFO",
          },
          logGroup: new cdk.aws_logs.LogGroup(this, "deadLetterFunctionLog", {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            retention: cdk.aws_logs.RetentionDays.THREE_YEARS,
          }),
        },
      );

      this.deadLetterFunction.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["lambda:InvokeFunction"],
          resources: ["*"],
        }),
      );

      this.deadLetterFunction.addEventSource(
        new lambdaEventSources.SqsEventSource(dlq, { batchSize: 1 }),
      );
      dlq.grantConsumeMessages(this.deadLetterFunction);
    }

    new cdk.CfnOutput(this, "LambdaFunctionName", {
      value: this.lambdaFunction.functionName,
      description: "Review queue consumer Lambda function name",
    });

    new cdk.CfnOutput(this, "QueueUrl", {
      value: this.queue.queueUrl,
      description: "Review queue URL",
    });

    NagSuppressions.addResourceSuppressions(this.queue, [
      {
        id: "AwsSolutions-SQS3",
        reason:
          "FIFO queue with content-based deduplication; retry handling uses batch item failures.",
      },
    ]);
  }
}
