import { ForbiddenError } from "../errors/application-errors";
import {
  assertHasOwnerAccessOrThrow,
  hasOwnerAccess,
  type RequestUser,
} from "../middleware/authorization";
import { canView, toViewer } from "./visibility";

/**
 * チェックリストを誰が使え、誰が直せ、誰が消せるか。
 *
 * 審査ジョブとは規則が違う。審査は「誰が判定したか」を残すために、
 * 判定を変えられるのを始めた人だけにしている（visibility.ts の canEdit）。
 * チェックリストは部署で使い回す道具で、作った人が異動・退職しても
 * 部署の人が保守を続けられないと困る。そこで:
 *
 * - 見る・審査に使う・複製する: 作成者、同じ部署の人、管理者
 * - 直す: 同じ（誰が直したかは last_edited_by に残す）
 * - 消す: 作成者と管理者だけ。消すと戻せないので、部署には開かない
 *
 * 判定を1か所に集めているのは、画面ごとに食い違うと「一覧には出るのに
 * 開けない」といった見え方になるため。実際に一度そうなっていた
 */

export interface CheckListSetAccess {
  id: string;
  userId: string;
  /** 部署を使わない運用や、部署機能より前のチェックリストには入らない */
  departmentId?: string | null;
}

type Logger = { warn?: (...args: any[]) => void };

const toJobShape = (set: CheckListSetAccess) => ({
  userId: set.userId,
  departmentId: set.departmentId ?? undefined,
});

/**
 * 見る・審査に使う・複製する。
 * 利用者が分からないときは通さない。canView は利用者なしを「絞らない」と
 * 読むが、それは一覧の絞り込みの話で、1件の許可に持ち込むと誰でも通る
 */
export const canUseCheckListSet = (
  user: RequestUser | undefined,
  set: CheckListSetAccess
): boolean => !!user && canView(toViewer(user), toJobShape(set));

/** 直す。いまは使えるのと同じ範囲。分けて名前を付けてあるのは、呼ぶ側で意図を読めるようにするため */
export const canEditCheckListSet = canUseCheckListSet;

/** 消す */
export const canDeleteCheckListSet = (
  user: RequestUser | undefined,
  set: CheckListSetAccess
): boolean => hasOwnerAccess(user, set.userId);

const deny = (
  user: RequestUser | undefined,
  set: CheckListSetAccess,
  opts: { api: string; logger?: Logger }
): never => {
  opts.logger?.warn?.(
    `Failure to authorize. : api=${opts.api}, ` +
      `user_id=${user?.userId ?? "unknown_user"}, resource_id=${set.id}`
  );
  throw new ForbiddenError("Access to the requested resource is forbidden");
};

export function assertCanUseCheckListSetOrThrow(
  user: RequestUser | undefined,
  set: CheckListSetAccess,
  opts: { api: string; logger?: Logger }
): void {
  if (!canUseCheckListSet(user, set)) deny(user, set, opts);
}

export function assertCanEditCheckListSetOrThrow(
  user: RequestUser | undefined,
  set: CheckListSetAccess,
  opts: { api: string; logger?: Logger }
): void {
  if (!canEditCheckListSet(user, set)) deny(user, set, opts);
}

export function assertCanDeleteCheckListSetOrThrow(
  user: RequestUser | undefined,
  set: CheckListSetAccess,
  opts: { api: string; logger?: Logger }
): void {
  assertHasOwnerAccessOrThrow(user, set.userId, {
    api: opts.api,
    resourceId: set.id,
    logger: opts.logger,
  });
}
