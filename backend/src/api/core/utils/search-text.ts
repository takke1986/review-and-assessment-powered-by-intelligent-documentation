/**
 * 検索で使う文字列をそろえるモジュール
 *
 * 同じ「ガ」でも、合成済み(U+30AC)と分解(U+30AB U+3099)の2通りがある。
 * macOS で作ったファイル名は分解形で入ってくる一方、検索窓に打たれる文字は
 * 合成形なので、そのまま LIKE に渡すと見た目が同じでも引けない。
 * 保存時と検索時の両方でNFCに寄せて、この食い違いを無くす。
 */

/** 保存する名前をそろえる。表示にそのまま使うので大文字小文字は触らない */
export const normalizeForStorage = (value: string): string =>
  value.normalize("NFC");

/** 検索語をそろえる。空白だけの入力は「指定なし」として扱う */
export const normalizeSearchTerm = (
  value: string | undefined
): string | undefined => {
  const trimmed = value?.trim().normalize("NFC");
  return trimmed ? trimmed : undefined;
};
