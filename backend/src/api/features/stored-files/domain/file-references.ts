import { getPrismaClient, PrismaClient } from "../../../core/db";

/**
 * S3 のファイルが、まだ審査やチェックリストに使われているかを調べる読み取り。
 *
 * ファイルは複数の行から指されることがある:
 * - 再審査は、元の審査の文書を引き継ぐ（同じキーを指す別の審査文書ができる）
 * - チェックリストを複製すると、複製先は複製元の元の書類を共有する
 *
 * だから「行を1つ消したらファイルも消す」とは限らない。消す前にここで確かめる
 */
export interface FileReferenceRepository {
  /** 審査かチェックリストの文書として登録済みか（アップロード途中のものと見分ける） */
  isDocumentRegistered(documentId: string): Promise<boolean>;
  /** まだどれかの審査文書が指しているキー */
  findReferencedReviewKeys(keys: string[]): Promise<Set<string>>;
  /** まだどれかのチェックリスト文書が指しているキー */
  findReferencedChecklistKeys(keys: string[]): Promise<Set<string>>;
  /**
   * そのチェックリストを使った審査ジョブと、その文書のキー。
   * チェックリストを消すと審査ジョブの行も一緒に消えるので、消す前に控える
   */
  findReviewJobsOfCheckListSet(
    checkListSetId: string
  ): Promise<Array<{ id: string; documentKeys: string[] }>>;
}

export const makePrismaFileReferenceRepository = async (
  clientInput: PrismaClient | null = null
): Promise<FileReferenceRepository> => {
  const client = clientInput || (await getPrismaClient());

  return {
    async isDocumentRegistered(documentId) {
      const [review, checklist] = await Promise.all([
        client.reviewDocument.count({ where: { id: documentId } }),
        client.checkListDocument.count({ where: { id: documentId } }),
      ]);
      return review + checklist > 0;
    },
    async findReferencedReviewKeys(keys) {
      if (keys.length === 0) return new Set();
      const rows = await client.reviewDocument.findMany({
        where: { s3Path: { in: keys } },
        select: { s3Path: true },
      });
      return new Set(rows.map((row) => row.s3Path));
    },
    async findReferencedChecklistKeys(keys) {
      if (keys.length === 0) return new Set();
      const rows = await client.checkListDocument.findMany({
        where: { s3Path: { in: keys } },
        select: { s3Path: true },
      });
      return new Set(rows.map((row) => row.s3Path));
    },
    async findReviewJobsOfCheckListSet(checkListSetId) {
      const jobs = await client.reviewJob.findMany({
        where: { checkListSetId },
        select: { id: true, documents: { select: { s3Path: true } } },
      });
      return jobs.map((job) => ({
        id: job.id,
        documentKeys: job.documents.map((doc) => doc.s3Path),
      }));
    },
  };
};
