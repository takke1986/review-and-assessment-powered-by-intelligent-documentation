import { ValidationError } from "../../../../core/errors";

/**
 * 子を持たない項目の結果だけを返す。
 * 子を持つ親項目は、子の結果から判定を集計するので審査の対象にならない。
 */
export const leafResults = <
  T extends { checkId: string; checkList: { parentId?: string } },
>(
  results: T[]
): T[] => {
  const parentIds = new Set(
    results
      .map((result) => result.checkList.parentId)
      .filter((parentId): parentId is string => !!parentId)
  );
  return results.filter((result) => !parentIds.has(result.checkId));
};

/**
 * 審査するチェック項目を決める。
 *
 * checkIds を省略するとすべての項目を返す。指定した場合は、指定した項目に加えて
 * - 子孫: 親を指定したら、その配下もすべて審査する
 * - 祖先: 審査結果のツリー表示と、子の結果から親の判定を決める集計に必要
 * を含める。審査の実行と集計はジョブにある結果だけを見るため、
 * ここで結果を作らなかった項目は審査されない。
 */
export const selectCheckItems = <T extends { id: string; parentId?: string }>(
  items: T[],
  checkIds?: string[]
): T[] => {
  if (checkIds === undefined) {
    return items;
  }
  if (checkIds.length === 0) {
    throw new ValidationError("At least one check item is required");
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  const unknownIds = checkIds.filter((id) => !byId.has(id));
  if (unknownIds.length > 0) {
    throw new ValidationError(
      `Check items not found in the checklist set: ${unknownIds.join(", ")}`
    );
  }

  const childrenOf = new Map<string, string[]>();
  for (const item of items) {
    if (item.parentId) {
      const siblings = childrenOf.get(item.parentId) ?? [];
      siblings.push(item.id);
      childrenOf.set(item.parentId, siblings);
    }
  }

  const selected = new Set<string>();
  const addWithDescendants = (id: string) => {
    if (selected.has(id)) return;
    selected.add(id);
    for (const childId of childrenOf.get(id) ?? []) {
      addWithDescendants(childId);
    }
  };
  checkIds.forEach(addWithDescendants);

  for (const id of Array.from(selected)) {
    let parentId = byId.get(id)?.parentId;
    while (parentId && !selected.has(parentId)) {
      selected.add(parentId);
      parentId = byId.get(parentId)?.parentId;
    }
  }

  return items.filter((item) => selected.has(item.id));
};
