import {
  deleteS3Object,
  getDownloadPresignedUrl,
  listS3Keys,
} from "../../../core/s3";
import { canView, toViewer } from "../../../core/access/visibility";
import type { RequestUser } from "../../../core/middleware/authorization";
import { forbid } from "../../../core/access/forbid";
import { downloadResponseHeaders } from "../../../core/uploads";
import { NotFoundError } from "../../../core/errors/application-errors";
import {
  collectS3Locations,
  DocumentAccessRepository,
  makePrismaDocumentAccessRepository,
} from "../domain/document-access";

interface GetDocumentDownloadUrlParams {
  key: string;
  bucket?: string;
  /** ナレッジベースの出典を開くときの、出典が出てきた審査 */
  reviewJobId?: string;
  expiresIn?: number;
  user: RequestUser;
  deps?: { repo?: DocumentAccessRepository };
}

/** URL の有効期限の上限。送られてきた値をそのまま使うと、何日も使える URL を作れる */
const MAX_EXPIRES_IN = 3600;

const deny = (user: RequestUser, detail: string): never =>
  forbid({ api: "getDocumentDownloadUrl", user, detail });

/**
 * ドキュメントのダウンロード用 Presigned URL を取得する。
 *
 * 取り出せるのは次の2つだけ:
 * - 文書バケットの、見てよい審査の文書（同じ部署の審査も含む）
 * - ほかのバケットの、見てよい審査の結果に出典として出てきた場所
 *   （ナレッジベースの元文書）
 *
 * 以前はバケットとキーを送られたまま署名していた。API の権限はアカウント内の
 * どのバケットでも読めるので、RAPID と関係ないバケットの中身まで誰でも
 * 取り出せた
 */
export async function getDocumentDownloadUrl(
  params: GetDocumentDownloadUrlParams
): Promise<string> {
  const { key, user } = params;
  // canView は利用者なしを「絞らない」と読むので、ここで先に止める
  if (!user) {
    deny(user, "no user");
  }
  const documentBucket = process.env.DOCUMENT_BUCKET;
  if (!documentBucket) {
    throw new Error("DOCUMENT_BUCKET is not defined");
  }
  const bucket = params.bucket || documentBucket;
  const expiresIn = Math.min(
    Math.max(Number(params.expiresIn) || MAX_EXPIRES_IN, 1),
    MAX_EXPIRES_IN
  );
  const repo =
    params.deps?.repo || (await makePrismaDocumentAccessRepository());
  const viewer = toViewer(user);

  if (bucket === documentBucket) {
    const jobs = await repo.findReviewJobsByDocumentKey(key);
    if (jobs.length === 0) {
      // 審査の文書でないキーは、在るかどうかも答えない
      throw new NotFoundError("Document", key);
    }
    if (!jobs.some((job) => canView(viewer, job))) {
      deny(user, `resource_id=${key}`);
    }
    return getDownloadPresignedUrl(
      bucket,
      key,
      expiresIn,
      downloadResponseHeaders(key)
    );
  }

  if (!params.reviewJobId) {
    deny(user, `bucket=${bucket} without reviewJobId`);
  }
  const job = await repo.findReviewJob(params.reviewJobId!);
  if (!job) {
    throw new NotFoundError("Review job", params.reviewJobId!);
  }
  if (!canView(viewer, job)) {
    deny(user, `resource_id=${job.id}`);
  }
  const sources = await repo.findExternalSources(job.id);
  const allowed = collectS3Locations(sources);
  if (!allowed.has(`${bucket}/${key}`)) {
    deny(user, `bucket=${bucket} not cited in ${job.id}`);
  }
  return getDownloadPresignedUrl(
    bucket,
    key,
    expiresIn,
    downloadResponseHeaders(key)
  );
}

/** アップロードのときにサーバが振る文書 ID（ULID） */
const DOCUMENT_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * アップロードしたまま使われていない文書を消す。
 *
 * 画面は、審査やチェックリストを作る前に選び直したファイルを外すときに、
 * 文書 ID を送ってくる。以前はそれを S3 のキーとしてそのまま消していた。
 * 文書 ID はキーではないので実際には何も消えず、一方でキーを送れば
 * 他人の審査の元の書類でも消せた。
 *
 * いまは文書 ID から、アップロードの場所（uploadAreas の下の
 * `<文書ID>/`）を組み立てて、その下だけを消す。審査・チェックリストの
 * 文書になったものは消さない
 */
export async function deleteUnattachedUpload(params: {
  documentId: string;
  /** アップロードの場所。審査なら review/original/ と review/images/ */
  uploadAreas: string[];
  user: RequestUser;
  deps?: {
    repo?: DocumentAccessRepository;
    listKeys?: (bucket: string, prefix: string) => Promise<string[]>;
    deleteObject?: (bucket: string, key: string) => Promise<unknown>;
  };
}): Promise<void> {
  const { documentId, user } = params;
  const bucket = process.env.DOCUMENT_BUCKET;
  if (!bucket) {
    throw new Error("DOCUMENT_BUCKET is not defined");
  }
  const refuse = (reason: string): never =>
    forbid({
      api: "deleteUnattachedUpload",
      user,
      detail: `resource_id=${documentId}, reason=${reason}`,
    });
  // 文書 ID の形でなければ、場所の外を指せる（"../" や別の場所のキー）
  if (!DOCUMENT_ID.test(documentId)) {
    refuse("not_a_document_id");
  }
  const repo =
    params.deps?.repo || (await makePrismaDocumentAccessRepository());
  if (await repo.isDocumentRegistered(documentId)) {
    refuse("in_use");
  }
  const listKeys = params.deps?.listKeys ?? listS3Keys;
  const deleteObject = params.deps?.deleteObject ?? deleteS3Object;
  for (const area of params.uploadAreas) {
    for (const key of await listKeys(bucket, `${area}${documentId}/`)) {
      await deleteObject(bucket, key);
    }
  }
}

/**
 * 消した審査ジョブのファイルを S3 から消す。審査ジョブを消す処理が、DB の行を
 * 消したあとに呼ぶ。
 *
 * 以前は DB の行だけを消していて、元の書類・画像・前読みの書き起こしが残り
 * 続けた。利用者は審査を消したつもりでも、申込書などの中身が残る。
 *
 * - 元の書類・画像: ほかの審査がまだ指していなければ消す（再審査は元の審査の
 *   文書を引き継ぐので、同じファイルを使っていることがある）。その書類の
 *   前読みの途中経過（digest/partials/<キー>/）も消す
 * - 前読みの書き起こし（digest/<ジョブID>/）: ジョブごとの置き場なので丸ごと消す
 */
export async function deleteReviewJobFiles(params: {
  reviewJobId: string;
  /** 消したジョブの文書のキー（s3Path） */
  documentKeys: string[];
  deps?: {
    repo?: DocumentAccessRepository;
    listKeys?: (bucket: string, prefix: string) => Promise<string[]>;
    deleteObject?: (bucket: string, key: string) => Promise<unknown>;
  };
}): Promise<{ deleted: string[]; keptInUse: string[] }> {
  const bucket = process.env.DOCUMENT_BUCKET;
  if (!bucket) {
    throw new Error("DOCUMENT_BUCKET is not defined");
  }
  const repo =
    params.deps?.repo || (await makePrismaDocumentAccessRepository());
  const listKeys = params.deps?.listKeys ?? listS3Keys;
  const deleteObject = params.deps?.deleteObject ?? deleteS3Object;

  const keys = [...new Set(params.documentKeys)];
  const inUse = await repo.findReferencedKeys(keys);
  const deleted: string[] = [];
  for (const key of keys.filter((k) => !inUse.has(k))) {
    await deleteObject(bucket, key);
    deleted.push(key);
    for (const partial of await listKeys(bucket, `digest/partials/${key}/`)) {
      await deleteObject(bucket, partial);
      deleted.push(partial);
    }
  }
  for (const digest of await listKeys(
    bucket,
    `digest/${params.reviewJobId}/`
  )) {
    await deleteObject(bucket, digest);
    deleted.push(digest);
  }
  return { deleted, keptInUse: keys.filter((k) => inUse.has(k)) };
}
