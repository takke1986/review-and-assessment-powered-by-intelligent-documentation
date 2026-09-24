import type { HTMLAttributes, KeyboardEvent, MouseEvent } from "react";
import { useNavigate } from "react-router-dom";

const ROW = "border-t border-light-gray";
// 共通の Table（チェックリスト・審査などの一覧）で行を押せるときと同じ見た目
const CLICKABLE = "cursor-pointer transition-colors hover:bg-aws-paper-light";

/**
 * 表の行を押したら遷移させる。他の一覧と挙動をそろえるため。
 *
 * 行の中のリンクやボタンを押したときは、それ自身の動作を優先する。
 * 行に遷移用のリンクを置かなくなるので、キーボードでも Enter で移れるようにする。
 * 遷移先が無い行（to が null）は押せない普通の行にする
 */
export function useRowLink() {
  const navigate = useNavigate();
  return (to: string | null): HTMLAttributes<HTMLTableRowElement> => {
    if (!to) {
      return { className: ROW };
    }
    return {
      className: `${ROW} ${CLICKABLE}`,
      role: "link",
      tabIndex: 0,
      onClick: (event: MouseEvent<HTMLTableRowElement>) => {
        if ((event.target as HTMLElement).closest("a, button")) return;
        navigate(to);
      },
      onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
        if (event.key === "Enter") navigate(to);
      },
    };
  };
}
