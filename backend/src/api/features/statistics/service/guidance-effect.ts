/**
 * 着眼点を書いたあと、AI の判定が人に覆されにくくなったかを見る。
 *
 * ここが無いと、傾向はただの一覧で終わる。書いた側から見て「効いた」が
 * 分かると、次の項目にも書こうという気になる
 */

/** 判定1件のうち、前後の比較に要る部分 */
export interface JudgedResult {
  checkId: string;
  createdAt: Date;
  /** 人が覆したか */
  userOverride: boolean;
  /** AI の判定。記録していなかった頃の結果には無い */
  aiResult: string | null;
  result: string | null;
}

export interface OverturnCounts {
  /** 判定の回数 */
  reviewed: number;
  /** そのうち人に覆された回数 */
  overturned: number;
}

export interface GuidanceEffect {
  writtenAt: Date;
  before: OverturnCounts;
  after: OverturnCounts;
}

/** 覆されたと言えるのは、AI の判定が分かっていて、それと違う結果のとき */
export const wasOverturned = (row: JudgedResult): boolean =>
  row.userOverride && row.aiResult !== null && row.aiResult !== row.result;

/**
 * 着眼点を書いた日時を境に、覆された回数を前後で分ける。
 *
 * 境目は判定を作った日時で見る。更新日時ではない。あとから覆しても、
 * その判定は着眼点より前に下されたものだから
 */
export function splitByGuidance(params: {
  writtenAt: Date;
  results: JudgedResult[];
}): GuidanceEffect {
  const before: OverturnCounts = { reviewed: 0, overturned: 0 };
  const after: OverturnCounts = { reviewed: 0, overturned: 0 };

  for (const row of params.results) {
    const side = row.createdAt < params.writtenAt ? before : after;
    side.reviewed += 1;
    if (wasOverturned(row)) {
      side.overturned += 1;
    }
  }

  return { writtenAt: params.writtenAt, before, after };
}
