"""DrawingML（図形・グラフ）の文字を読む。Word・Excel・PowerPoint で共通"""

from __future__ import annotations

from typing import Optional
from xml.etree import ElementTree as ET

from .ooxml import child, path, q, to_int, walk
from .package import Package


def drawing_paragraphs(element: Optional[ET.Element]) -> list[tuple[int, str]]:
    """DrawingML の段落（a:p）ごとに (字下げの階層, 文字)"""
    paragraphs = []
    for paragraph in (node for node in walk(element) if node.tag == q("a:p")):
        parts = []
        for node in walk(paragraph):
            if node.tag == q("a:t"):
                parts.append(node.text or "")
            elif node.tag == q("a:br"):
                parts.append("\n")
        text = "".join(parts).strip()
        if text:
            properties = child(paragraph, "a:pPr")
            level = to_int(properties.get("lvl") if properties is not None else None)
            paragraphs.append((level, text))
    return paragraphs


def drawing_text(element: Optional[ET.Element]) -> str:
    return "\n".join(text for _, text in drawing_paragraphs(element))


def chart_lines(package: Package, part: str) -> list[str]:
    """グラフのタイトルと、系列ごとの「分類=値」"""
    root = package.xml(part)
    if root is None:
        return ["[chart] (could not be read)"]
    title_element = path(root, "c:chart", "c:title")
    title = drawing_text(title_element) or " ".join(_chart_points(title_element))
    lines = [f"[chart] {title or '(untitled)'}"]
    for series in root.iter(q("c:ser")):
        name = " ".join(_chart_points(child(series, "c:tx")))
        categories = _chart_points(child(series, "c:cat")) or _chart_points(
            child(series, "c:xVal")
        )
        values = _chart_points(child(series, "c:val")) or _chart_points(
            child(series, "c:yVal")
        )
        if categories:
            pairs = ", ".join(
                f"{category}={values[index] if index < len(values) else ''}"
                for index, category in enumerate(categories)
            )
        else:
            pairs = ", ".join(values)
        lines.append(f"  {name or '(series)'}: {pairs}")
    return lines


def _chart_points(element: Optional[ET.Element]) -> list[str]:
    if element is None:
        return []
    points = []
    for point in element.iter(q("c:pt")):
        value = child(point, "c:v")
        points.append(
            (to_int(point.get("idx")), (value.text or "") if value is not None else "")
        )
    if points:
        return [text for _, text in sorted(points, key=lambda point: point[0])]
    return [node.text or "" for node in element.iter(q("c:v"))]
