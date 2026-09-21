"""Word（docx）を Markdown にする"""

from __future__ import annotations

import re
from typing import Iterator, Optional
from xml.etree import ElementTree as ET

from .converter import Converter
from .model import OfficeFileError
from .shapes import connection_lines, geometry_note
from .ooxml import (
    MC_ALTERNATE,
    MC_FALLBACK,
    Relationships,
    child,
    column_letters,
    markdown_table,
    q,
    table_cell,
    to_int,
    val,
    walk,
)
from .package import Images, Package, related_part

_FULL_WIDTH_DIGITS = str.maketrans("0123456789", "０１２３４５６７８９")
_WRAPPERS = ("w:sdt", "w:sdtContent", "w:customXml", "w:smartTag")


def _children(element: ET.Element, name: str) -> Iterator[ET.Element]:
    """直下の name。コンテンツコントロールなどの入れ物の中も見る"""
    tag = q(name)
    wrappers = {q(wrapper) for wrapper in _WRAPPERS}
    for element_child in element:
        if element_child.tag == tag:
            yield element_child
        elif element_child.tag in wrappers:
            yield from _children(element_child, name)


def _numbering_reference(
    properties: Optional[ET.Element],
) -> Optional[tuple[str, int]]:
    numbering = child(properties, "w:numPr")
    number_id = val(child(numbering, "w:numId"))
    if number_id is None:
        return None
    return number_id, to_int(val(child(numbering, "w:ilvl")))


def _roman(value: int) -> str:
    numerals = [
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ]
    result = []
    for number, numeral in numerals:
        count, value = divmod(value, number)
        result.append(numeral * count)
    return "".join(result)


def _list_number(value: int, number_format: str) -> str:
    if number_format in ("upperLetter", "lowerLetter"):
        letters = column_letters(value)
        return letters if number_format == "upperLetter" else letters.lower()
    if number_format in ("upperRoman", "lowerRoman"):
        roman = _roman(value)
        return roman if number_format == "upperRoman" else roman.lower()
    if number_format == "decimalZero":
        return f"{value:02d}"
    if number_format in ("decimalFullWidth", "decimalFullWidth2"):
        return str(value).translate(_FULL_WIDTH_DIGITS)
    if number_format == "decimalEnclosedCircle" and 1 <= value <= 20:
        return chr(0x2460 + value - 1)
    return str(value)


class WordConverter(Converter):
    _HEADING_STYLE = re.compile(r"heading ([1-9])")
    _NOTE_SEPARATORS = ("separator", "continuationSeparator", "continuationNotice")

    def __init__(self, package: Package, images: Images):
        super().__init__(package, images)
        self._styles = self._read_styles()
        self._numbering = self._read_numbering()
        self._counters: dict[str, dict[int, int]] = {}
        self._comment_ids: list[str] = []

    def convert(self) -> str:
        part = "word/document.xml"
        body = child(self._package.xml(part), "w:body")
        if body is None:
            raise OfficeFileError("word/document.xml could not be read")
        relationships = self._package.relationships(part)

        blocks = self._headers_and_footers(relationships)
        blocks += self._blocks(body, relationships)
        blocks += self._notes(related_part(relationships, "footnotes"), "footnote")
        blocks += self._notes(related_part(relationships, "endnotes"), "endnote")
        blocks += self._comments(related_part(relationships, "comments"))
        return "\n\n".join(blocks)

    # --- 文書の骨組み ---

    def _blocks(self, container: ET.Element, relationships: Relationships) -> list[str]:
        """段落と表を、文書の順に Markdown のかたまりにする"""
        blocks = []
        paragraph_tag, table_tag = q("w:p"), q("w:tbl")
        wrappers = {q(name) for name in _WRAPPERS} | {MC_ALTERNATE, q("mc:Choice")}
        for element in container:
            if element.tag == paragraph_tag:
                text = self._paragraph(element, relationships)
            elif element.tag == table_tag:
                text = self._table(element, relationships)
            elif element.tag in wrappers:
                blocks += self._blocks(element, relationships)
                continue
            else:
                continue
            if text:
                blocks.append(text)
        return blocks

    def _headers_and_footers(self, relationships: Relationships) -> list[str]:
        blocks, seen = [], set()
        for relationship_type, target in relationships.values():
            kind = relationship_type.rsplit("/", 1)[-1]
            if kind not in ("header", "footer"):
                continue
            root = self._package.xml(target)
            if root is None:
                continue
            text = " / ".join(self._blocks(root, self._package.relationships(target)))
            if text and (kind, text) not in seen:
                seen.add((kind, text))
                blocks.append(f"[{kind}] {text}")
        return blocks

    def _notes(self, part: Optional[str], kind: str) -> list[str]:
        root = self._package.xml(part) if part else None
        if root is None:
            return []
        relationships = self._package.relationships(part)
        blocks = []
        for note in root:
            if note.get(q("w:type")) in self._NOTE_SEPARATORS:
                continue
            text = " ".join(self._blocks(note, relationships)).strip()
            if text:
                blocks.append(f"[{kind} {note.get(q('w:id'))}] {text}")
        return blocks

    def _comments(self, part: Optional[str]) -> list[str]:
        root = self._package.xml(part) if part else None
        if root is None or not self._comment_ids:
            return []
        relationships = self._package.relationships(part)
        comments = {
            comment.get(q("w:id")): comment for comment in root.findall(q("w:comment"))
        }
        blocks = []
        for comment_id in dict.fromkeys(self._comment_ids):
            comment = comments.get(comment_id)
            if comment is None:
                continue
            author = comment.get(q("w:author")) or "unknown"
            text = " ".join(self._blocks(comment, relationships))
            blocks.append(f"[comment {comment_id}] ({author}) {text}")
        return blocks

    # --- 段落 ---

    def _paragraph(self, paragraph: ET.Element, relationships: Relationships) -> str:
        properties = child(paragraph, "w:pPr")
        text = self._inline(paragraph, relationships).strip()
        if not text:
            return ""
        style_id = val(child(properties, "w:pStyle"))

        outline = val(child(properties, "w:outlineLvl"))
        level = (
            to_int(outline) + 1
            if outline is not None and to_int(outline, 9) < 9
            else None
        )
        level = level or self._style_property(style_id, "level")
        if level:
            # ファイル名を「#」にしているので、文書の見出しは1段下げる
            return "#" * min(level + 1, 6) + " " + " ".join(text.split("\n"))

        numbering = _numbering_reference(properties) or self._style_property(
            style_id, "numbering"
        )
        if numbering:
            return self._list_prefix(*numbering) + text
        return text

    def _inline(self, element: ET.Element, relationships: Relationships) -> str:
        """段落の中身を文字にする。変更履歴・脚注・コメント・画像は目印にして残す"""
        parts = []
        for node in element:
            tag = node.tag
            if tag in (q("w:pPr"), q("w:rPr"), q("w:instrText"), MC_FALLBACK):
                continue
            if tag in (q("w:t"), q("w:delText")):
                parts.append(node.text or "")
            elif tag in (q("w:tab"), q("w:ptab")):
                parts.append("\t")
            elif tag in (q("w:br"), q("w:cr")):
                parts.append("\n")
            elif tag == q("w:noBreakHyphen"):
                parts.append("-")
            elif tag in (q("w:ins"), q("w:del")):
                inner = self._inline(node, relationships)
                if inner:
                    kind = "inserted" if tag == q("w:ins") else "deleted"
                    parts.append(f"[{kind}: {inner}]")
            elif tag in (q("w:footnoteReference"), q("w:endnoteReference")):
                kind = "footnote" if tag == q("w:footnoteReference") else "endnote"
                parts.append(f"[{kind} {node.get(q('w:id'))}]")
            elif tag == q("w:commentReference"):
                comment_id = node.get(q("w:id")) or ""
                self._comment_ids.append(comment_id)
                parts.append(f"[comment {comment_id}]")
            elif tag in (q("w:drawing"), q("w:pict"), q("w:object")):
                parts.append(self._drawing(node, relationships))
            else:
                # w:r, w:hyperlink, w:sdt, w:fldSimple, mc:AlternateContent など
                parts.append(self._inline(node, relationships))
        return "".join(parts)

    def _drawing(self, element: ET.Element, relationships: Relationships) -> str:
        text_box = q("w:txbxContent")
        parts = []
        for node in walk(element, skip=(text_box,)):
            found = self._image_or_chart(node, relationships)
            if found:
                parts.append(found)

        # 図形（wps:wsp）は、形と大きさを持っている。中の文字だけを出すと
        # 「ひし形に囲まれた判断」なのか本文の注記なのか分からない
        described = set()
        for wsp in (node for node in walk(element) if node.tag == q("wps:wsp")):
            note = geometry_note(wsp)
            for box in (node for node in walk(wsp) if node.tag == text_box):
                described.add(id(box))
                text = " / ".join(self._blocks(box, relationships))
                if text:
                    parts.append(
                        f"[shape] {text} {note}" if note else f"[text box] {text}"
                    )

        for box in (node for node in walk(element) if node.tag == text_box):
            if id(box) in described:
                continue
            text = " / ".join(self._blocks(box, relationships))
            if text:
                parts.append(f"[text box] {text}")

        # 図形どうしのつながり。描画キャンバスの中では、箱の文字だけ読めても
        # どこからどこへ向かうのか分からない
        parts += connection_lines(element)
        return " ".join(parts)

    def _table(self, table: ET.Element, relationships: Relationships) -> str:
        rows = []
        for row in _children(table, "w:tr"):
            cells = []
            for cell in _children(row, "w:tc"):
                properties = child(cell, "w:tcPr")
                span = max(to_int(val(child(properties, "w:gridSpan")), 1), 1)
                merge = child(properties, "w:vMerge")
                if merge is not None and val(merge) != "restart":
                    cells.append("(merged)")
                else:
                    cells.append(
                        table_cell("\n".join(self._blocks(cell, relationships)))
                    )
                cells += [""] * (span - 1)
            rows.append(cells)
        return markdown_table(rows)

    # --- スタイルと番号 ---

    def _read_styles(self) -> dict[str, dict]:
        root = self._package.xml("word/styles.xml")
        styles = {}
        for style in root.findall(q("w:style")) if root is not None else []:
            if style.get(q("w:type")) != "paragraph":
                continue
            name = (val(child(style, "w:name")) or "").lower()
            properties = child(style, "w:pPr")
            heading = self._HEADING_STYLE.fullmatch(name)
            level = (
                int(heading.group(1)) if heading else (1 if name == "title" else None)
            )
            outline = val(child(properties, "w:outlineLvl"))
            if level is None and outline is not None and to_int(outline, 9) < 9:
                level = to_int(outline) + 1
            styles[style.get(q("w:styleId"), "")] = {
                "level": level,
                "numbering": _numbering_reference(properties),
                "based_on": val(child(style, "w:basedOn")),
            }
        return styles

    def _style_property(self, style_id: Optional[str], key: str):
        """スタイルの設定。無ければ、元にしたスタイル（basedOn）をたどる"""
        seen = set()
        while style_id and style_id not in seen:
            seen.add(style_id)
            style = self._styles.get(style_id)
            if style is None:
                return None
            if style[key] is not None:
                return style[key]
            style_id = style["based_on"]
        return None

    def _read_numbering(self) -> dict[str, dict[int, tuple[str, str, int]]]:
        """numId → 階層 → (番号の形式, 番号の書き方, 開始番号)"""
        root = self._package.xml("word/numbering.xml")
        if root is None:
            return {}
        abstract = {}
        for definition in root.findall(q("w:abstractNum")):
            levels = {}
            for level in definition.findall(q("w:lvl")):
                levels[to_int(level.get(q("w:ilvl")))] = (
                    val(child(level, "w:numFmt")) or "decimal",
                    val(child(level, "w:lvlText")) or "",
                    to_int(val(child(level, "w:start")), 1),
                )
            abstract[definition.get(q("w:abstractNumId"))] = levels
        return {
            number.get(q("w:numId")): abstract.get(
                val(child(number, "w:abstractNumId")), {}
            )
            for number in root.findall(q("w:num"))
        }

    def _list_prefix(self, number_id: str, level: int) -> str:
        levels = self._numbering.get(number_id)
        if not levels:
            # numId 0 は「番号を付けない」
            return ""
        number_format, text, start = levels.get(level, ("bullet", "", 1))
        indent = "  " * level
        if number_format in ("bullet", "none"):
            return f"{indent}- "

        counters = self._counters.setdefault(number_id, {})
        counters[level] = counters[level] + 1 if level in counters else start
        # 上の階層が進んだら、下の階層の番号は振り直す
        for deeper in [key for key in counters if key > level]:
            del counters[deeper]

        def number(match: re.Match) -> str:
            referenced = int(match.group(1)) - 1
            referenced_format, _, referenced_start = levels.get(
                referenced, ("decimal", "", 1)
            )
            return _list_number(
                counters.get(referenced, referenced_start), referenced_format
            )

        label = re.sub(r"%([1-9])", number, text).strip()
        return f"{indent}{label} " if label else f"{indent}- "
