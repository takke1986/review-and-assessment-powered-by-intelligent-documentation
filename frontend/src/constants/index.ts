export const MAX_FILE_SIZE = 4.5 * 1024 * 1024; // 4.5MB

/**
 * 1つの審査ジョブに指定できるドキュメントの最大数。
 * バックエンドの MAX_REVIEW_DOCUMENTS と同じ値にする。
 */
export const MAX_REVIEW_DOCUMENTS = 20;

/** 再審査の変更メモの最大文字数（バックエンドと揃える） */
export const MAX_REVISION_NOTE_LENGTH = 1000;
