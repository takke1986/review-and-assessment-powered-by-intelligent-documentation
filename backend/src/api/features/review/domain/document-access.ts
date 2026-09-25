import { getPrismaClient, PrismaClient } from "../../../core/db";

/**
 * 文書の取り出し・削除を許してよいかを調べるための読み取り。
 *
 * S3 のキーは画面から送られてくるので、そのまま信じると、キーさえ分かれば
 * 誰の文書でも取り出せて消せる。キーが「どの審査の文書か」をここで引き、
 * 見てよい審査の文書かどうかを使う側で確かめる
 */

export interface ReviewJobAccess {
  id: string;
  userId: string;
  departmentId?: string;
}

export interface DocumentAccessRepository {
  /**
   * そのキーを文書に持つ審査。再審査では元の審査の文書を引き継ぐので、
   * 同じキーが複数の審査に出てくる
   */
  findReviewJobsByDocumentKey(key: string): Promise<ReviewJobAccess[]>;
  findReviewJob(reviewJobId: string): Promise<ReviewJobAccess | null>;
  /** 審査の結果に出てきた外部の出典（ナレッジベースの s3://…）の生の値 */
  findExternalSources(reviewJobId: string): Promise<unknown[]>;
  /** 審査かチェックリストの文書として登録済みか */
  isDocumentRegistered(documentId: string): Promise<boolean>;
  /**
   * まだどれかの審査文書が指しているキー。再審査では元の審査の文書を
   * 引き継ぐので、審査を1つ消しても、同じファイルを別の審査が使っていることがある
   */
  findReferencedKeys(keys: string[]): Promise<Set<string>>;
}

const toAccess = (job: {
  id: string;
  userId: string | null;
  departmentId: string | null;
}): ReviewJobAccess => ({
  id: job.id,
  userId: job.userId ?? "",
  departmentId: job.departmentId ?? undefined,
});

export const makePrismaDocumentAccessRepository = async (
  clientInput: PrismaClient | null = null
): Promise<DocumentAccessRepository> => {
  const client = clientInput || (await getPrismaClient());
  const jobSelect = { id: true, userId: true, departmentId: true } as const;

  return {
    async findReviewJobsByDocumentKey(key) {
      const docs = await client.reviewDocument.findMany({
        where: { s3Path: key },
        select: { reviewJob: { select: jobSelect } },
      });
      return docs.map((d) => toAccess(d.reviewJob));
    },
    async findReviewJob(reviewJobId) {
      const job = await client.reviewJob.findUnique({
        where: { id: reviewJobId },
        select: jobSelect,
      });
      return job ? toAccess(job) : null;
    },
    async findExternalSources(reviewJobId) {
      const rows = await client.reviewResult.findMany({
        where: { reviewJobId },
        select: { externalSources: true },
      });
      return rows.map((r) => r.externalSources).filter((v) => v != null);
    },
    async findReferencedKeys(keys) {
      if (keys.length === 0) return new Set();
      const rows = await client.reviewDocument.findMany({
        where: { s3Path: { in: keys } },
        select: { s3Path: true },
      });
      return new Set(rows.map((row) => row.s3Path));
    },
    async isDocumentRegistered(documentId) {
      const [review, checklist] = await Promise.all([
        client.reviewDocument.count({ where: { id: documentId } }),
        client.checkListDocument.count({ where: { id: documentId } }),
      ]);
      return review + checklist > 0;
    },
  };
};

/** 画面の parseS3Uri と同じ規則。キーの先頭のスラッシュは落とす */
export const parseS3Uri = (
  uri: string
): { bucket: string; key: string } | null => {
  const match = uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  const key = match[2].startsWith("/") ? match[2].slice(1) : match[2];
  return { bucket: match[1], key };
};

/**
 * 出典の中の s3:// の場所を集める。
 *
 * 出典はツールの出力で、形が決まっていない（出力が JSON の文字列のまま
 * 入っていることもある）。なので形を決め打ちせず、中を全部たどって
 * s3:// で始まる文字列を拾う。JSON の文字列に見えるものは開いてたどる
 */
export const collectS3Locations = (value: unknown): Set<string> => {
  const found = new Set<string>();
  const walk = (v: unknown, depth: number): void => {
    if (depth > 20 || v == null) return;
    if (typeof v === "string") {
      const s = v.trim();
      if (s.startsWith("s3://")) {
        const parsed = parseS3Uri(s);
        if (parsed) found.add(`${parsed.bucket}/${parsed.key}`);
      } else if (s.startsWith("{") || s.startsWith("[")) {
        try {
          walk(JSON.parse(s), depth + 1);
        } catch {
          // JSON でなければ、ただの文字列
        }
      }
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x) => walk(x, depth + 1));
      return;
    }
    if (typeof v === "object") {
      Object.values(v as Record<string, unknown>).forEach((x) =>
        walk(x, depth + 1)
      );
    }
  };
  walk(value, 0);
  return found;
};
