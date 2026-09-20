import { ValidationError } from "../../../../core/errors";
import type { RequestUser } from "../../../../core/middleware/authorization";

/**
 * その人がどの部署に属するかを読む。
 *
 * 本番は SAML を想定しており、部署は IdP から来る。ところが、多値の属性が
 * Cognito にどう入るかは IdP の実装で変わる（区切り文字も、そもそも属性か
 * グループかも）。実機で確かめるまで決められない。
 *
 * そこで読み取りをここ1か所に閉じ込める。IdP が決まったら、この関数だけを
 * 直せば済むようにしてある。ほかの処理は「部署の一覧」だけを見る。
 *
 * いまは2つの持ち方に対応する。
 * - Cognito のグループ（cognito:groups）。兼務がそのまま表せる
 * - カスタム属性（custom:departments）。区切りは , か ; か空白
 */

/** グループ名につける印。ほかの用途のグループと混ざらないようにする */
export const DEPARTMENT_GROUP_PREFIX = "dept-";

const fromGroups = (user: RequestUser): string[] => {
  const groups = user["cognito:groups"];
  if (!Array.isArray(groups)) {
    return [];
  }
  return groups
    .filter(
      (group): group is string =>
        typeof group === "string" && group.startsWith(DEPARTMENT_GROUP_PREFIX)
    )
    .map((group) => group.slice(DEPARTMENT_GROUP_PREFIX.length));
};

const fromAttribute = (user: RequestUser): string[] => {
  const raw = user.rawClaims?.["custom:departments"];
  if (typeof raw !== "string") {
    return [];
  }
  return raw.split(/[,;\s]+/);
};

/**
 * 重複と空を除いた部署の一覧。属していなければ空
 */
export const departmentsOf = (user: RequestUser | undefined): string[] => {
  if (!user) {
    return [];
  }
  const found = [...fromGroups(user), ...fromAttribute(user)]
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
