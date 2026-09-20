import { ForbiddenError } from "../../../../core/errors/application-errors";
import type { RequestUser } from "../../../../core/middleware/authorization";
import { departmentsOf } from "./departments";

/**
 * 誰がどの審査ジョブを見られるか。
 *
 * 審査は担当者ひとりで完結しない。上長や後任が結果を開けないと、紙か CSV を
 * 渡すしかなく、根拠まで辿れなくなる。そこでジョブごとに社内へ公開できる
 * ようにした。
 *
 * 公開しても見られるだけで、判定の変更・再審査・削除は作成者のまま。
 * 見えることと直せることを混ぜると、誰が決めたのか分からなくなる。
 *
 * 判断を1か所に集めているのは、一覧と詳細で食い違うと「一覧には出るのに
 * 開けない」といった見え方になるため
 */

export interface Viewer {
  userId: string;
  isAdmin: boolean;
  /**
   * 属している部署。兼務があるので複数。
   * 読み取りは departments.ts に閉じてある
   */
  departments?: string[];
}

/**
 * リクエストの利用者を「見る人」にする。
 *
 * 所属の読み取りを呼び出し側に書くと、足し忘れた場所だけ部署が効かなく
 * なる。しかもその間違いは「見えるはずのものが見えない」という形で出るので、
 * 気づきにくい
 */
export const toViewer = (user: RequestUser | undefined): Viewer | undefined =>
  user ? { ...user, departments: departmentsOf(user) } : undefined;

/**
 * 一覧の絞り込み条件。
 *
 * 管理者は全件。それ以外は自分のものと、公開されたものだけ
 */
export const visibilityFilter = (
  viewer: Viewer | undefined
): { OR: Array<Record<string, unknown>> } | undefined => {
  if (!viewer || viewer.isAdmin) {
    return undefined;
  }
  const departments = viewer.departments ?? [];
  return {
    OR: [
      { userId: viewer.userId },
      { sharedWithOrg: true },
      // 同じ部署の審査は履歴として見える。部署に属していなければ
      // この条件は足さない。空の in は誰にも当たらないが、条件として
      // 残すと読む人が「部署なしの審査が見える」と誤解する
      ...(departments.length > 0
        ? [{ departmentId: { in: departments } }]
        : []),
    ],
  };
};

/** 1件を開けるか */
export const canView = (
  viewer: Viewer | undefined,
  job: { userId?: string; sharedWithOrg?: boolean; departmentId?: string }
): boolean => {
  if (!viewer || viewer.isAdmin) {
    return true;
  }
  if (job.userId === viewer.userId || job.sharedWithOrg === true) {
    return true;
  }
  // 同じ部署の審査は履歴として見える。直せるかどうかは別（canEdit）
  return (
    job.departmentId !== undefined &&
    (viewer.departments ?? []).includes(job.departmentId)
  );
};

/** 直せるか（判定の変更・再審査・削除・公開の切り替え） */
export const canEdit = (
  viewer: Viewer | undefined,
  job: { userId?: string }
): boolean => {
  if (!viewer || viewer.isAdmin) {
    return true;
  }
  return job.userId === viewer.userId;
};

/**
 * 開けなければ弾く。
 *
 * 所有者かどうかの関門（assertHasOwnerAccessOrThrow）とは別に置く。
 * 「見える」と「直せる」を1つの関門で兼ねると、公開したとたんに
 * 他人が判定を書き換えられるようになってしまう
 */
export function assertCanViewOrThrow(
  viewer: Viewer | undefined,
  job: { id?: string; userId?: string; sharedWithOrg?: boolean },
  opts?: { api?: string; logger?: { warn?: (...args: any[]) => void } }
): void {
  if (canView(viewer, job)) {
    return;
  }
  opts?.logger?.warn?.(
    `Failure to authorize. : api=${opts?.api ?? "unknown_api"}, ` +
      `user_id=${viewer?.userId ?? "unknown_user"}, resource_id=${job.id ?? "unknown"}`
  );
  throw new ForbiddenError("Access to the requested resource is forbidden");
}
