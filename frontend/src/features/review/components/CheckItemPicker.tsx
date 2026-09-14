import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../../components/Button";
import { useChecklistItems } from "../../checklist/hooks/useCheckListItemQueries";
import { CheckListItemDetail } from "../../checklist/types";

export interface CheckItemPickerProps {
  setId: string;
  /** 選択中の、子を持たない項目のID */
  selectedIds: Set<string>;
  /** 選択が変わったとき。total は選べる項目（子を持たない項目）の数 */
  onChange: (selectedIds: Set<string>, total: number) => void;
  /** 最初に選んでおく項目。省略するとすべての項目 */
  initialSelectedIds?: string[];
  /** 印を付ける項目と、その印の文言（再審査で前回不合格だった項目など） */
  markedIds?: Set<string>;
  markLabel?: string;
  /** 説明文。省略すると通常の審査向けの説明 */
  helpText?: string;
}

/**
 * 審査するチェック項目を選ぶ。
 *
 * 選べるのは子を持たない項目で、親のチェックは配下の項目をまとめて切り替える。
 * チェックリストを選ぶと、initialSelectedIds（省略時はすべての項目）を
 * 選んだ状態から始まる。
 */
export default function CheckItemPicker({
  setId,
  selectedIds,
  onChange,
  initialSelectedIds,
  markedIds,
  markLabel,
  helpText,
}: CheckItemPickerProps) {
  const { t } = useTranslation();
  const { items, isLoading, error } = useChecklistItems(setId, undefined, true);

  const { roots, childrenOf, leavesUnder, leafIds } = useMemo(() => {
    const itemIds = new Set(items.map((item) => item.id));
    const childrenOf = new Map<string, CheckListItemDetail[]>();
    const roots: CheckListItemDetail[] = [];
    for (const item of items) {
      if (item.parentId && itemIds.has(item.parentId)) {
        const siblings = childrenOf.get(item.parentId) ?? [];
        siblings.push(item);
        childrenOf.set(item.parentId, siblings);
      } else {
        roots.push(item);
      }
    }

    // 各項目の配下にある、子を持たない項目
    const leavesUnder = new Map<string, string[]>();
    const collect = (item: CheckListItemDetail): string[] => {
      const children = childrenOf.get(item.id);
      const leaves = children ? children.flatMap(collect) : [item.id];
      leavesUnder.set(item.id, leaves);
      return leaves;
    };
    const leafIds = roots.flatMap(collect);

    return { roots, childrenOf, leavesUnder, leafIds };
  }, [items]);

  // チェックリストごとに一度だけ、最初の選択にする。
  // 再取得のたびに戻すと、利用者が外した項目がまた選ばれてしまう
  const initializedFor = useRef<string | null>(null);
  useEffect(() => {
    if (isLoading || error || items.length === 0) {
      return;
    }
    if (initializedFor.current === setId) {
      return;
    }
    initializedFor.current = setId;
    const leaves = new Set(leafIds);
    const initial = initialSelectedIds
      ? initialSelectedIds.filter((id) => leaves.has(id))
      : leafIds;
    onChange(new Set(initial), leafIds.length);
  }, [
    setId,
    isLoading,
    error,
    items.length,
    leafIds,
    initialSelectedIds,
    onChange,
  ]);

  const setLeaves = (leaves: string[], selected: boolean) => {
    const next = new Set(selectedIds);
    leaves.forEach((id) => (selected ? next.add(id) : next.delete(id)));
    onChange(next, leafIds.length);
  };

  const renderItem = (item: CheckListItemDetail, level: number) => {
    const leaves = leavesUnder.get(item.id) ?? [item.id];
    const selectedCount = leaves.filter((id) => selectedIds.has(id)).length;
    const allSelected = selectedCount === leaves.length;
    const children = childrenOf.get(item.id);

    return (
      <li key={item.id}>
        <label
          className="flex cursor-pointer items-start gap-2 py-1"
          style={{ paddingLeft: `${level * 1.25}rem` }}>
          <input
            type="checkbox"
            className="mt-1"
            checked={allSelected}
            ref={(el) => {
              if (el) {
                el.indeterminate = selectedCount > 0 && !allSelected;
              }
            }}
            onChange={() => setLeaves(leaves, !allSelected)}
          />
          <span className="text-sm text-aws-squid-ink-light dark:text-aws-font-color-white-dark">
            {item.name}
          </span>
          {markLabel && markedIds?.has(item.id) && (
            <span className="bg-red-100 text-red-800 rounded-full px-2 py-0.5 text-xs">
              {markLabel}
            </span>
          )}
        </label>
        {children && (
          <ul>{children.map((child) => renderItem(child, level + 1))}</ul>
        )}
      </li>
    );
  };

  return (
    <div className="rounded-md border border-light-gray bg-white p-4 shadow-sm dark:bg-aws-squid-ink-dark">
      <h3 className="text-lg font-medium text-aws-squid-ink-light dark:text-aws-font-color-white-dark">
        {t("review.checkItemSelection")}
      </h3>
      <p className="mt-1 text-sm text-aws-font-color-gray">
        {helpText ?? t("review.checkItemSelectionHelp")}
      </p>

      {isLoading ? (
        <div className="flex items-center justify-center p-8">
          <div className="border-primary h-8 w-8 animate-spin rounded-full border-b-2 border-t-2"></div>
        </div>
      ) : error ? (
        <p className="mt-3 text-sm text-red">
          {t("checklist.itemsFetchError")}
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-aws-squid-ink-light dark:text-aws-font-color-white-dark">
              {t("review.checkItemsSelected", {
                selected: selectedIds.size,
                total: leafIds.length,
              })}
            </span>
            <Button
              type="button"
              variant="text"
              size="sm"
              onClick={() => setLeaves(leafIds, true)}>
              {t("review.selectAllCheckItems")}
            </Button>
            <Button
              type="button"
              variant="text"
              size="sm"
              onClick={() => setLeaves(leafIds, false)}>
              {t("review.clearCheckItems")}
            </Button>
          </div>
          {selectedIds.size === 0 && (
            <p className="mt-1 text-sm text-red">
              {t("review.checkItemRequired")}
            </p>
          )}
          <ul className="mt-2 max-h-80 overflow-y-auto">
            {roots.map((root) => renderItem(root, 0))}
          </ul>
        </>
      )}
    </div>
  );
}
