import * as cdk from "aws-cdk-lib";
import * as rds from "aws-cdk-lib/aws-rds";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as iam from "aws-cdk-lib/aws-iam";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";

/**
 * データベースConstructのプロパティ
 */
export interface DatabaseProps {
  vpc: ec2.IVpc;
  databaseName?: string;
  minCapacity?: number;
  maxCapacity?: number;
  autoPause?: boolean;
  autoPauseSeconds?: number;
  /** Backtrack（24時間）を有効にするか。既定は有効 */
  backtrack?: boolean;
  /**
   * Subnet selection for the database cluster. Defaults to PRIVATE_WITH_EGRESS.
   * In closed mode this is PRIVATE_ISOLATED.
   */
  subnetSelection?: ec2.SubnetSelection;
}

export interface DatabaseConnectionProps {
  host: string;
  port: string;
  engine: string;
  username: string;
  password: string;
  databaseName: string;
  secret: secretsmanager.ISecret;
}

/**
 * データベース Construct
 */
export class Database extends Construct {
  public readonly cluster: rds.DatabaseCluster;
  public readonly secret: secretsmanager.ISecret;
  public readonly securityGroup: ec2.SecurityGroup;
  public readonly connection: DatabaseConnectionProps;

  constructor(scope: Construct, id: string, props: DatabaseProps) {
    super(scope, id);

    // データベース名の設定
    const databaseName = props.databaseName || "rapid";

    // セキュリティグループの作成
    this.securityGroup = new ec2.SecurityGroup(this, "DatabaseSecurityGroup", {
      vpc: props.vpc,
      description: "Security group for RAPID database",
      allowAllOutbound: true,
    });

    // Aurora MySQL Serverless v2 クラスターの作成
    this.cluster = new rds.DatabaseCluster(this, "Database", {
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_08_1,
      }),
      vpc: props.vpc,
      vpcSubnets: props.subnetSelection ?? {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [this.securityGroup],
      defaultDatabaseName: databaseName,
      // 最小容量 (ACU)。0 にすると接続が無いときに自動停止する（0 を既定値で上書きしないよう ?? を使う）
      serverlessV2MinCapacity: props.minCapacity ?? 0.5,
      serverlessV2MaxCapacity: props.maxCapacity || 1, // 最大容量 (ACU)
      serverlessV2AutoPauseDuration:
        props.minCapacity === 0 && props.autoPause
          ? Duration.seconds(props.autoPauseSeconds ?? 300)
          : undefined,
      writer: rds.ClusterInstance.serverlessV2("writer", {
        autoMinorVersionUpgrade: true,
        publiclyAccessible: false,
      }),
      storageEncrypted: true,
      removalPolicy: RemovalPolicy.DESTROY,
      enableDataApi: true, // Allow access from Management Console
      port: 3307, // Custom port instead of default 3306 (AwsSolutions-RDS11)
      iamAuthentication: true, // Enable IAM database authentication (AwsSolutions-RDS6)
      // Enable backtrack for MySQL Aurora (AwsSolutions-RDS14)。時間単位で課金されるので、止められるようにする
      backtrackWindow:
        props.backtrack === false ? Duration.seconds(0) : Duration.hours(24),
    });

    // シークレットローテーションの設定
    this.cluster.addRotationSingleUser();

    // シークレットの参照を保存
    this.secret = this.cluster.secret!;

    // データベース接続情報を保存
    this.connection = {
      // We use direct reference for host and port because using only secret here results in failure of refreshing values.
      // Also refer to: https://github.com/aws-cloudformation/cloudformation-coverage-roadmap/issues/369
      host: this.cluster.clusterEndpoint.hostname,
      port: cdk.Token.asString(this.cluster.clusterEndpoint.port),
      engine: this.secret
        .secretValueFromJson("engine")
        .unsafeUnwrap()
        .toString(),
      // We use the master user only to simplify this sample.
      // You should create a database user with minimal privileges for your application.
      // Also refer to: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/UsingWithRDS.MasterAccounts.html
      username: this.secret
        .secretValueFromJson("username")
        .unsafeUnwrap()
        .toString(),
      password: this.secret
        .secretValueFromJson("password")
        .unsafeUnwrap()
        .toString(),
      databaseName: databaseName,
      secret: this.secret,
    };

    // マネジメントコンソールからのアクセスを許可するためのタグを追加
    cdk.Tags.of(this.cluster).add("Name", `RAPID-${databaseName}`);
    cdk.Tags.of(this.cluster).add("Project", "RAPID");

    // Suppress RDS deletion protection (AwsSolutions-RDS10)
    NagSuppressions.addResourceSuppressions(
      this.cluster,
      [
        {
          id: "AwsSolutions-RDS10",
          reason:
            "Sample/demo environment where resources should be easily removed with cdk destroy",
        },
      ],
      true,
    );

    if (props.backtrack === false) {
      NagSuppressions.addResourceSuppressions(
        this.cluster,
        [
          {
            id: "AwsSolutions-RDS14",
            reason:
              "Backtrack is billed per hour; it is turned off for a cost-saving development environment",
          },
        ],
        true,
      );
    }
  }

  /**
   * データベース接続権限を付与
   * @param peer アクセス権限を付与するIPeer
   */
  public grantConnect(peer: ec2.IPeer): void {
    this.cluster.connections.allowFrom(
      peer,
      ec2.Port.tcp(this.cluster.clusterEndpoint.port),
      "Allow connection to database",
    );
  }

  /**
   * 任意のIGrantableにデータベースシークレットへのアクセス権限を付与
   * @param grantable アクセス権限を付与するIGrantable
   */
  public grantSecretAccess(grantable: iam.IGrantable): void {
    // シークレットへの読み取り権限を付与
    this.secret.grantRead(grantable);
  }
}
