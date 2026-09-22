import { ValidationError } from "../../../../core/errors";
import type { RequestUser } from "../../../../core/middleware/authorization";

/**
 * その人がどの部署に属するかを読む。
 *
 * 部署は Cognito のカスタム属性 `custom:departments` に入っている。兼務が
 * あるので値は複数で、区切りは `,` `;` 空白のいずれでもよい。本番は SAML を
 * 想定していて、この属性は IdP から写される。
 *
 * **グループ（cognito:groups）は見ない。** グループは役割の管理に使うので、
 * 部署を同じ入れ物に混ぜると、役割を足したつもりで見える範囲が変わる。
 *
 * 読み取りをここ1か所に閉じ込めてある。IdP ごとに区切り方が変わっても、
 * この関数だけを直せば済む。ほかの処理は「部署の一覧」だけを見る。
 */

/** 区切り文字。IdP によって読点だったり空白だったりする */
const SEPARATORS = /[,;\s]+/;

/**
 * 重複と空を除いた部署の一覧。属していなければ空
 */
export const departmentsOf = (user: RequestUser | undefined): string[] => {
  const raw = user?.rawClaims?.["custom:departments"];
  if (typeof raw !== "string") {
    return [];
  }
  const found = raw
    .split(SEPARATORS)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return [...new Set(found)];
};

/**
 * この審査をどの部署のものとして記録するか。
 *
 * 兼務があるので「作った人の所属」だけでは決まらない。営業と法務を兼ねる人の
 * 審査を、法務の同僚に見せてよいとは限らないため、作るときに選んでもらう。
 *
 * 決められないときは止める。黙って部署なしで作ると、同僚の履歴に出てこない
 * ことに誰も気づけない。画面でも選ばせているが、そちらだけに頼らない
 */
export const resolveDepartment = (params: {
  user: RequestUser | undefined;
  /** 画面で選ばれた部署 */
  chosen?: string;
}): string | undefined => {
  const mine = departmentsOf(params.user);

  if (params.chosen) {
    if (!mine.includes(params.chosen)) {
      // 黙って無視すると、記録されたと思われる
      throw new ValidationError(
        `You do not belong to this department: ${params.chosen}`
      );
    }
    return params.chosen;
  }

  if (mine.length > 1) {
    throw new ValidationError(
      "You belong to more than one department, so choose which one this review is for"
    );
  }

  // 所属が1つなら選ぶまでもない。どこにも属していなければ部署なしで作る
  // （部署を使わない運用でも止まらないように）
  return mine.length === 1 ? mine[0] : undefined;
};
