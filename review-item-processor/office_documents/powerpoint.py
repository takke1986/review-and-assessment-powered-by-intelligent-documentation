"""PowerPoint（pptx）を Markdown にする"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional
from xml.etree import ElementTree as ET

from . import limits
from .converter import Converter
from .drawing import drawing_paragraphs, drawing_text
from .shapes import describe, geometry_note
from .ooxml import (
    MC_ALTERNATE,
    Relationships,
    child,
    elements,
    first,
    markdown_table,
    path,
    q,
    table_cell,
    to_int,
    walk,
)
from .package import related_part

_TITLE_PLACEHOLDERS = ("title", "ctrTitle")
# ノートのスライド番号やスライドの縮小画像は、話す内容ではない
_NOTES_PLACEHOLDERS_SKIPPED = ("sldNum", "sldImg", "hdr", "ftr", "dt")


def _position(shape: ET.Element) -> tuple[float, float]:
    """左上の位置（EMU）。読む順に並べるのに使う。位置が無ければ最後にする"""
    offset = first(shape, "a:off")
    if offset is None:
        return (float("inf"), float("inf"))
    return (to_int(offset.get("y")), to_int(offset.get("x")))


def _placeholder_type(shape: ET.Element, properties: str) -> Optional[str]:
    placeholder = path(shape, properties, "p:nvPr", "p:ph")
    return placeholder.get("type") if placeholder is not None else None


@dataclass
class _SlideContent:
    """1枚のスライドから集めたもの"""

    title: str = ""
    # (上端, 左端, 文字)。読む順に並べ替えて出す
    placed: list[tuple[float, float, str]] = field(default_factory=list)
    # 図形の ID → 文字。コネクタの両端を名前で書くのに使う
    labels: dict[str, str] = field(default_factory=dict)
    # (始点の図形ID, 終点の図形ID, 矢印に書かれた文字)
    connections: list[tuple[str, str, str]] = field(default_factory=list)


class PowerPointConverter(Converter):
    def convert(self) -> str:
        slides = self._slide_parts()
        sections = []
        if len(slides) > limits.MAX_SLIDES:
            sections.append(
                f"This deck has {len(slides)} slides. Only the first "
                f"{limits.MAX_SLIDES} are included below."
            )
        for number, part in enumerate(slides[: limits.MAX_SLIDES], start=1):
            sections.append(self._slide(number, part))
        return "\n\n".join(sections)

    def _slide_parts(self) -> list[str]:
        """スライドの並び順は presentation.xml の一覧で決まる（ファイル名の番号とは限らない）"""
        part = "ppt/presentation.xml"
        relationships = self._package.relationships(part)
        slides = []
        for slide in elements(child(self._package.xml(part), "p:sldIdLst")):
            target = relationships.get(slide.get(q("r:id")) or "")
            if target:
                slides.append(target[1])
        if slides:
            return slides
        return sorted(
            (
                name
                for name in self._package.names
                if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)
            ),
            key=lambda name: to_int(re.search(r"(\d+)\.xml$", name).group(1)),
        )

    def _slide(self, number: int, part: str) -> str:
        root = self._package.xml(part)
        if root is None:
            return f"## Slide {number}\n(this slide could not be read)"
        relationships = self._package.relationships(part)

        content = _SlideContent()
        self._shapes(path(root, "p:cSld", "p:spTree"), relationships, content)

        heading = f"## Slide {number}" + (f": {content.title}" if content.title else "")
        if root.get("show") in ("0", "false"):
            heading += " (hidden)"
        content.placed.sort(key=lambda item: (item[0], item[1]))
        lines = [heading] + [text for _, _, text in content.placed]
        # コネクタは、つないだ図形の ID を持っている。図を画像で読むと矢印の両端を読み違える
        for start, end, label in content.connections:
            if content.labels.get(start) and content.labels.get(end):
                note = f" ({label})" if label else ""
                lines.append(
                    f"[connection] {content.labels[start]} -> "
                    f"{content.labels[end]}{note}"
                )
        lines += self._notes(relationships)
        return "\n".join(lines)

    def _shapes(
        self,
        container: Optional[ET.Element],
        relationships: Relationships,
        content: _SlideContent,
    ) -> None:
        """図形を読み、配置順に並べる材料を集める"""
        for shape in elements(container):
            tag = shape.tag
            if tag in (MC_ALTERNATE, q("mc:Choice"), q("p:grpSp")):
                self._shapes(shape, relationships, content)
            elif tag == q("p:sp"):
                self._text_shape(shape, content)
            elif tag == q("p:graphicFrame"):
                text = self._frame(shape, relationships)
                if text:
                    content.placed.append((*_position(shape), text))
            elif tag == q("p:pic"):
                self._picture(shape, relationships, content)
            elif tag == q("p:cxnSp"):
                start, end = first(shape, "a:stCxn"), first(shape, "a:endCxn")
                if start is not None and end is not None:
                    # 矢印に書かれた文字（「はい」「いいえ」）も拾う。
                    # これが無いと、分岐のどちらへ進む線なのか分からない
                    label = " ".join(drawing_text(child(shape, "p:txBody")).split())
                    content.connections.append(
                        (start.get("id", ""), end.get("id", ""), label)
                    )

    def _text_shape(self, shape: ET.Element, content: _SlideContent) -> None:
        text = "\n".join(
            "  " * level + line
            for level, line in drawing_paragraphs(child(shape, "p:txBody"))
        )
        if not text:
            return
        one_line = " ".join(text.split())
        properties = path(shape, "p:nvSpPr", "p:cNvPr")
        if properties is not None:
            content.labels[properties.get("id", "")] = one_line
        if (
            _placeholder_type(shape, "p:nvSpPr") in _TITLE_PLACEHOLDERS
            and not content.title
        ):
            content.title = one_line
        else:
            # 差し込み枠（タイトルや箇条書き）はスライドの文章なので、そのまま。
            # それ以外は描かれた図形なので、形と位置を添える。間取りや配置は
            # 文字だけでは分からず、位置が無いと「隣り合っているか」を
            # 判断できない
            if _placeholder_type(shape, "p:nvSpPr") is None:
                note = geometry_note(shape)
                if note:
                    text = f"{text} {note}"
            content.placed.append((*_position(shape), text))

    def _picture(
        self, shape: ET.Element, relationships: Relationships, content: _SlideContent
    ) -> None:
        blip = first(shape, "a:blip")
        marker = self._image_or_chart(blip, relationships) if blip is not None else None
        if not marker:
            return
        properties = path(shape, "p:nvPicPr", "p:cNvPr")
        description = (
            (properties.get("descr") or "").strip() if properties is not None else ""
        )
        content.placed.append(
            (*_position(shape), marker + (f" ({description})" if description else ""))
        )

    def _frame(self, frame: ET.Element, relationships: Relationships) -> str:
        """表・グラフ・SmartArt"""
        table = first(frame, "a:tbl")
        if table is not None:
            rows = []
            for row in table.findall(q("a:tr")):
                rows.append(
                    [
                        (
                            "(merged)"
                            if cell.get("hMerge") in ("1", "true")
                            or cell.get("vMerge") in ("1", "true")
                            else table_cell(drawing_text(child(cell, "a:txBody")))
                        )
                        for cell in row.findall(q("a:tc"))
                    ]
                )
            return markdown_table(rows)
        chart = first(frame, "c:chart")
        if chart is not None:
            return self._image_or_chart(chart, relationships) or ""
        diagram = first(frame, "dgm:relIds")
        if diagram is not None:
            return self._diagram(diagram, relationships)
        return ""

    def _diagram(
        self, diagram: ET.Element, relationships: Relationships
    ) -> str:
        """SmartArt。文字と、置かれている位置を読む。

        文字は元データ（dgm:dataModel）にあるが、どこに置かれたかは別の
        部品（diagramDrawing）にしかない。位置が分からないと、組織図で
        どれが上でどれが下かが落ちる
        """
        drawing_part = related_part(relationships, "diagramDrawing")
        if drawing_part:
            tree = self._package.xml(drawing_part)
            lines = [
                line
                for line in describe(tree)
                if line.startswith("[shape]") or line.startswith("[flow]")
            ]
            if lines:
                return "[diagram]\n" + "\n".join(lines)

        # 位置の部品が無い SmartArt もある。そのときは文字だけ
        target = relationships.get(diagram.get(q("r:dm")) or "")
        text = drawing_text(self._package.xml(target[1])) if target else ""
        return "[diagram] " + " / ".join(text.split("\n")) if text else ""

    def _notes(self, relationships: Relationships) -> list[str]:
        part = related_part(relationships, "notesSlide")
        tree = path(self._package.xml(part), "p:cSld", "p:spTree") if part else None
        texts = []
        for shape in (node for node in walk(tree) if node.tag == q("p:sp")):
            if _placeholder_type(shape, "p:nvSpPr") in _NOTES_PLACEHOLDERS_SKIPPED:
                continue
            text = " ".join(drawing_text(child(shape, "p:txBody")).split())
            if text:
                texts.append(text)
        return ["[notes] " + " ".join(texts)] if texts else []
