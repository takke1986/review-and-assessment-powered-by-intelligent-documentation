import { Construct } from "constructs";
import { CfnOutput, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as iam from "aws-cdk-lib/aws-iam";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  IBucket,
} from "aws-cdk-lib/aws-s3";
import {
  CachePolicy,
  Distribution,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { NodejsBuild } from "deploy-time-build";
import { Auth } from "./auth";
import { NagSuppressions } from "cdk-nag";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as path from "path";

export type FrontendDeliveryMode = "cloudfront" | "s3ApiGateway";

export interface FrontendProps {
  readonly webAclId?: string;
  readonly accessLogBucket?: IBucket;
  readonly enableIpV6?: boolean;
  /**
   * Frontend delivery mechanism.
   * - "cloudfront": CloudFront + S3 with OAC (standard mode)
   * - "s3ApiGateway": S3 bucket served through a dedicated API Gateway (S3 proxy).
   *   In this mode CloudFront/OAC/WAF are not created by this construct.
   * @default "cloudfront"
   */
  readonly deliveryMode?: FrontendDeliveryMode;
  /**
   * Alternative domain name for CloudFront distribution (e.g., chat.example.com)
   * If provided, CloudFront will be accessible via this domain
   */
  readonly alternateDomainName?: string;
  /**
   * Route53 hosted zone ID where the alternate domain records will be created
   * Required if alternateDomainName is provided
   */
  readonly hostedZoneId?: string;
  /**
   * 環境を止めている時間帯に、画面の代わりに案内ページを出す設定。
   * フロントエンドは S3 の静的ファイルなので、止めている間も画面自体は開けてしまい、
   * API だけが失敗して分かりにくい。CloudFront で時刻を見て案内ページを返す。
   */
  readonly closedHours?: ClosedHoursProps;
}

export interface ClosedHoursProps {
  /** 使える時間帯（HH:MM）。これ以外の時間は案内ページを出す */
  readonly windows: { readonly start: string; readonly stop: string }[];
  /** 上の時刻の時差（分）。Asia/Tokyo は +9 時間で夏時間なし */
  readonly utcOffsetMinutes: number;
  /** 案内ページに出す、使える時間帯の説明 */
  readonly openHoursLabel: string;
}

export class Frontend extends Construct {
  /** Only set in CloudFront delivery mode. */
  readonly cloudFrontWebDistribution?: Distribution;
  readonly assetBucket: Bucket;
  readonly deliveryMode: FrontendDeliveryMode;
  private readonly certificate?: acm.ICertificate;
  private readonly hostedZone?: route53.IHostedZone;
  /** Alternate domain name for the CloudFront distribution */
  private readonly alternateDomainName?: string;
  /**
   * Origin URL for the S3+APIGW delivery mode (frontend API stage URL).
   * Set externally after the FrontendApi is wired up.
   */
  private s3ApiGatewayOrigin?: string;
  /**
   * Base path used when building the SPA (e.g. "/app/") in S3+APIGW mode.
   */
  private buildBasePath = "/";

  /**
   * 止めている時間帯に案内ページ（503）を返す CloudFront Function。
   * 確認したいときは ?open=1 を付けると素通しする（目隠しであって、閉じる仕組みではない）。
   */
  private createClosedHoursFunction(
    closedHours: ClosedHoursProps,
  ): CloudFrontFunction {
    const minutesOf = (time: string) => {
      const [hour, minute] = time.split(":").map(Number);
      return hour * 60 + minute;
    };
    const windows = closedHours.windows.map((window) => [
      minutesOf(window.start),
      minutesOf(window.stop),
    ]);
    const page = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="300">
<title>ただいま停止中 - RAPID</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f2f3f3;color:#16191f;font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
main{max-width:34rem;padding:2.5rem;background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.15);line-height:1.8}
h1{margin:0 0 1rem;font-size:1.25rem}p{margin:.5rem 0}strong{font-size:1.1rem}</style></head>
<body><main>
<h1>ただいま停止中です</h1>
<p>費用を抑えるため、この検証環境は決まった時間だけ動かしています。</p>
<p>使える時間帯: <strong>${closedHours.openHoursLabel}</strong></p>
<p>この画面は5分ごとに自動で読み込み直します。時間になったら、そのまま使えるようになります。</p>
</main></body></html>`;
    return new CloudFrontFunction(this, "ClosedHoursFunction", {
      runtime: FunctionRuntime.JS_2_0,
      comment: "Show a notice while the environment is stopped",
      code: FunctionCode.fromInline(`function handler(event) {
  var request = event.request;
  // 確認用の素通し。?open=1 でクッキーを付け、以後は画面が読み込むファイルも通す
  if (request.cookies && request.cookies['rapid-open']) {
    return request;
  }
  if (request.querystring && request.querystring.open) {
    return {
      statusCode: 302,
      statusDescription: 'Found',
      headers: {
        'location': { value: request.uri },
        'cache-control': { value: 'no-store' }
      },
      cookies: {
        'rapid-open': { value: '1', attributes: 'Path=/; Max-Age=43200; Secure; SameSite=Lax' }
      }
    };
  }
  var now = new Date();
  var minutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + ${closedHours.utcOffsetMinutes}) % 1440;
  var windows = ${JSON.stringify(windows)};
  for (var i = 0; i < windows.length; i++) {
    var start = windows[i][0];
    var stop = windows[i][1];
    var open = start < stop
      ? (minutes >= start && minutes < stop)
      : (minutes >= start || minutes < stop);
    if (open) {
      return request;
    }
  }
  return {
    statusCode: 503,
    statusDescription: 'Service Unavailable',
    headers: {
      'content-type': { value: 'text/html; charset=utf-8' },
      'cache-control': { value: 'no-store' }
    },
    body: { encoding: 'text', data: ${JSON.stringify(page)} }
  };
}`),
    });
  }

  constructor(scope: Construct, id: string, props: FrontendProps) {
    super(scope, id);

    this.deliveryMode = props.deliveryMode ?? "cloudfront";
    this.alternateDomainName = props.alternateDomainName;

    const assetBucket = new Bucket(this, "AssetBucket", {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      serverAccessLogsBucket: props.accessLogBucket,
      serverAccessLogsPrefix: "AssetBucket",
    });
    this.assetBucket = assetBucket;

    // S3+APIGW mode: this construct owns only the asset bucket + build.
    // CloudFront/OAC/WAF are skipped; the SPA is served by FrontendApi.
    if (this.deliveryMode === "s3ApiGateway") {
      return;
    }

    if (props.alternateDomainName && props.hostedZoneId) {
      this.hostedZone = route53.HostedZone.fromHostedZoneAttributes(
        this,
        "HostedZone",
        {
          hostedZoneId: props.hostedZoneId,
          zoneName: this.getDomainZoneName(props.alternateDomainName),
        },
      );

      this.certificate = new acm.DnsValidatedCertificate(this, "Certificate", {
        domainName: props.alternateDomainName,
        hostedZone: this.hostedZone,
        region: "us-east-1",
        validation: acm.CertificateValidation.fromDns(this.hostedZone),
      });
    }

    const distribution = new Distribution(this, "Distribution", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(assetBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        ...(props.closedHours
          ? {
              functionAssociations: [
                {
                  eventType: FunctionEventType.VIEWER_REQUEST,
                  function: this.createClosedHoursFunction(props.closedHours),
                },
              ],
            }
          : {}),
      },
      // Required to pass AwsSolutions-CFR4 check
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      ...(this.alternateDomainName && this.certificate
        ? {
            domainNames: [this.alternateDomainName],
            certificate: this.certificate,
          }
        : {}),
      errorResponses: [
        {
          httpStatus: 404,
          ttl: Duration.seconds(0),
          responseHttpStatus: 200,
          responsePagePath: "/",
        },
        {
          httpStatus: 403,
          ttl: Duration.seconds(0),
          responseHttpStatus: 200,
          responsePagePath: "/",
        },
      ],
      ...(!this.shouldSkipAccessLogging() && {
        logBucket: props.accessLogBucket,
        logFilePrefix: "Frontend/",
      }),
      webAclId: props.webAclId,
      enableIpv6: props.enableIpV6 ?? false,
    });

    if (this.alternateDomainName && this.hostedZone) {
      new route53.ARecord(this, "AliasRecord", {
        zone: this.hostedZone,
        target: route53.RecordTarget.fromAlias(
          new targets.CloudFrontTarget(distribution),
        ),
        recordName: this.alternateDomainName,
      });

      if (props.enableIpV6) {
        new route53.AaaaRecord(this, "AaaaRecord", {
          zone: this.hostedZone,
          target: route53.RecordTarget.fromAlias(
            new targets.CloudFrontTarget(distribution),
          ),
          recordName: this.alternateDomainName,
        });
      }
    }

    NagSuppressions.addResourceSuppressions(distribution, [
      {
        id: "AwsPrototyping-CloudFrontDistributionGeoRestrictions",
        reason: "this asset is being used all over the world",
      },
      {
        id: "AwsSolutions-CFR1",
        reason: "Global asset that cannot have geographical restrictions",
      },
      {
        id: "AwsSolutions-CFR4",
        reason:
          "TLS settings have been explicitly set to TLS_V1_2_2021. This is likely a nag tool issue: https://github.com/cdklabs/cdk-nag/issues/1101",
      },
    ]);

    // ReactBuild is created later in buildViteApp, so we'll add suppressions there

    this.cloudFrontWebDistribution = distribution;

    if (this.alternateDomainName) {
      new CfnOutput(this, "AlternateDomain", {
        value: this.alternateDomainName,
        description: "Alternate domain name for the CloudFront distribution",
      });
    }
    if (this.certificate) {
      new CfnOutput(this, "CertificateArn", {
        value: this.certificate.certificateArn,
        description: "ARN of the ACM certificate",
      });
    }
  }

  /**
   * Wire the S3+APIGW delivery mode: origin URL + SPA build base path ("/app/").
   */
  configureS3ApiGatewayDelivery({
    origin,
    basePath,
  }: {
    origin: string;
    basePath: string;
  }) {
    this.s3ApiGatewayOrigin = origin;
    this.buildBasePath = basePath;
  }

  /**
   * Extracts the parent domain from a full domain name
   * e.g., 'chat.example.com' -> 'example.com'
   */
  private getDomainZoneName(domainName: string): string {
    const parts = domainName.split(".");
    if (parts.length <= 2) return domainName;
    return parts.slice(-2).join(".");
  }

  getOrigin(): string {
    if (this.deliveryMode === "s3ApiGateway") {
      if (!this.s3ApiGatewayOrigin) {
        throw new Error(
          "Frontend.getOrigin() called before configureS3ApiGatewayDelivery() in s3ApiGateway mode",
        );
      }
      return this.s3ApiGatewayOrigin;
    }
    if (this.alternateDomainName) {
      return `https://${this.alternateDomainName}`;
    }
    return `https://${this.cloudFrontWebDistribution!.distributionDomainName}`;
  }

  buildViteApp({
    backendApiEndpoint,
    userPoolDomainPrefix,
    auth,
    version,
  }: {
    backendApiEndpoint: string;
    userPoolDomainPrefix: string;
    auth: Auth;
    version?: string; // バージョン情報を追加（オプショナル）
  }) {
    const region = Stack.of(auth.userPool).region;
    const cognitoDomain = `${userPoolDomainPrefix}.auth.${region}.amazoncognito.com/`;
    const buildEnvProps = (() => {
      const defaultProps: { [key: string]: string } = {
        VITE_APP_API_ENDPOINT: backendApiEndpoint,
        VITE_APP_USER_POOL_ID: auth.userPool.userPoolId,
        VITE_APP_USER_POOL_CLIENT_ID: auth.client.userPoolClientId,
        VITE_APP_REGION: region,
        VITE_APP_VERSION: version || "unknown ver", // バージョン情報を追加
      };

      // S3+APIGW mode: SPA is under the stage prefix, so Vite needs that base.
      if (this.deliveryMode === "s3ApiGateway") {
        defaultProps.VITE_APP_BASE_PATH = this.buildBasePath;
      }

      return defaultProps;

      // const oAuthProps = {
      //   VITE_APP_REDIRECT_SIGNIN_URL: this.getOrigin(),
      //   VITE_APP_REDIRECT_SIGNOUT_URL: this.getOrigin(),
      //   VITE_APP_COGNITO_DOMAIN: cognitoDomain,
      //   VITE_APP_SOCIAL_PROVIDERS: idp.getSocialProviders(),
      //   VITE_APP_CUSTOM_PROVIDER_ENABLED: idp
      //     .checkCustomProviderEnabled()
      //     .toString(),
      //   VITE_APP_CUSTOM_PROVIDER_NAME: idp.getCustomProviderName(),
      // };
      // return { ...defaultProps, ...oAuthProps };
    })();

    const reactBuild = new NodejsBuild(this, "ReactBuild", {
      assets: [
        {
          // path: "../frontend",
          path: path.join(__dirname, "../../../frontend/"),
          exclude: [
            "node_modules",
            "dist",
            "dev-dist",
            ".env",
            ".env.local",
            "../cdk/**/*",
            "../backend/**/*",
            "../example/**/*",
            "../docs/**/*",
            "../.github/**/*",
          ],
          commands: ["npm ci"],
        },
      ],
      buildCommands: ["npm run build"],
      buildEnvironment: buildEnvProps,
      destinationBucket: this.assetBucket,
      // In S3+APIGW mode there's no CloudFront distribution to invalidate.
      ...(this.deliveryMode === "cloudfront" && this.cloudFrontWebDistribution
        ? { distribution: this.cloudFrontWebDistribution }
        : {}),
      outputSourceDirectory: "dist",
    });

    // The CloudFront invalidation IAM workaround only applies in CloudFront mode.
    if (this.deliveryMode === "cloudfront" && this.cloudFrontWebDistribution) {
      // This is a workaround for the issue where the BucketDeployment construct
      // does not have permissions to create CloudFront invalidations
      // Ref: https://github.com/aws/aws-cdk/issues/23708
      const bucketDeploy = reactBuild.node
        .findAll()
        .find(
          (c) => c instanceof s3deploy.BucketDeployment,
        ) as s3deploy.BucketDeployment;

      bucketDeploy?.handlerRole?.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: [
            "cloudfront:CreateInvalidation",
            "cloudfront:GetInvalidation",
          ],
          resources: [
            `arn:aws:cloudfront::${Stack.of(this).account}:distribution/${
              this.cloudFrontWebDistribution.distributionId
            }`,
          ],
        }),
      );
    }

    // Add suppressions for CodeBuild-related findings
    NagSuppressions.addResourceSuppressions(
      reactBuild,
      [
        {
          id: "AwsSolutions-CB4",
          reason:
            "KMS encryption settings cannot be changed because it's a third-party library",
        },
      ],
      true,
    );
  }

  /**
   * CloudFront does not support access log delivery in the following regions
   * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/AccessLogs.html#access-logs-choosing-s3-bucket
   */
  private shouldSkipAccessLogging(): boolean {
    const skipLoggingRegions = [
      "af-south-1",
      "ap-east-1",
      "ap-south-2",
      "ap-southeast-3",
      "ap-southeast-4",
      "ca-west-1",
      "eu-south-1",
      "eu-south-2",
      "eu-central-2",
      "il-central-1",
      "me-central-1",
    ];
    return skipLoggingRegions.includes(Stack.of(this).region);
  }
}
