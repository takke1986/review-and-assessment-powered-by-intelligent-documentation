export const MAX_FILE_SIZE = 4.5 * 1024 * 1024; // 4.5MB

/**
 * Word・Excel・PowerPoint の1ファイルの上限。審査処理が Markdown に変換して渡すので、
 * Bedrock の文書の上限（4.5MB）より大きくできる。バックエンドと同じ値にする。
 */
export const MAX_OFFICE_FILE_SIZE = 30 * 1024 * 1024; // 30MB

/**
 * 審査する PDF の1ファイルの上限。1回の呼び出しに収まらない PDF は審査処理がツールで
 * ページを少しずつ読むので、Bedrock の文書の上限より大きくできる。バックエンドと同じ値にする。
 */
export const MAX_REVIEW_PDF_FILE_SIZE = 100 * 1024 * 1024; // 100MB

/**
 * 審査する画像の1ファイルの上限。審査処理が Bedrock の上限に収まるよう縮小してから読む。
 * バックエンドと同じ値にする。
 */
export const MAX_REVIEW_IMAGE_FILE_SIZE = 20 * 1024 * 1024; // 20MB

/**
 * 1つの審査ジョブに指定できるドキュメントの最大数。
 * バックエンドの MAX_REVIEW_DOCUMENTS と同じ値にする。
 */
export const MAX_REVIEW_DOCUMENTS = 20;

/** 再審査の変更メモの最大文字数（バックエンドと揃える） */
export const MAX_REVISION_NOTE_LENGTH = 1000;
