import { deleteS3Object, listS3Keys } from "../../../core/s3";
import { documentBucket } from "../../../core/uploads";
import type { RequestUser } from "../../../core/middleware/authorization";
import { forbid } from "../../../core/access/forbid";
import {
  FileReferenceRepository,
  makePrismaFileReferenceRepository,
} from "../domain/file-references";

/**
 * 文書バケットのファイルを消す処理。審査とチェックリストの両方から使う。
 *
 * S3 のどこに何があるか:
 * - review/original/<文書ID>/…, review/images/<文書ID>/… : 審査の元の書類・画像
 * - digest/<ジョブID>/<文書のキー>.json : 審査の前読みの書き起こし（ジョブごと）
 * - digest/partials/<文書のキー>/… : 前読みの途中経過（普段は保存後に消える）
 * - checklist/original/<文書ID>/… : チェックリストの元の書類
 * - checklist/{processed,pages,llm_ocr,aggregate}/<文書ID>/… : そこから作ったもの
 *
 * 以前は、審査やチェックリストを消しても DB の行だけが消え、これらのファイルは
 * 残り続けた。どの処理も「DB の行を消したあと」に呼ぶ。先にファイルを消すと、
 * DB の削除が失敗したときにファイルの無い行が残る
 */

export interface FileStoreDeps {
  repo?: FileReferenceRepository;
  listKeys?: (bucket: string, prefix: string) => Promise<string[]>;
  deleteObject?: (bucket: string, key: string) => Promise<unknown>;
}

interface DeleteResult {
  deleted: string[];
  /** ほかの行がまだ指しているので残したキー */
  keptInUse: string[];
}

const open = async (deps?: FileStoreDeps) => {
  const bucket = documentBucket();
  const repo = deps?.repo || (await makePrismaFileReferenceRepository());
  const listKeys = deps?.listKeys ?? listS3Keys;
  const deleteObject = deps?.deleteObject ?? deleteS3Object;
  const deleted: string[] = [];
  return {
    repo,
    deleted,
    deleteKey: async (key: string) => {
      await deleteObject(bucket, key);
      deleted.push(key);
    },
    deleteUnder: async (prefix: string) => {
      for (const key of await listKeys(bucket, prefix)) {
        await deleteObject(bucket, key);
        deleted.push(key);
      }
    },
  };
};

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
 * いまは文書 ID から、アップロードの場所（uploadAreas の下の `<文書ID>/`）を
 * 組み立てて、その下だけを消す。審査・チェックリストの文書になったものは消さない
 */
export async function deleteUnattachedUpload(params: {
  documentId: string;
  /** アップロードの場所。審査なら review/original/ と review/images/ */
  uploadAreas: string[];
  user: RequestUser;
  deps?: FileStoreDeps;
}): Promise<void> {
  const { documentId, user } = params;
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
  const store = await open(params.deps);
  if (await store.repo.isDocumentRegistered(documentId)) {
    refuse("in_use");
  }
  for (const area of params.uploadAreas) {
    await store.deleteUnder(`${area}${documentId}/`);
  }
}

/**
 * 消した審査ジョブのファイルを消す。
 *
 * - 元の書類・画像: ほかの審査がまだ指していなければ消す（再審査は元の審査の
 *   文書を引き継ぐ）。その書類の前読みの途中経過も消す
 * - 前読みの書き起こし: ジョブごとの置き場なので丸ごと消す
 */
export async function deleteReviewJobFiles(params: {
  reviewJobId: string;
  /** 消したジョブの文書のキー（s3Path） */
  documentKeys: string[];
  deps?: FileStoreDeps;
}): Promise<DeleteResult> {
  const store = await open(params.deps);
  const keys = [...new Set(params.documentKeys)];
  const inUse = await store.repo.findReferencedReviewKeys(keys);
  for (const key of keys.filter((k) => !inUse.has(k))) {
    await store.deleteKey(key);
    await store.deleteUnder(`digest/partials/${key}/`);
  }
  await store.deleteUnder(`digest/${params.reviewJobId}/`);
  return {
    deleted: store.deleted,
    keptInUse: keys.filter((k) => inUse.has(k)),
  };
}

/** チェックリストの文書から作られるファイルの置き場。文書 ID ごとに分かれている */
const CHECKLIST_DERIVED_AREAS = [
  "checklist/processed/",
  "checklist/pages/",
  "checklist/llm_ocr/",
  "checklist/aggregate/",
];

/**
 * 消したチェックリストのファイルを消す。
 *
 * - 元の書類: ほかのチェックリストの文書がまだ指していなければ消す（複製すると、
 *   複製先は複製元のファイルを共有する）
 * - ページの画像・読み取り結果など: その文書 ID の下にしか無いので丸ごと消す
 */
export async function deleteCheckListFiles(params: {
  documents: Array<{ id: string; s3Key: string }>;
  deps?: FileStoreDeps;
}): Promise<DeleteResult> {
  const store = await open(params.deps);
  const originals = [...new Set(params.documents.map((doc) => doc.s3Key))];
  const inUse = await store.repo.findReferencedChecklistKeys(originals);
  for (const key of originals.filter((k) => !inUse.has(k))) {
    await store.deleteKey(key);
  }
  for (const doc of params.documents) {
    for (const area of CHECKLIST_DERIVED_AREAS) {
      await store.deleteUnder(`${area}${doc.id}/`);
    }
  }
  return {
    deleted: store.deleted,
    keptInUse: originals.filter((k) => inUse.has(k)),
  };
}
