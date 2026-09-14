"""Office Open XML を読み、Markdown に書くための小さな道具"""

from __future__ import annotations

from typing import Iterator, Optional
from xml.etree import ElementTree as ET

NAMESPACES = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
    "s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "xdr": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
    "dgm": "http://schemas.openxmlformats.org/drawingml/2006/diagram",
    "v": "urn:schemas-microsoft-com:vml",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "cp": "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties",
}

# 部品の関係。ID → (種類の URI, 参照先の部品名)
Relationships = dict[str, tuple[str, str]]


def q(name: str) -> str:
    """'w:p' を ElementTree のタグ名 '{名前空間}p' にする"""
    prefix, local = name.split(":")
    return f"{{{NAMESPACES[prefix]}}}{local}"


MC_ALTERNATE = q("mc:AlternateContent")
MC_FALLBACK = q("mc:Fallback")


def walk(
    element: Optional[ET.Element], skip: tuple[str, ...] = ()
) -> Iterator[ET.Element]:
    """
    子孫を文書の順にたどる。互換用の代わりの表現（mc:Fallback）には入らない。
    入ると、同じ図形やテキストボックスを2回数える。
    """
    if element is None:
        return
    yield element
    for element_child in element:
        if element_child.tag == MC_FALLBACK or element_child.tag in skip:
            continue
        yield from walk(element_child, skip)


def first(element: Optional[ET.Element], name: str) -> Optional[ET.Element]:
    """子孫のうち最初に見つかった name"""
    tag = q(name)
    return next((node for node in walk(element) if node.tag == tag), None)


def elements(element: Optional[ET.Element]) -> list[ET.Element]:
    """子の一覧。要素が無ければ空。要素の真偽で判定すると、子が無い要素も偽になる"""
    return list(element) if element is not None else []


def child(element: Optional[ET.Element], name: str) -> Optional[ET.Element]:
    return element.find(q(name)) if element is not None else None


def path(element: Optional[ET.Element], *names: str) -> Optional[ET.Element]:
    for name in names:
        element = child(element, name)
    return element


def val(element: Optional[ET.Element], attribute: str = "w:val") -> Optional[str]:
    return element.get(q(attribute)) if element is not None else None


def to_int(text: Optional[str], default: int = 0) -> int:
    try:
        return int(text) if text is not None else default
    except ValueError:
        return default


def column_letters(index: int) -> str:
    """1 → A、27 → AA。Excel の列と、Word の英字の番号に使う"""
    letters = ""
    while index > 0:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def table_cell(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace("|", "\\|")
        .replace("\r\n", "\n")
        .strip()
        .replace("\n", "<br>")
    )


def markdown_table(rows: list[list[str]]) -> str:
    rows = [row for row in rows if row]
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    padded = [row + [""] * (width - len(row)) for row in rows]
    lines = ["| " + " | ".join(padded[0]) + " |", "|" + "---|" * width]
    lines += ["| " + " | ".join(row) + " |" for row in padded[1:]]
    return "\n".join(lines)
