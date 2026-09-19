/**
 * チェックリストワークフロー共通の型定義
 */

export interface ProcessDocumentResult {
  documentId: string;
  pageCount: number;
  pages: { pageNumber: number }[];
  /** ページの持ち方。Office ファイルは変換後に md になる */
  pageFormat: "pdf" | "md";
  /**
   * Office ファイルなので、この後で変換の Lambda を通す必要がある。
   *
   * PDF でも false を必ず返す。ワークフローの分岐がこの値を見るので、
   * 省略すると「存在しないパスの比較」になり、振る舞いが Step Functions の
   * 仕様任せになる。そこを外すと PDF の取り込みが丸ごと止まる
   */
  needsOfficeConversion: boolean;
}

export interface ExtractTextResult {
  documentId: string;
  pageNumber: number;
}

export interface ParsedChecklistItem {
  id: string;
  name: string;
  description: string;
  parent_id: string | null;
}

export interface ProcessWithLLMResult {
  documentId: string;
  pageNumber: number;
}

export interface CombinePageResult {
  documentId: string;
  pageNumber: number;
}

export interface AggregatePageResult {
  documentId: string;
}
