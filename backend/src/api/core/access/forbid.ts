import { ForbiddenError } from "../errors/application-errors";

/**
 * 許可しないことを記録して、403 にする。
 *
 * 記録の形は assertHasOwnerAccessOrThrow と同じ「Failure to authorize.」で
 * 始める。ログで拒否をまとめて探せるようにするため
 */
export function forbid(params: {
  api: string;
  user?: { userId?: string };
  /** 何を拒んだか。resource_id=… や reason=… の形で書く */
  detail: string;
  logger?: { warn?: (...args: any[]) => void };
}): never {
  (params.logger ?? console).warn?.(
    `Failure to authorize. : api=${params.api}, ` +
      `user_id=${params.user?.userId ?? "unknown_user"}, ${params.detail}`
  );
  throw new ForbiddenError("Access to the requested resource is forbidden");
}
