/**
 * 審査結果の根拠にする文書を決める。
 *
 * 審査処理は、判定の根拠にしたファイルとその中のどこかを sources で返す
 * （例: [{ file: "見積書.pdf", page: 2 }]）。審査に渡した文書のうち、名前が合う
 * ものだけを根拠にする。sources が無いとき、合う文書が無いときは、これまでどおり
 * 審査に渡したすべての文書を根拠にする。
 *
 * 場所の表し方は書類の種類で変わる。
 *
 *   PDF    → pageNumber。結果画面はこれでページを切り出す
 *   Office → label（"Slide 3" や "Sheet: 売上高"）と、道具で読んだときは section。
 *            .docx がページ割りを保存しないなど、ページという単位が無いため
 *   画像   → どれも付かない
 *
 * PDF 以外に pageNumber を付けてはいけない。結果画面が PDF のページを
 * 切り出そうとして失敗する。
 */
export interface SourceDocument {
  documentId: string;
  filename: string;
  pageNumber?: number;
  /** 道具で読んだ Office の節番号（list_documents が振ったもの） */
  section?: number;
  /** 書類の中のどこか。"Slide 3" や "Sheet: 売上高" など、本文の見出しのまま */
  label?: string;
}

const isPdf = (filename: string) => filename.toLowerCase().endsWith(".pdf");

// 利用者が付けた名前と、モデルが書き写した名前の、表記の揺れ（濁点の合成など）を吸収する
const normalizeName = (name: string) =>
  name.trim().normalize("NFC").toLowerCase();

const positiveInt = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : undefined;

const nonEmptyText = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const parseSources = (
  sources: unknown
): Array<{ file: string; page?: number; section?: number; label?: string }> => {
  if (!Array.isArray(sources)) {
    return [];
  }
  return sources.flatMap((source) => {
    if (!source || typeof source !== "object") {
      return [];
    }
    const { file, page, section, label } = source as {
      file?: unknown;
      page?: unknown;
      section?: unknown;
      label?: unknown;
    };
    if (typeof file !== "string" || !file.trim()) {
      return [];
    }
    return [
      {
        file,
        page: positiveInt(page),
        section: positiveInt(section),
        label: nonEmptyText(label),
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
      // PDF はページで、それ以外は節と見出しで場所を表す。混ぜると
      // 結果画面が Office のファイルから PDF のページを切り出そうとする
      const pdf = isPdf(doc.filename);
      const place = pdf
        ? { pageNumber: source.page }
        : { section: source.section, label: source.label };
      // 同じ場所を二度並べない。鍵は実際に残す場所から作る。source の
      // ままだと、PDF に付いてきた label 違いで同じページが二重に出る
      const key = [
        doc.documentId,
        place.pageNumber ?? "",
        place.section ?? "",
        place.label ?? "",
      ].join(":");
      if (!seen.has(key)) {
        seen.add(key);
        selected.push({ ...doc, ...place });
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
