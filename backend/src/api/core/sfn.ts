/**
 * Step Functions関連のユーティリティ
 */
import {
  SFNClient,
  StartExecutionCommand,
  StopExecutionCommand,
} from "@aws-sdk/client-sfn";
import { ApplicationError } from "./errors";

// SFNクライアントのシングルトンインスタンス
let sfnClient: SFNClient | null = null;

/**
 * SFNクライアントを取得する
 * @returns SFNクライアントインスタンス
 */
export function getSfnClient(): SFNClient {
  if (!sfnClient) {
    sfnClient = new SFNClient({
      region: process.env.AWS_REGION || "ap-northeast-1",
    });
  }
  return sfnClient;
}

/**
 * ステートマシンの実行を開始する
 * @param stateMachineArn ステートマシンのARN
 * @param input 入力データ
 * @returns 実行ARN
 */
export async function startStateMachineExecution(
  stateMachineArn: string,
  input: Record<string, any>
): Promise<string> {
  const client = getSfnClient();
  const command = new StartExecutionCommand({
    stateMachineArn,
    input: JSON.stringify(input),
  });

  const response = await client.send(command);

  if (response.$metadata.httpStatusCode !== 200) {
    throw new ApplicationError(
      `Failed to start state machine execution: ${response}`
    );
  }

  return response.executionArn || "";
}

/**
 * 走っている実行を止める。
 *
 * すでに終わっていたり、識別子が古かったりすると AWS は例外を返すが、
 * 利用者から見れば「もう止まっている」ので、そこは成功として扱う
 */
export async function stopStateMachineExecution(
  executionArn: string,
  cause: string
): Promise<void> {
  try {
    await getSfnClient().send(
      new StopExecutionCommand({ executionArn, cause })
    );
  } catch (error) {
    console.info(
      `Could not stop the execution; treating it as already stopped: ${executionArn}`,
      error
    );
  }
}
