"""図形の形・位置・つながりを XML から読む。

## なぜ要るか

図形の中の文字（drawing.py）とグラフの数値（chart_lines）はすでに読めている。
足りないのは**図形どうしの関係**で、そこが分からないと図の意味が落ちる。

- フロー図: 箱の文字は読めても「A のあと B」が分からない
- 組織図: 部署名は読めても、どこがどこの下か分からない
- 図形で描いた間取り: 部屋名は読めても、隣り合っているかが分からない

これらはすべて XML にある。`a:prstGeom` に形、`a:off`/`a:ext` に位置と
大きさ、`p:cxnSp` に「どの図形からどの図形へ」がある。**モデルを呼ばずに
取り出せる**ので、正確で、ただで、毎回同じ結果になる。画像として説明させる
より確実で、写真やスクリーンショットだけを説明に回せばよくなる。

## 位置をどう書くか

EMU（1cm = 360000）のままでは読めないので cm に直す。「隣接している」と
いった判断はここではしない。座標を素直に出して、判断はモデルに任せる。
ここで「近い」を決めてしまうと、その基準が審査の結果を左右するのに、
誰も見直せなくなる。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from xml.etree import ElementTree as ET

from .drawing import drawing_text
from .ooxml import child, first, q, to_int, walk

EMU_PER_CM = 360000

# 形の名前（a:prstGeom@prst）を、読める言葉にする。
# ここに無い形は名前をそのまま出す。訳せないより、生の名前のほうがまし
SHAPE_NAMES = {
    "rect": "四角形",
    "roundRect": "角丸四角形",
    "ellipse": "楕円",
    "triangle": "三角形",
    "diamond": "ひし形",
    "flowChartProcess": "処理",
    "flowChartDecision": "判断",
    "flowChartTerminator": "開始終了",
    "flowChartInputOutput": "入出力",
    "flowChartDocument": "書類",
    "flowChartPredefinedProcess": "定義済み処理",
    "rightArrow": "右向き矢印",
    "leftArrow": "左向き矢印",
    "upArrow": "上向き矢印",
    "downArrow": "下向き矢印",
    "line": "線",
    "straightConnector1": "直線コネクタ",
    "bentConnector3": "折れ線コネクタ",
    "curvedConnector3": "曲線コネクタ",
}


@dataclass(frozen=True)
class Shape:
    """図形1つ。位置は cm、左上が原点"""

    shape_id: str
    name: str
    kind: str
    text: str = ""
    left: Optional[float] = None
    top: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None

    @property
    def label(self) -> str:
        """図の中でこの図形を指す呼び名。文字があればそれ、無ければ形と名前"""
        if self.text:
            return self.text
        return self.name or self.kind


@dataclass(frozen=True)
class Connection:
    """図形どうしのつながり。向きのある線は from → to"""

    from_id: Optional[str]
    to_id: Optional[str]
    text: str = ""


def to_cm(value: Optional[int]) -> Optional[float]:
    if value is None:
        return None
    return round(value / EMU_PER_CM, 1)


def placement_of(element: Optional[ET.Element]) -> tuple[Optional[int], ...]:
    """a:xfrm から位置と大きさ。グループの中など、無いこともある"""
    transform = first(element, "a:xfrm")
    if transform is None:
        return (None, None, None, None)
    offset = child(transform, "a:off")
    extent = child(transform, "a:ext")
    return (
        to_int(offset.get("x")) if offset is not None else None,
        to_int(offset.get("y")) if offset is not None else None,
        to_int(extent.get("cx")) if extent is not None else None,
        to_int(extent.get("cy")) if extent is not None else None,
    )


def kind_of(element: Optional[ET.Element]) -> str:
    geometry = first(element, "a:prstGeom")
    preset = geometry.get("prst") if geometry is not None else None
    if not preset:
        return "図形"
    return SHAPE_NAMES.get(preset, preset)


def _identity(element: Optional[ET.Element], tag: str) -> tuple[str, str]:
    """cNvPr から id と名前。名前は「四角形 3」のような既定の名前が入る"""
    properties = first(element, tag)
    if properties is None:
        return ("", "")
    return (properties.get("id") or "", properties.get("name") or "")


@dataclass(frozen=True)
class GroupFrame:
    """グループの中の座標を、スライドの座標に直すための換算。

    グループの中の図形は、親から見た相対座標で書かれている。そのまま出すと
    「左1cm」と言いながら実際はスライドの左11cm、ということが起きる。
    図はたいていグループにまとめられているので、必ず当たる
    """

    offset_x: int = 0
    offset_y: int = 0
    scale_x: float = 1.0
    scale_y: float = 1.0

    def apply(self, x: Optional[int], y: Optional[int]) -> tuple[Optional[int], ...]:
        if x is None or y is None:
            return (None, None)
        return (
            int(self.offset_x + x * self.scale_x),
            int(self.offset_y + y * self.scale_y),
        )

    def scale(self, cx: Optional[int], cy: Optional[int]) -> tuple[Optional[int], ...]:
        if cx is None or cy is None:
            return (None, None)
        return (int(cx * self.scale_x), int(cy * self.scale_y))


def frame_of(group: ET.Element, outer: GroupFrame) -> GroupFrame:
    """グループの a:xfrm から換算を作り、外側の換算と重ねる"""
    transform = first(group, "a:xfrm")
    if transform is None:
        return outer
    offset = child(transform, "a:off")
    child_offset = child(transform, "a:chOff")
    extent = child(transform, "a:ext")
    child_extent = child(transform, "a:chExt")
    if offset is None or child_offset is None:
        return outer

    scale_x = scale_y = 1.0
    if extent is not None and child_extent is not None:
        width = to_int(child_extent.get("cx")) or 0
        height = to_int(child_extent.get("cy")) or 0
        if width:
            scale_x = to_int(extent.get("cx")) / width
        if height:
            scale_y = to_int(extent.get("cy")) / height

    # 子の座標 → グループ内の位置 → 外側の座標、の順に重ねる
    inner_x = to_int(offset.get("x")) - to_int(child_offset.get("x")) * scale_x
    inner_y = to_int(offset.get("y")) - to_int(child_offset.get("y")) * scale_y
    moved_x, moved_y = outer.apply(int(inner_x), int(inner_y))
    return GroupFrame(
        offset_x=moved_x or 0,
        offset_y=moved_y or 0,
        scale_x=scale_x * outer.scale_x,
        scale_y=scale_y * outer.scale_y,
    )


def shapes_in(
    tree: Optional[ET.Element], frame: Optional[GroupFrame] = None
) -> list[Shape]:
    """図形の一覧。読む順（上から、同じ高さなら左から）に並べる。

    グループの中の図形は、スライドから見た座標に直して返す
    """
    found: list[Shape] = []
    for node in _shapes_with_frames(tree, frame or GroupFrame()):
        node, node_frame = node
        shape_id, name = _identity(node, "p:cNvPr")
        left, top, width, height = placement_of(node)
        left, top = node_frame.apply(left, top)
        width, height = node_frame.scale(width, height)
        found.append(
            Shape(
                shape_id=shape_id,
                name=name,
                kind=kind_of(node),
                text=" ".join(drawing_text(child(node, "p:txBody")).split()),
                left=to_cm(left),
                top=to_cm(top),
                width=to_cm(width),
                height=to_cm(height),
            )
        )
    return sorted(
        found,
        key=lambda shape: (
            shape.top if shape.top is not None else 0,
            shape.left if shape.left is not None else 0,
        ),
    )


def connections_in(tree: Optional[ET.Element]) -> list[Connection]:
    """つながりの一覧。どちらの端も繋がっていない線は入れない"""
    found: list[Connection] = []
    for node in walk(tree):
        if node.tag != q("p:cxnSp"):
            continue
        start = first(node, "a:stCxn")
        end = first(node, "a:endCxn")
        from_id = start.get("id") if start is not None else None
        to_id = end.get("id") if end is not None else None
        if from_id is None and to_id is None:
            # 何にも繋がっていない飾りの線。書いても読む人が困るだけ
            continue
        found.append(
            Connection(
                from_id=from_id,
                to_id=to_id,
                text=" ".join(drawing_text(child(node, "p:txBody")).split()),
            )
        )
    return found


def describe(tree: Optional[ET.Element]) -> list[str]:
    """図形とつながりを Markdown の行にする。

    位置は「判断できる材料」として出すだけで、近い・隣接といった解釈は
    しない。その基準を here で決めると、審査の結果を左右するのに誰も
    見直せなくなる
    """
    shapes = shapes_in(tree)
    connections = connections_in(tree)
    if not shapes and not connections:
        return []

    by_id = {shape.shape_id: shape for shape in shapes if shape.shape_id}
    lines: list[str] = []

    for shape in shapes:
        if not shape.text and shape.kind == "図形":
            # 文字も形も分からない図形。書いても手がかりにならない
            continue
        where = ""
        if shape.left is not None and shape.top is not None:
            where = f" 左{shape.left}cm 上{shape.top}cm"
            if shape.width is not None and shape.height is not None:
                where += f" 幅{shape.width}cm 高さ{shape.height}cm"
        label = f"「{shape.text}」" if shape.text else ""
        lines.append(f"[shape] {shape.kind}{label}{where}")

    for connection in connections:
        source = by_id.get(connection.from_id or "")
        target = by_id.get(connection.to_id or "")
        if source is None and target is None:
            continue
        arrow = (
            f"{source.label if source else '(不明)'} → "
            f"{target.label if target else '(不明)'}"
        )
        note = f"（{connection.text}）" if connection.text else ""
        lines.append(f"[flow] {arrow}{note}")

    return lines


def geometry_note(element: Optional[ET.Element]) -> str:
    """図形の形と位置を、1行に添える短い書き方にする。

    別の行に分けず後ろに付けるのは、どの文字がどの図形のものか
    離れると分からなくなるため。

    形も大きさも分からない図形には何も付けない。位置だけを並べても
    手がかりにならず、本文が読みにくくなるだけ
    """
    left, top, width, height = placement_of(element)
    geometry = first(element, "a:prstGeom")
    if geometry is None and width is None:
        return ""

    parts = [kind_of(element)]
    if left is not None and top is not None:
        parts.append(f"左{to_cm(left)}cm 上{to_cm(top)}cm")
    if width is not None and height is not None:
        parts.append(f"幅{to_cm(width)}cm 高さ{to_cm(height)}cm")
    return "[" + " ".join(parts) + "]"


def _shapes_with_frames(
    container: Optional[ET.Element], frame: GroupFrame
) -> list[tuple[ET.Element, GroupFrame]]:
    """図形と、それに効く換算の組。グループに入るたびに換算を重ねる"""
    if container is None:
        return []
    found: list[tuple[ET.Element, GroupFrame]] = []
    for node in list(container):
        if node.tag == q("p:sp"):
            found.append((node, frame))
        elif node.tag == q("p:grpSp"):
            found += _shapes_with_frames(node, frame_of(node, frame))
        else:
            found += _shapes_with_frames(node, frame)
    return found
