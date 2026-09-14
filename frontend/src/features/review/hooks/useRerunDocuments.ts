import { useEffect, useState } from "react";
import { ReviewJobDetail } from "../types";

/**
 * 再審査で、元のジョブの文書をどう扱うかを持つ。
 *
 * - 元の文書は最初はすべて引き継ぐ。変更していない文書が外れると、複数の文書を
 *   見比べる項目が片方の文書だけで審査されてしまう
 * - アップロードした文書と同じ名前の元の文書が1つだけあれば、差し替え対象にしておく
 * - 引き継ぐ文書は、引き継ぐと選ばれていて、差し替えられていないもの
 */
export function useRerunDocuments(params: {
  sourceJob: ReviewJobDetail | null;
  uploadedDocuments: Array<{ documentId: string; filename: string }>;
}) {
  const { sourceJob, uploadedDocuments } = params;

  // 引き継ぐ元の文書（読み込むまでは null）と、アップロードした文書
  // （ドキュメントID）ごとの差し替え対象（空文字は追加）
  const [keptSourceDocumentIds, setKeptSourceDocumentIds] =
    useState<Set<string> | null>(null);
  const [replacements, setReplacements] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!sourceJob || keptSourceDocumentIds !== null) {
      return;
    }
    setKeptSourceDocumentIds(new Set(sourceJob.documents.map((doc) => doc.id)));
  }, [sourceJob, keptSourceDocumentIds]);

  useEffect(() => {
    if (!sourceJob) {
      return;
    }
    setReplacements((current) => {
      const next = { ...current };
      let changed = false;
      for (const doc of uploadedDocuments) {
        if (doc.documentId in next) {
          continue;
        }
        const taken = new Set(Object.values(next));
        const sameName = sourceJob.documents.filter(
          (source) => source.filename === doc.filename && !taken.has(source.id)
        );
        next[doc.documentId] = sameName.length === 1 ? sameName[0].id : "";
        changed = true;
      }
      return changed ? next : current;
    });
  }, [sourceJob, uploadedDocuments]);

  const replacedSourceDocumentIds = new Set(
    uploadedDocuments
      .map((doc) => replacements[doc.documentId])
      .filter((id): id is string => !!id)
  );
  const keptDocumentIds = sourceJob
    ? sourceJob.documents
        .map((doc) => doc.id)
        .filter(
          (id) =>
            keptSourceDocumentIds?.has(id) && !replacedSourceDocumentIds.has(id)
        )
    : [];

  const toggleKept = (sourceDocumentId: string) =>
    setKeptSourceDocumentIds((current) => {
      const next = new Set(current ?? []);
      if (next.has(sourceDocumentId)) {
        next.delete(sourceDocumentId);
      } else {
        next.add(sourceDocumentId);
      }
      return next;
    });

  const setReplacement = (uploadedDocumentId: string, sourceId: string) =>
    setReplacements((current) => ({
      ...current,
      [uploadedDocumentId]: sourceId,
    }));

  return {
    keptSourceDocumentIds,
    replacements,
    keptDocumentIds,
    toggleKept,
    setReplacement,
  };
}
