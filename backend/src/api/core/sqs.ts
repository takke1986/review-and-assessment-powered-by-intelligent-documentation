import {
  SQSClient,
  SendMessageCommand,
  GetQueueAttributesCommand,
} from "@aws-sdk/client-sqs";
import { ApplicationError } from "./errors";

// Singleton SQS client instance
let sqsClient: SQSClient | null = null;

/**
 * Get SQS client instance
 * @returns SQS client instance
 */
export function getSqsClient(): SQSClient {
  if (!sqsClient) {
    sqsClient = new SQSClient({
      region: process.env.AWS_REGION || "ap-northeast-1",
    });
  }
  return sqsClient;
}

/**
 * Send message to SQS queue
 * @param queueUrl Queue URL to send message to
 * @param messageBody Message body as object
 * @param messageGroupId FIFO の順序を保つ単位
 * @param deduplicationId 同じ内容をもう一度送るときに渡す。
 *
 * このキューは内容から重複を判定する設定（contentBasedDeduplication）
 * なので、同じジョブをもう一度流すと本文が一致し、5分以内なら黙って
 * 捨てられる。捨てられたことは誰にも分からず、ジョブは待ちのまま残る。
 * 続きから流すときのように、同じ本文を意図して送る場面では、毎回違う
 * 識別子を渡して重複と見なされないようにする
 */
export async function sendMessage(
  queueUrl: string,
  messageBody: Record<string, any>,
  messageGroupId?: string,
  deduplicationId?: string
): Promise<void> {
  const client = getSqsClient();
  const command = new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(messageBody),
    ...(messageGroupId ? { MessageGroupId: messageGroupId } : {}),
    ...(deduplicationId ? { MessageDeduplicationId: deduplicationId } : {}),
  });

  const response = await client.send(command);

  if (response.$metadata.httpStatusCode !== 200) {
    throw new ApplicationError(`Failed to send SQS message: ${response}`);
  }
}

/**
 * Get approximate queue depth for SQS queue
 * @param queueUrl URL of SQS queue
 * @returns Object with visible, notVisible, and total message counts
 */
export async function getQueueDepth(
  queueUrl: string
): Promise<{ visible: number; notVisible: number; total: number }> {
  const client = getSqsClient();
  const command = new GetQueueAttributesCommand({
    QueueUrl: queueUrl,
    AttributeNames: [
      "ApproximateNumberOfMessages",
      "ApproximateNumberOfMessagesNotVisible",
    ],
  });

  try {
    const response = await client.send(command);

    const visible = Number(
      response.Attributes?.ApproximateNumberOfMessages ?? 0
    );
    const notVisible = Number(
      response.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0
    );
    const total = visible + notVisible;

    return { visible, notVisible, total };
  } catch (error) {
    // Wrap or rethrow as ApplicationError for consistency
    throw new ApplicationError(
      `Failed to get SQS queue attributes for ${queueUrl}: ${String(error)}`
    );
  }
}
