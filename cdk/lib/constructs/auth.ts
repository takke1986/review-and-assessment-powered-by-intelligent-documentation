import { CfnOutput, Duration, Stack, RemovalPolicy } from "aws-cdk-lib";
import {
  UserPool,
  UserPoolClient,
  UserPoolDomain,
  AccountRecovery,
  StringAttribute,
  ClientAttributes,
  IUserPool,
  IUserPoolClient,
} from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";

/**
 * Auth コンストラクトに渡すプロパティ
 */
export interface AuthProps {
  /**
   * 既存のCognito UserPoolをインポートする場合のID
   */
  cognitoUserPoolId?: string;

  /**
   * 既存のCognito UserPool ClientをインポートするID
   */
  cognitoUserPoolClientId?: string;

  /**
   * Cognitoドメインのプレフィックス
   */
  cognitoDomainPrefix?: string;

  /**
   * Cognito User Poolのセルフサインアップを有効にするかどうか
   * @default true
   */
  cognitoSelfSignUpEnabled?: boolean;
}

export class Auth extends Construct {
  readonly userPool: UserPool | IUserPool;
  readonly client: UserPoolClient | IUserPoolClient;
  readonly userPoolDomain?: UserPoolDomain;

  constructor(scope: Construct, id: string, props?: AuthProps) {
    super(scope, id);

    // 既存のCognitoリソースのインポートかどうか判定
    const importUserPoolId = props?.cognitoUserPoolId;
    const importUserPoolClientId = props?.cognitoUserPoolClientId;
    const domainPrefix = props?.cognitoDomainPrefix;

    // UserPool & UserPoolClient の初期化
    const resources = this.initializeResources(
      importUserPoolId,
      importUserPoolClientId,
      props?.cognitoSelfSignUpEnabled
    );
    this.userPool = resources.userPool;
    this.client = resources.client;

    // ドメイン設定（オプション）
    if (domainPrefix && this.userPool instanceof UserPool) {
      this.userPoolDomain = this.createDomain(this.userPool, domainPrefix);
    }

    // 出力の設定
    this.createOutputs(importUserPoolId, importUserPoolClientId);
  }

  /**
   * Cognitoリソース（UserPool & Client）を初期化する
   * @returns 初期化されたリソース
   */
  private initializeResources(
    importUserPoolId?: string,
    importUserPoolClientId?: string,
    selfSignUpEnabled?: boolean
  ): {
    userPool: UserPool | IUserPool;
    client: UserPoolClient | IUserPoolClient;
  } {
    if (importUserPoolId) {
      return this.createImportedResources(
        importUserPoolId,
        importUserPoolClientId
      );
    } else {
      return this.createNewResources(selfSignUpEnabled);
    }
  }

  /**
   * 既存のCognitoリソースをインポートする
   */
  private createImportedResources(
    userPoolId: string,
    userPoolClientId?: string
  ): {
    userPool: UserPool | IUserPool;
    client: UserPoolClient | IUserPoolClient;
  } {
    console.log(`Importing existing Cognito User Pool: ${userPoolId}`);
    const userPool = UserPool.fromUserPoolId(
      this,
      "ImportedUserPool",
      userPoolId
    );

    let client: UserPoolClient | IUserPoolClient;
    if (userPoolClientId) {
      // 既存のClientをインポート
      console.log(
        `Importing existing Cognito User Pool Client: ${userPoolClientId}`
      );
      client = UserPoolClient.fromUserPoolClientId(
        this,
        "ImportedClient",
        userPoolClientId
      );
    } else {
      // インポートされたUserPoolに新しいClientを作成
      console.log(`Creating new client for imported User Pool`);
      client = this.createUserPoolClient(userPool as UserPool);
    }

    return { userPool, client };
  }

  /**
   * 新しいCognitoリソースを作成する
   */
  private createNewResources(selfSignUpEnabled?: boolean): {
    userPool: UserPool;
    client: UserPoolClient;
  } {
    const userPool = new UserPool(this, "UserPool", {
      passwordPolicy: {
        requireUppercase: true,
        requireSymbols: true,
        requireDigits: true,
        minLength: 8,
      },
      selfSignUpEnabled: selfSignUpEnabled ?? true,
      signInAliases: {
        username: false,
        email: true,
      },
      autoVerify: {
        email: true,
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      customAttributes: {
        rapid_role: new StringAttribute({ minLen: 0, maxLen: 2048 }),
        // 所属部署。兼務があるので複数入る（区切りは , ; 空白のいずれか）。
        //
        // グループ（cognito:groups）ではなく属性で持つ。グループは役割の管理に
        // 使うので、部署を同じ入れ物に混ぜると、役割を足したつもりで見える
        // 範囲が変わる。
        //
        // mutable を true にしてあるのは、SAML の属性マッピングで入れるため。
        // Cognito は IdP から写す属性が mutable であることを求める。しかも
        // **属性は後から変えられない**（足すことはできるが、直すことも消すことも
        // できない）ので、ここで決め損なうと別名の属性を作り直すことになる。
        // 既存の rapid_role は mutable を指定しておらず false なので、
        // IdP から写すことはできない
        departments: new StringAttribute({
          minLen: 0,
          maxLen: 2048,
          mutable: true,
        }),
      },
      removalPolicy: RemovalPolicy.DESTROY, // 開発環境用。本番環境ではRETAINを検討
    });

    // Add suppressions for Cognito requirements
    NagSuppressions.addResourceSuppressions(
      userPool,
      [
        {
          id: "AwsSolutions-COG2",
          reason:
            "MFA requirement is disabled for demo/POC environments to lower barriers for users",
        },
        {
          id: "AwsSolutions-COG3",
          reason:
            "Advanced Security Mode is deprecated due to the introduction of feature plans, so configuration is not required",
        },
      ],
      true
    );

    const client = this.createUserPoolClient(userPool);

    return { userPool, client };
  }

  /**
   * UserPoolClientを作成する
   */
  private createUserPoolClient(userPool: UserPool): UserPoolClient {
    const standardReadAttributes = { email: true, emailVerified: true };
    const standardWriteAttributes = { email: true };

    return userPool.addClient("Client", {
      // 入れ直さずに使い続けられる時間は、更新トークンの寿命で決まる。
      // 12時間にすると、朝に入れば業務終わりまで持ち、翌朝には切れる。
      //
      // ID とアクセスのトークンは短くして、裏で更新させる。Cognito は
      // 更新トークンより長い ID トークンを受け付けないので、1日のままには
      // できない。短いほうが、権限を変えたときに早く反映される
      idTokenValidity: Duration.hours(1),
      accessTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.hours(12),
      authFlows: {
        userPassword: true,
        userSrp: true,
        adminUserPassword: true,
      },
      // 読めないと ID トークンに載らない。載らなければ、部署は無いのと同じ
      readAttributes: new ClientAttributes()
        .withStandardAttributes(standardReadAttributes)
        .withCustomAttributes("rapid_role", "departments"),
      // departments を書ける側に入れていないのは、入れると**利用者が自分の
      // アクセストークンで自分の部署を書き換えられる**ため。部署は見える範囲を
      // 決めるので、自分で足せるなら他部署の審査が読める。
      //
      // その代わり、SAML で部署を IdP から写す運用にするときは、ここに
      // departments を足さないと Cognito がサインインのたびに書き込みに失敗する。
      // 「IdP から入れられること」と「本人が書き換えられないこと」は Cognito の
      // 同じ設定で決まるので両立しない。IdP を繋ぐときに選ぶ
      writeAttributes: new ClientAttributes().withStandardAttributes(
        standardWriteAttributes
      ),
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
    });
  }

  /**
   * Cognitoドメインを作成する
   */
  private createDomain(
    userPool: UserPool,
    domainPrefix: string
  ): UserPoolDomain {
    console.log(`Creating Cognito domain with prefix: ${domainPrefix}`);
    return userPool.addDomain("Domain", {
      cognitoDomain: {
        domainPrefix: domainPrefix,
      },
    });
  }

  /**
   * CloudFormation出力を作成する
   */
  private createOutputs(
    importUserPoolId?: string,
    importUserPoolClientId?: string
  ): void {
    // UserPool ID出力
    if (this.userPool instanceof UserPool) {
      new CfnOutput(this, "UserPoolId", { value: this.userPool.userPoolId });
    } else {
      new CfnOutput(this, "UserPoolId", {
        value: importUserPoolId || "Imported (ID not available)",
      });
    }

    // UserPoolClient ID出力
    if (this.client instanceof UserPoolClient) {
      new CfnOutput(this, "UserPoolClientId", {
        value: this.client.userPoolClientId,
      });
    } else {
      new CfnOutput(this, "UserPoolClientId", {
        value: importUserPoolClientId || "Imported (ID not available)",
      });
    }

    // ドメインURL出力
    if (this.userPoolDomain) {
      new CfnOutput(this, "UserPoolDomainUrl", {
        value: `https://${this.userPoolDomain.domainName}.auth.${
          Stack.of(this).region
        }.amazoncognito.com`,
      });
    }
  }
}
