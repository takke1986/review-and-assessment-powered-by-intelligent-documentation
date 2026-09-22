import { ulid } from "ulid";
import { getPrismaClient } from "../../api/core/db";

/** 読み取りの結果。画面と問い合わせの両方でこの4つだけを使う */
export const READING_STATUS = {
  /** ページを全部読めた */
  COMPLETED: "completed",
  /** 一部のページが読めなかった */
  PARTIAL: "partial",
  /** ページはあったが1枚も読めなかった */
  FAILED: "failed",
  /**
   * 読むページが無かった。Office のように、文字を XML から直に取れて
   * ページという単位を持たない書類がこれにあたる。
   *
   * completed と混ぜると「読んだ結果、問題なし」と区別できない。
   * 読み取りが働いたのかどうかを後から確かめられなくなる
   */
  NO_PAGES: "no_pages",
  /**
   * 先読みが要らなかった。小さい書類は、審査のときに元のファイルを
   * そのまま渡せるので先読みを通らない。
   *
   * 記録そのものを作らないでいると、「不要だった」のか「記録に失敗した」のかが
   * 区別できない。どちらも行が無いように見えてしまう
   */
  NOT_NEEDED: "not_needed",
} as const;

export type ReadingStatus =
  (typeof READING_STATUS)[keyof typeof READING_STATUS];

/** 読めたページの数から状態を決める */
const statusOf = (pages: ReadingRecord["pages"]): ReadingStatus => {
  if (pages.length === 0) {
    return READING_STATUS.NO_PAGES;
  }
  const read = pages.filter((page) => page.wasRead).length;
  if (read === pages.length) {
    return READING_STATUS.COMPLETED;
  }
  return read === 0 ? READING_STATUS.FAILED : READING_STATUS.PARTIAL;
};

/**
 * 先に読み取った結果の在り処と中身を、書類に紐づけて残す。
 *
 * これまではキーの規則（digest/{jobId}/{元のキー}.json）だけが対応関係だった。
 * 規則が守られている間しか成り立たず、ファイルが差し替わる・キーが変わる・
 * ライフサイクルで消える、といった場面で対応が黙って崩れる。実際に書いた
 * 値を行として残し、どの審査がどれを読んだかを後から辿れるようにする。
 */

/** 読み取り Lambda が返してくる、書類1つぶんの記録 */
export interface ReadingRecord {
  /** 元のファイルの S3 キー。どの書類のものかはこれで突き合わせる */
  documentKey: string;
  /** 読み取り結果を実際に書いた先 */
  s3Key: string;
  pages: Array<{
    pageNumber: number;
    wasRead: boolean;
    hasFigure: boolean;
    charCount: number;
  }>;
  images: Array<{
    name: string;
    hasText: boolean;
    hasDescription: boolean;
  }>;
}

export interface RecordReadingParams {
  reviewJobId: string;
  records: ReadingRecord[];
}

export const recordReading = async (
  params: RecordReadingParams
): Promise<{ recorded: number; skipped: string[]; notNeeded: number }> => {
  const { reviewJobId, records } = params;
  // 記録すべきものが無くても、先読みを通らなかった印は残すので先へ進む

  const client = await getPrismaClient();
  // 書類は S3 のキーで突き合わせる。同じジョブの中で一意
  const documents = await client.reviewDocument.findMany({
    where: { reviewJobId },
    select: { id: true, s3Path: true },
  });
  const idByKey = new Map(documents.map((d) => [d.s3Path, d.id]));

  const skipped: string[] = [];
  let recorded = 0;

  for (const record of records) {
    const documentId = idByKey.get(record.documentKey);
    if (!documentId) {
      // 読んだのに書類が見つからないのは、対応が壊れているということ。
      // 審査は止めないが、黙って捨てると気づけないので残す
      skipped.push(record.documentKey);
      continue;
    }

    const status = statusOf(record.pages);
    const now = new Date();
    // 読み直したときは前の行を置き換える。ページの増減がそのまま残らないよう、
    // 子ごと消してから入れ直す（外部キーの連鎖削除に任せる）
    await client.$transaction(async (tx) => {
      await tx.reviewDocumentDigest.deleteMany({
        where: { reviewDocumentId: documentId },
      });
      const digestId = ulid();
      await tx.reviewDocumentDigest.create({
        data: {
          id: digestId,
          reviewDocumentId: documentId,
          s3Key: record.s3Key,
          status,
          createdAt: now,
          updatedAt: now,
        },
      });
      if (record.pages.length > 0) {
        await tx.reviewDocumentPage.createMany({
          data: record.pages.map((page) => ({
            id: ulid(),
            digestId,
            pageNumber: page.pageNumber,
            wasRead: page.wasRead,
            hasFigure: page.hasFigure,
            charCount: page.charCount,
          })),
        });
      }
      if (record.images.length > 0) {
        await tx.reviewDocumentImage.createMany({
          data: record.images.map((image) => ({
            id: ulid(),
            digestId,
            name: image.name,
            hasText: image.hasText,
            hasDescription: image.hasDescription,
          })),
        });
      }
    });
    recorded += 1;
  }

  // 先読みを通らなかった書類にも印を残す。行が無いままだと「不要だった」のか
  // 「記録に失敗した」のかが区別できない
  const recordedIds = new Set(
    records
      .map((record) => idByKey.get(record.documentKey))
      .filter((id): id is string => !!id)
  );
  const untouched = documents.filter((doc) => !recordedIds.has(doc.id));
  for (const doc of untouched) {
    const now = new Date();
    await client.reviewDocumentDigest.upsert({
      where: { reviewDocumentId: doc.id },
      // 既に記録がある書類は触らない。読み直しでページが消えるのを防ぐ
      update: {},
      create: {
        id: ulid(),
        reviewDocumentId: doc.id,
        s3Key: null,
        status: READING_STATUS.NOT_NEEDED,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  if (skipped.length > 0) {
    console.warn(
      `読み取り結果に対応する書類が見つからなかった: ${skipped.join(", ")}`
    );
  }
  return { recorded, skipped, notNeeded: untouched.length };
};
