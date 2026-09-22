"""モデルが返した「判定の根拠にした場所」を整える。

根拠の場所は書類の種類で表し方が変わる（PDF はページ、Office は見出し）。
形の崩れた値を捨て、残すものだけをそろえてから後段（backend）へ渡す。
ここで捨てると、根拠の場所は explanation の文章にしか残らない。

agent.py から切り出した。
"""

from typing import Any


# 根拠の場所を表す文字列の上限。"Slide 3" や "Sheet: 売上高" を想定していて、
# 本文の抜き書きを入れる欄ではない。長いものは切る
MAX_SOURCE_LABEL_CHARS = 80


def _positive_int(value: Any) -> int | None:
    """1 以上の整数だけを通す。True は 1 として通さない（bool は int の子）"""
    return value if type(value) is int and value >= 1 else None


def _normalize_sources(sources: Any) -> list[dict[str, Any]]:
    """
    モデルが返した、判定の根拠にしたファイルと、その中のどこか。
    形の崩れたものは捨てる。

    場所の表し方は書類の種類で変わる。

        PDF     → page（ページ番号）
        Office  → label（"Slide 3" や "Sheet: 売上高" など、本文に出てくる見出し）と、
                  道具で読んだときは section（list_documents が振った節番号）
        画像    → どれも None

    Office に page を入れないのは、.docx がページ割りを保存しないなど、
    種類によってはページという単位が無いため。代わりに label を持たせている。
    ここで捨てると、根拠の場所が explanation の文章にしか残らなくなる
    """
    normalized = []
    for source in sources if isinstance(sources, list) else []:
        if not isinstance(source, dict) or not isinstance(source.get("file"), str):
            continue
        label = source.get("label")
        label = label.strip()[:MAX_SOURCE_LABEL_CHARS] if isinstance(label, str) else ""
        normalized.append(
            {
                "file": source["file"].strip(),
                "page": _positive_int(source.get("page")),
                "section": _positive_int(source.get("section")),
                "label": label or None,
            }
        )
    return [source for source in normalized if source["file"]]
