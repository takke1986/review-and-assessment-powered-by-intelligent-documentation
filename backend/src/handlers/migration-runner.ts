import { Handler } from "aws-lambda";
import { exec } from "child_process";
import { getDatabaseUrl } from "../utils/database";

// Define allowed Prisma migration commands
const ALLOWED_COMMANDS = ["deploy", "reset", "status", "up", "down"] as const;
type AllowedCommand = (typeof ALLOWED_COMMANDS)[number];

/**
 * Validates if the provided command is one of the allowed Prisma migration commands
 * @param command The command to validate
 * @returns The validated command or "deploy" as default
 */
const validateCommand = (command: unknown): AllowedCommand => {
  if (typeof command !== "string") return "deploy";

  const sanitizedCommand = command.trim().toLowerCase();
  if (ALLOWED_COMMANDS.includes(sanitizedCommand as AllowedCommand)) {
    return sanitizedCommand as AllowedCommand;
  }

  // If not a valid command, return the default
  return "deploy";
};

/** CloudFormation に返す物理 ID。変えると CloudFormation が置き換え（削除）を送ってくる */
const PHYSICAL_RESOURCE_ID = "prisma-migration";

/**
 * Handler for running Prisma migrations
 *
 * 2通りの呼ばれ方をする。
 *
 * - デプロイのたびに CloudFormation から（カスタムリソースの Provider 経由）。
 *   ここで例外を投げると、デプロイが失敗してロールバックされる。以前は
 *   AwsCustomResource が Lambda の invoke API を呼ぶだけだったので、失敗しても
 *   invoke 自体は成功扱いになり、DB が古いままデプロイが「成功」していた
 * - 手動で `aws lambda invoke --payload '{"command":"deploy"}'`
 */
export const handler: Handler = async (event, _) => {
  // スタックの削除や置き換えでは DB に触らない
  if (event?.RequestType === "Delete") {
    return { PhysicalResourceId: event.PhysicalResourceId ?? PHYSICAL_RESOURCE_ID };
  }

  // DATABASE_URLを環境変数に設定（マイグレーション実行前に必要）
  process.env.DATABASE_URL = await getDatabaseUrl();

  // Sanitize the command input。CloudFormation からはリソースのプロパティで届く
  const command: AllowedCommand = validateCommand(
    event?.ResourceProperties?.command ?? event?.command
  );
  let options: string[] = [];

  if (command === "reset") {
    options = ["--force", "--skip-generate", "--skip-seed"];
  }

  try {
    const exitCode = await new Promise<number>((resolve, _) => {
      exec(
        `npx prisma migrate ${command} ${options.join(" ")}`,
        (error, stdout, stderr) => {
          console.log(stdout);
          if (stderr) console.error(stderr);
          if (error != null) {
            console.log(
              `npx prisma migrate ${command} exited with error ${error.message}`
            );
            resolve(error.code ?? 1);
          } else {
            resolve(0);
          }
        }
      );
    });

    if (exitCode !== 0)
      throw Error(`command ${command} failed with exit code ${exitCode}`);
    return { PhysicalResourceId: PHYSICAL_RESOURCE_ID };
  } catch (e) {
    console.log(e);
    throw e;
  }
};
