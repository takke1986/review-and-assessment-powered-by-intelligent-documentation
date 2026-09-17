export const MAX_FILE_SIZE = 4.5 * 1024 * 1024; // 4.5MB (Bedrock Converse API制限)

/**
 * Word・Excel・PowerPoint の1ファイルの上限。
 *
 * 審査処理が XML から Markdown に変換し、埋め込み画像は別に選んで渡すので、
 * Bedrock の文書の上限（4.5MB）には縛られない。画像の多いファイルも通るように、
 * 変換にかかる時間とメモリで決めている。フロントエンドと同じ値にする。
 */
export const MAX_OFFICE_FILE_SIZE = 30 * 1024 * 1024; // 30MB

/**
 * 審査する PDF の1ファイルの上限。
 *
 * 1回の呼び出しに収まらない PDF（4.5MB 超・合計100ページ超）は、審査処理がツールで
 * ページを少しずつ読むので、Bedrock の文書の上限には縛られない。フロントエンドと同じ値にする。
 */
export const MAX_REVIEW_PDF_FILE_SIZE = 100 * 1024 * 1024; // 100MB

/**
 * 審査する画像の1ファイルの上限。審査処理が Bedrock の上限（3.75MB・一辺8000px）に
 * 収まるよう縮小してから読む。フロントエンドと同じ値にする。
 */
export const MAX_REVIEW_IMAGE_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const OFFICE_FILE_EXTENSIONS = [".docx", ".xlsx", ".pptx"];
const IMAGE_FILE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".webp",
];

const hasExtension = (filename: string, extensions: string[]): boolean =>
  extensions.some((extension) => filename.toLowerCase().endsWith(extension));

/** 審査するファイルの種類ごとの、1ファイルの上限 */
export const maxFileSizeFor = (filename: string): number => {
  if (hasExtension(filename, OFFICE_FILE_EXTENSIONS)) {
    return MAX_OFFICE_FILE_SIZE;
  }
  if (hasExtension(filename, [".pdf"])) {
    return MAX_REVIEW_PDF_FILE_SIZE;
  }
  if (hasExtension(filename, IMAGE_FILE_EXTENSIONS)) {
    return MAX_REVIEW_IMAGE_FILE_SIZE;
  }
  return MAX_FILE_SIZE;
};

/**
 * 1つの審査ジョブに指定できるドキュメントの最大数。
 *
 * Presigned URL 発行時と審査ジョブ作成時の両方で同じ値を使う。
 * 片方だけ変更されると、アップロードは通るのにジョブ作成で弾かれる。
 */
export const MAX_REVIEW_DOCUMENTS = 20;

/** 再審査の変更メモの最大文字数 */
export const MAX_REVISION_NOTE_LENGTH = 1000;

// 着眼点の上限。長すぎると費用が読めなくなり、本来の指示も薄まる
export const MAX_REVIEW_GUIDANCE_LENGTH = 2000;
