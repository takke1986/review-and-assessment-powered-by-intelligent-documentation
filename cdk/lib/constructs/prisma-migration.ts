/**
 * Prisma マイグレーション実行用 Lambda 構成
 */
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as path from "path";
import * as cr from "aws-cdk-lib/custom-resources";
import * as rds from "aws-cdk-lib/aws-rds";
import { Construct } from "constructs";
import { DockerPrismaFunction } from "./docker-prisma-function";
import { DockerImageCode } from "aws-cdk-lib/aws-lambda";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import { DatabaseConnectionProps } from "./database";

/**
 * PrismaMigration Constructのプロパティ
 */
export interface PrismaMigrationProps {
  vpc: ec2.IVpc;
  databaseConnection: DatabaseConnectionProps;
  /**
   * データベースクラスター（依存関係の設定に使用）
   */
  databaseCluster: rds.DatabaseCluster;
  /**
   * デプロイ時に自動的にマイグレーションを実行するかどうか
   */
  autoMigrate: boolean;
  /**
   * Subnet selection for the migration Lambda. Defaults to PRIVATE_WITH_EGRESS.
   */
  subnetSelection?: ec2.SubnetSelection;
}

/**
 * Prisma マイグレーション実行用 Lambda Construct
 */
export class PrismaMigration extends Construct {
  public readonly migrationLambda: DockerPrismaFunction;
  public readonly securityGroup: ec2.SecurityGroup;
  public readonly migrationCustomResource?: cdk.CustomResource;

  constructor(scope: Construct, id: string, props: PrismaMigrationProps) {
    super(scope, id);

    // 自動マイグレーション設定を取得
    const autoMigrate = props.autoMigrate;

    // セキュリティグループの作成
    this.securityGroup = new ec2.SecurityGroup(this, "MigrationSecurityGroup", {
      vpc: props.vpc,
      description: "Security group for Prisma Migration Lambda function",
      allowAllOutbound: true,
    });

    // Lambda 関数の作成
    this.migrationLambda = new DockerPrismaFunction(this, "MigrationFunction", {
      code: DockerImageCode.fromImageAsset(
        path.join(__dirname, "../../../backend/"),
        {
          file: "Dockerfile.prisma.lambda",
          platform: Platform.LINUX_ARM64,
          cmd: ["dist/handlers/migration-runner.handler"],
        },
      ),
      vpc: props.vpc,
      vpcSubnets: props.subnetSelection ?? {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [this.securityGroup],
      database: props.databaseConnection,
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      architecture: cdk.aws_lambda.Architecture.ARM_64,
    });

    // 自動マイグレーションが有効な場合、デプロイのたびにマイグレーションを流す。
    //
    // Provider の onEvent にマイグレーションの Lambda を直接渡す。Lambda が例外を
    // 投げると Provider が CloudFormation に FAILED を返し、デプロイは失敗して
    // ロールバックされる。
    //
    // 以前は AwsCustomResource で Lambda の invoke API を呼んでいた。invoke は
    // Lambda の中で例外が起きても API としては成功（FunctionError 付き）で返るので、
    // マイグレーションが失敗しても CloudFormation には成功と伝わり、DB が古いまま
    // 新しいコードが動いていた（稼働時間外で NAT が止まり、DB の接続情報を取りに
    // 行けなかったとき）
    if (autoMigrate) {
      const provider = new cr.Provider(this, "MigrationProvider", {
        onEventHandler: this.migrationLambda,
      });

      this.migrationCustomResource = new cdk.CustomResource(
        this,
        "MigrationRun",
        {
          serviceToken: provider.serviceToken,
          properties: {
            command: "deploy",
            // 値を毎回変えて、デプロイのたびに更新（＝マイグレーション）を走らせる
            deployedAt: Date.now().toString(),
          },
        },
      );

      // 重要: 依存関係の設定
      // 1. Custom ResourceがLambda関数に依存するようにする
      this.migrationCustomResource.node.addDependency(this.migrationLambda);

      // 2. Custom Resourceがデータベースクラスターに依存するようにする
      // これにより、データベースが完全に作成された後にマイグレーションが実行される
      this.migrationCustomResource.node.addDependency(props.databaseCluster);
    }

    // CLI コマンドの出力
    new cdk.CfnOutput(this, "DeployMigrationCommand", {
      value: `aws lambda invoke --function-name ${
        this.migrationLambda.functionName
      } --cli-binary-format raw-in-base64-out --payload '{"command":"deploy"}' --region ${
        cdk.Stack.of(this).region
      } output.json`,
      description: "マイグレーションを実行するコマンド (deploy)",
    });

    new cdk.CfnOutput(this, "ResetMigrationCommand", {
      value: `aws lambda invoke --function-name ${
        this.migrationLambda.functionName
      } --cli-binary-format raw-in-base64-out --payload '{"command":"reset"}' --region ${
        cdk.Stack.of(this).region
      } output.json`,
      description: "マイグレーションをリセットするコマンド (reset)",
    });
  }
}
