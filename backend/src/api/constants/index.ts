export const MAX_FILE_SIZE = 4.5 * 1024 * 1024; // 4.5MB (Bedrock Converse API制限)

/**
 * Word・Excel・PowerPoint の1ファイルの上限。
 *
 * 審査処理が XML から Markdown に変換し、埋め込み画像は別に選んで渡すので、
 * Bedrock の文書の上限（4.5MB）には縛られない。画像の多いファイルも通るように、
 * 変換にかかる時間とメモリで決めている。フロントエンドと同じ値にする。
 */
export const MAX_OFFICE_FILE_SIZE = 30 * 1024 * 1024; // 30MB

const OFFICE_FILE_EXTENSIONS = [".docx", ".xlsx", ".pptx"];

/** ファイルの種類ごとの、1ファイルの上限 */
export const maxFileSizeFor = (filename: string): number =>
  OFFICE_FILE_EXTENSIONS.some((extension) =>
    filename.toLowerCase().endsWith(extension)
  )
    ? MAX_OFFICE_FILE_SIZE
    : MAX_FILE_SIZE;

/**
 * 1つの審査ジョブに指定できるドキュメントの最大数。
 *
 * Presigned URL 発行時と審査ジョブ作成時の両方で同じ値を使う。
 * 片方だけ変更されると、アップロードは通るのにジョブ作成で弾かれる。
 */
export const MAX_REVIEW_DOCUMENTS = 20;

/** 再審査の変更メモの最大文字数 */
export const MAX_REVISION_NOTE_LENGTH = 1000;
