import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as rds from "aws-cdk-lib/aws-rds";
import {
  Schedule,
  ScheduleExpression,
  ScheduleTargetInput,
} from "aws-cdk-lib/aws-scheduler";
import { Universal } from "aws-cdk-lib/aws-scheduler-targets";
import { Construct } from "constructs";

/** 使える時間帯（HH:MM）。stop が start より小さいときは日をまたぐ */
export interface OpenWindow {
  readonly start: string;
  readonly stop: string;
}

/**
 * 使う時間帯だけ動かす設定のプロパティ
 */
export interface CostScheduleProps {
  /** 使う時間帯だけ起動する NAT インスタンスの ID */
  natInstanceIds: string[];
  cluster: rds.DatabaseCluster;
  /** 使える時間帯。複数指定できる */
  windows: OpenWindow[];
  /** 時間帯の何分前に起動するか */
  prestartMinutes: number;
  timeZone: string;
  /** 使う時間帯の Aurora の最小容量（ACU）。止まらないようにする */
  activeMinCapacity: number;
  maxCapacity: number;
  /** 使わない時間帯に、接続が無くなってから Aurora が止まるまでの秒数 */
  autoPauseSeconds: number;
}

/**
 * 決まった時間だけ動かして、検証環境の費用を抑える。
 *
 * - 各時間帯の少し前に NAT インスタンスを起動し、Aurora を止まらない最小容量にする
 *   （容量の変更で、止まっている Aurora も起きる）
 * - 各時間帯の終わりに NAT インスタンスを停止し、Aurora を最小 0 ACU（接続が無ければ自動停止）に戻す
 *
 * テンプレート上の Aurora の最小容量は 0 のまま。使う時間帯にデプロイすると 0 に戻るが、
 * 接続が無い時間が続いたときに止まるだけで、次の接続で起きる。
 */
export class CostSchedule extends Construct {
  constructor(scope: Construct, id: string, props: CostScheduleProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);
    const timeZone = cdk.TimeZone.of(props.timeZone);
    const at = (time: string, offsetMinutes = 0) => {
      const [hour, minute] = time.split(":").map(Number);
      const total = (hour * 60 + minute + offsetMinutes + 1440) % 1440;
      return ScheduleExpression.cron({
        hour: String(Math.floor(total / 60)),
        minute: String(total % 60),
        timeZone,
      });
    };

    const instanceArns = props.natInstanceIds.map((instanceId) =>
      stack.formatArn({
        service: "ec2",
        resource: "instance",
        resourceName: instanceId,
      }),
    );
    const natTarget = (action: "startInstances" | "stopInstances") =>
      new Universal({
        service: "ec2",
        action,
        input: ScheduleTargetInput.fromObject({
          InstanceIds: props.natInstanceIds,
        }),
        policyStatements: [
          new iam.PolicyStatement({
            actions: [
              action === "startInstances"
                ? "ec2:StartInstances"
                : "ec2:StopInstances",
            ],
            resources: instanceArns,
          }),
        ],
      });

    const scaleTarget = (scaling: Record<string, number>) =>
      new Universal({
        service: "rds",
        action: "modifyDBCluster",
        input: ScheduleTargetInput.fromObject({
          // Scheduler は SDK の名前で検証する（API リファレンスの DBClusterIdentifier は「無い」と拒否される）
          DbClusterIdentifier: props.cluster.clusterIdentifier,
          ServerlessV2ScalingConfiguration: scaling,
        }),
        policyStatements: [
          new iam.PolicyStatement({
            actions: ["rds:ModifyDBCluster"],
            resources: [props.cluster.clusterArn],
          }),
        ],
      });

    // 時間帯ごとに作らず使い回す。スケジュールごとにロールが増えるのを防ぐ
    const startNat = natTarget("startInstances");
    const stopNat = natTarget("stopInstances");
    const keepAwake = scaleTarget({
      MinCapacity: props.activeMinCapacity,
      MaxCapacity: props.maxCapacity,
    });
    const letPause = scaleTarget({
      MinCapacity: 0,
      MaxCapacity: props.maxCapacity,
      SecondsUntilAutoPause: props.autoPauseSeconds,
    });

    props.windows.forEach((window, index) => {
      const suffix = `${index + 1}`;
      new Schedule(this, `StartNatInstance${suffix}`, {
        description: `Start the NAT instance before ${window.start}`,
        schedule: at(window.start, -props.prestartMinutes),
        target: startNat,
      });
      new Schedule(this, `KeepDatabaseAwake${suffix}`, {
        description: `Keep Aurora awake for the hours from ${window.start} (also resumes it)`,
        schedule: at(window.start, -props.prestartMinutes),
        target: keepAwake,
      });
      new Schedule(this, `StopNatInstance${suffix}`, {
        description: `Stop the NAT instance at ${window.stop}`,
        schedule: at(window.stop),
        target: stopNat,
      });
      new Schedule(this, `LetDatabasePause${suffix}`, {
        description: `Let Aurora scale to 0 ACU and pause at ${window.stop}`,
        schedule: at(window.stop),
        target: letPause,
      });
    });
  }
}
