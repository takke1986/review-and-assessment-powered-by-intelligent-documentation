import type { RequestUser } from "../middleware/authorization";

/**
 * 審査を始めた人の表示名を読む。
 *
 * 名前は Cognito のカスタム属性 `custom:name` に入っている。本番は SAML を
 * 想定していて、この属性は IdP から写される。
 *
 * 読み取りをここ1か所に閉じ込めてあるのは departmentsOf と同じ理由で、
 * IdP ごとに入れ物が変わっても、この関数だけを直せば済むようにするため。
 *
 * 名前は「そのときの値」を審査ジョブに写し取る。参照ではなく写しにするのは、
 * 後で改名や退職があっても当時の記録を変えないため。監査の記録としては
 * 「いま誰がその userId を持っているか」より「当時そう記録された」が要る。
 */

/** 属性が入っていない利用者もいる。そのときは空にして、画面側で「不明」と出す */
export const displayNameOf = (
  user: RequestUser | undefined
): string | undefined => {
  const raw = user?.rawClaims?.["custom:name"];
  if (typeof raw !== "string") {
    return undefined;
  }
  const name = raw.trim();
  return name.length > 0 ? name : undefined;
};
