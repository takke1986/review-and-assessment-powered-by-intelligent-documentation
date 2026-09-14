/**
 * 審査結果の根拠にする文書を決める。
 *
 * 審査処理は、判定の根拠にしたファイルとそのページを sources で返す
 * （例: [{ file: "見積書.pdf", page: 2 }]）。審査に渡した文書のうち、名前が合う
 * ものだけを根拠にする。sources が無いとき、合う文書が無いときは、これまでどおり
 * 審査に渡したすべての文書を根拠にする。
 *
 * ページ番号は PDF にだけ付ける。Word・Excel・PowerPoint にはページが無く、
 * ページを付けると結果画面が PDF のページを切り出そうとする。
 */
export interface SourceDocument {
  documentId: string;
  filename: string;
  pageNumber?: number;
}

const isPdf = (filename: string) => filename.toLowerCase().endsWith(".pdf");

// 利用者が付けた名前と、モデルが書き写した名前の、表記の揺れ（濁点の合成など）を吸収する
const normalizeName = (name: string) =>
  name.trim().normalize("NFC").toLowerCase();

const parseSources = (
  sources: unknown
): Array<{ file: string; page?: number }> => {
  if (!Array.isArray(sources)) {
    return [];
  }
  return sources.flatMap((source) => {
    if (!source || typeof source !== "object") {
      return [];
    }
    const { file, page } = source as { file?: unknown; page?: unknown };
    if (typeof file !== "string" || !file.trim()) {
      return [];
    }
    return [
      {
        file,
        page:
          typeof page === "number" && Number.isInteger(page) && page >= 1
            ? page
            : undefined,
      },
    ];
  });
};

export const selectSourceDocuments = (params: {
  /** ジョブの文書 */
  documents: Array<{ id: string; filename: string }>;
  /** 審査に渡した文書 */
  documentIds: string[];
  /** 審査処理が返した sources */
  sources?: unknown;
  /** sources を返さない審査処理が返すページ番号 */
  pageNumber?: number;
}): SourceDocument[] => {
  const reviewed = params.documentIds.map((documentId) => ({
    documentId,
    filename:
      params.documents.find((doc) => doc.id === documentId)?.filename ?? "",
  }));

  const selected: SourceDocument[] = [];
  const seen = new Set<string>();
  for (const source of parseSources(params.sources)) {
    const name = normalizeName(source.file);
    for (const doc of reviewed) {
      if (normalizeName(doc.filename) !== name) {
        continue;
      }
      const pageNumber = isPdf(doc.filename) ? source.page : undefined;
      const key = `${doc.documentId}:${pageNumber ?? ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        selected.push({ ...doc, pageNumber });
      }
    }
  }
  if (selected.length > 0) {
    return selected;
  }

  return reviewed.map((doc) => ({
    ...doc,
    pageNumber: isPdf(doc.filename) ? params.pageNumber || 1 : undefined,
  }));
};
