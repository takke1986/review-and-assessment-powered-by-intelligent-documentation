import { ValidationError } from "../errors";

/**
 * 画面から送られてきた文書の S3 キーが、その文書のアップロード先か。
 *
 * キーは画面から送られてくる。そのまま使うと、他人がアップロードした
 * 書類のキーを書いて自分の審査にかけられる。アップロードのとき、サーバは
 * `<場所><文書ID>/<ファイル名>` にしか署名しないので、キーがその形で、
 * かつ文書 ID が一致していることを確かめる。文書 ID は文書の主キーでもあるので、
 * 使われたものは二度と使えない
 */
export function assertUploadKeyOrThrow(
  doc: { id: string; s3Key: string },
  uploadAreas: string[]
): void {
  const ok = uploadAreas.some((area) => {
    // S3 のキーは ".." を解釈しないので、この場所の下なら外には出ない
    const prefix = `${area}${doc.id}/`;
    return doc.s3Key.startsWith(prefix) && doc.s3Key.length > prefix.length;
  });
  if (!ok) {
    throw new ValidationError(`Invalid document location: ${doc.id}`);
  }
}
