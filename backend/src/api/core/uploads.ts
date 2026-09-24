import { ulid } from "ulid";
import { ValidationError } from "./errors";
import { getPresignedUrl } from "./s3";

/**
 * 受け付けるファイルの種類。
 *
 * 画面では形式を絞っているが、API は誰でも直接呼べる。以前はファイル名も
 * Content-Type も確かめずにアップロード先に署名していたので、`.html` を
 * `text/html` として上げて審査にかけ、「開く」で S3 のドメインのまま
 * スクリプトを動かせた（同じ部署の人に偽のログイン画面を見せられる）。
 *
 * そこで拡張子を許可制にし、Content-Type はサーバが拡張子から決める。
 * 画面はサーバが返した Content-Type でアップロードする
 */
const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".webp": "image/webp",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
};

const OFFICE = [".docx", ".xlsx", ".pptx"];
const IMAGES = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".webp",
];

/** 審査にかける文書（PDF・Office・画像） */
export const REVIEW_UPLOAD_EXTENSIONS = [".pdf", ...OFFICE, ...IMAGES];
/** 審査の画像のアップロード先 */
export const REVIEW_IMAGE_EXTENSIONS = IMAGES;
/** チェックリストの元にする文書 */
export const CHECKLIST_UPLOAD_EXTENSIONS = [
  ".pdf",
  ...OFFICE,
  ".txt",
  ".md",
  ".csv",
];

/** ブラウザでそのまま開いてよい種類。スクリプトを含められない */
const INLINE_EXTENSIONS = [".pdf", ...IMAGES];

const extensionOf = (name: string): string => {
  const base = name.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
};

/**
 * 受け付ける種類なら、その Content-Type を返す。受け付けなければ弾く
 */
export function uploadContentTypeOrThrow(
  filename: string,
  allowed: string[]
): string {
  const extension = extensionOf(filename);
  if (!allowed.includes(extension) || !CONTENT_TYPES[extension]) {
    throw new ValidationError(
      `Unsupported file type: ${extension || "(none)"}`
    );
  }
  return CONTENT_TYPES[extension];
}

/**
 * ダウンロードのときに S3 に返させるヘッダ。
 *
 * S3 はアップロード時の Content-Type をそのまま返すので、上の許可制より
 * 前に上がったファイルや、ナレッジベースのバケットのファイルは何が付いて
 * いるか分からない。拡張子から決め直し、PDF と画像以外は保存させる
 * （ブラウザで開かせない）
 */
export function downloadResponseHeaders(key: string): {
  contentType: string;
  contentDisposition: string;
} {
  const extension = extensionOf(key);
  const filename = key.split("/").pop() || "download";
  const inline = INLINE_EXTENSIONS.includes(extension);
  return {
    contentType: inline
      ? CONTENT_TYPES[extension]
      : (CONTENT_TYPES[extension] ?? "application/octet-stream"),
    contentDisposition: `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
  };
}

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

/**
 * アップロード先を1つ発行する。拡張子から Content-Type を決め、文書 ID を振り、
 * keyFor で決まる場所に署名する。画面はここで返す Content-Type でアップロードする
 */
export async function presignUpload(
  filename: string,
  allowed: string[],
  keyFor: (documentId: string, filename: string) => string
): Promise<{
  url: string;
  key: string;
  filename: string;
  documentId: string;
  contentType: string;
}> {
  const bucket = process.env.DOCUMENT_BUCKET;
  if (!bucket) {
    throw new Error("DOCUMENT_BUCKET is not defined");
  }
  // 送られてきた Content-Type は使わず、拡張子から決める
  const contentType = uploadContentTypeOrThrow(filename, allowed);
  const documentId = ulid();
  const key = keyFor(documentId, filename);
  const url = await getPresignedUrl(bucket, key, contentType);
  return { url, key, filename, documentId, contentType };
}
