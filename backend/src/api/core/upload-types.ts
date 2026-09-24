import { ValidationError } from "./errors";

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
