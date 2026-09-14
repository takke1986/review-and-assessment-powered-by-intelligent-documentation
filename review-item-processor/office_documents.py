"""
Word・Excel・PowerPoint のファイルを、XML から Markdown に変換する。

Bedrock の Converse API は pptx を受け付けない（DocumentBlock の形式は pdf, csv,
doc, docx, xls, xlsx, html, txt, md）。docx と xlsx は受け付けるが、Bedrock が取り
出すのは文字だけで、数式・コメント・グラフの値・埋め込み画像・非表示のシートや
セル番地は落ちる。審査では「どのシートのどのセルの値か」「合計がどの式か」が
根拠になるので、Office ファイル（中身は ZIP に入った XML）を自分で読み、構造を
残した Markdown と、埋め込み画像を別に返す。

- Excel: シート名、セル番地つきの表（表示形式を当てた値）、数式、結合セル、
  非表示の行・列・シート、コメント、グラフの系列、図形の文字
- Word: 見出し、段落、番号つきの箇条書き、表、脚注、コメント、変更履歴、
  ヘッダーとフッター、テキストボックス、画像の位置
- PowerPoint: スライドの並び順、配置順の文字、表、図のつながり、グラフ、
  SmartArt の文字、ノート

上限を超えた分は省き、省いたことを Markdown に書く。黙って切ると、モデルは
見た分を全体だと思って答える。

依存は標準ライブラリだけ。画像の形式と大きさの確認にだけ Pillow（既存の依存）を使う。
"""

from __future__ import annotations

import io
import posixpath
import re
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Callable, Iterator, Optional
from xml.etree import ElementTree as ET

from PIL import Image

OFFICE_FILE_EXTENSIONS = (".docx", ".xlsx", ".pptx")

# 変換の上限。いずれも Bedrock の上限ではなく、費用と処理時間の目安
MAX_SLIDES = 300
MAX_SHEET_ROWS = 2000
MAX_SHEET_COLUMNS = 200
MAX_WORKBOOK_CELLS = 100_000
MAX_FORMULAS_PER_SHEET = 2000
MAX_IMAGES_PER_FILE = 20
# Converse の文書は1つ 4.5MB まで。日本語は UTF-8 で1文字3バイトなので、文字数で余裕を見る
MAX_MARKDOWN_CHARS = 1_200_000
# ZIP の中の1部品を読む上限（展開後）。壊れたファイルや ZIP 爆弾でメモリを使い切らない
MAX_PART_BYTES = 100_000_000

# Converse に画像として渡せる上限
MAX_IMAGE_BYTES = 3_750_000
MAX_IMAGE_SIDE_PIXELS = 8000
_IMAGE_FORMATS = {"PNG": "png", "JPEG": "jpeg", "GIF": "gif", "WEBP": "webp"}

# パスワードや暗号化ラベルで保護された OOXML は ZIP ではなく、この形式になる
_CFB_SIGNATURE = bytes.fromhex("d0cf11e0a1b11ae1")

_NAMESPACES = {
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


def _q(name: str) -> str:
    """'w:p' を ElementTree のタグ名 '{名前空間}p' にする"""
    prefix, local = name.split(":")
    return f"{{{_NAMESPACES[prefix]}}}{local}"


_MC_ALTERNATE = _q("mc:AlternateContent")
_MC_FALLBACK = _q("mc:Fallback")


class OfficeFileError(ValueError):
    """Office ファイルとして読めない"""


class ProtectedOfficeFileError(OfficeFileError):
    """パスワードや暗号化ラベルで保護されていて、中身を読めない"""


@dataclass
class EmbeddedImage:
    name: str
    # Converse の ImageBlock の形式（png / jpeg / gif / webp）
    format: str
    data: bytes


@dataclass
class OfficeDocument:
    markdown: str
    images: list[EmbeddedImage] = field(default_factory=list)


def is_office_file(path: str) -> bool:
    return path.lower().endswith(OFFICE_FILE_EXTENSIONS)


def convert_office_file(
    path: str, display_name: Optional[str] = None
) -> OfficeDocument:
    """
    Office ファイルを Markdown と埋め込み画像にする。

    Args:
        path: ファイルのパス。拡張子で種類を決める
        display_name: Markdown の先頭に書くファイル名。省略するとパスのファイル名

    Raises:
        ProtectedOfficeFileError: 保護されていて読めない
        OfficeFileError: Office ファイルとして読めない
    """
    name = display_name or posixpath.basename(path)
    extension = posixpath.splitext(path.lower())[1]
    converters: dict[str, Callable[[_Package, _Images], _Converter]] = {
        ".docx": _DocxConverter,
        ".xlsx": _XlsxConverter,
        ".pptx": _PptxConverter,
    }
    if extension not in converters:
        raise OfficeFileError(f"{name} is not a Word, Excel or PowerPoint file")

    with open(path, "rb") as file:
        head = file.read(len(_CFB_SIGNATURE))
    if head == _CFB_SIGNATURE:
        raise ProtectedOfficeFileError(
            f"{name} is protected by a password or an encryption label, so its "
            "contents cannot be read. Remove the protection and upload it again."
        )
    try:
        archive = zipfile.ZipFile(path)
    except zipfile.BadZipFile as error:
        raise OfficeFileError(
            f"{name} could not be opened as an Office file"
        ) from error

    with archive:
        package = _Package(archive)
        images = _Images(package)
        body = converters[extension](package, images).convert()
        label = _sensitivity_label(package)

    header = [f"# {name}"]
    if label:
        # Bedrock はこのラベルをモデルに渡さないので、社外秘の文書も普通の文書と同じに読まれる
        header.append(f"Sensitivity label: {label}")
    selected, left_out = images.select(MAX_IMAGES_PER_FILE)
    if left_out:
        header.append(
            f"Images not attached (only the {MAX_IMAGES_PER_FILE} largest are): "
            + ", ".join(left_out)
        )
    if len(body) > MAX_MARKDOWN_CHARS:
        body = body[:MAX_MARKDOWN_CHARS]
        header.append(
            "This document is too long to include in full. Only its first "
            f"{MAX_MARKDOWN_CHARS} characters are included below."
        )
    return OfficeDocument(markdown="\n".join(header) + "\n\n" + body, images=selected)


# ---------------------------------------------------------------------------
# パッケージ（ZIP と部品の関係）を読む
# ---------------------------------------------------------------------------


class _Package:
    def __init__(self, archive: zipfile.ZipFile):
        self._archive = archive
        self.names = set(archive.namelist())

    def read(self, name: str) -> Optional[bytes]:
        try:
            info = self._archive.getinfo(name)
        except KeyError:
            return None
        if info.file_size > MAX_PART_BYTES:
            raise OfficeFileError(
                f"{name} inside the file is too large to read ({info.file_size} bytes)"
            )
        return self._archive.read(info)

    def xml(self, name: str) -> Optional[ET.Element]:
        data = self.read(name)
        if data is None:
            return None
        try:
            return ET.fromstring(data)
        except ET.ParseError:
            return None

    def relationships(self, part: str) -> dict[str, tuple[str, str]]:
        """部品の関係を、ID → (種類の URI, 参照先の部品名) で返す。外部へのリンクは除く"""
        directory, base = posixpath.split(part)
        root = self.xml(posixpath.join(directory, "_rels", base + ".rels"))
        if root is None:
            return {}
        result = {}
        for relationship in root.findall(_q("rel:Relationship")):
            if relationship.get("TargetMode") == "External":
                continue
            target = relationship.get("Target", "")
            if target.startswith("/"):
                resolved = target.lstrip("/")
            else:
                resolved = posixpath.normpath(posixpath.join(directory, target))
            result[relationship.get("Id", "")] = (
                relationship.get("Type", ""),
                resolved,
            )
        return result


def _related_part(
    relationships: dict[str, tuple[str, str]], kind: str
) -> Optional[str]:
    """種類の URI が /kind で終わる最初の参照先"""
    for relationship_type, target in relationships.values():
        if relationship_type.endswith("/" + kind):
            return target
    return None


class _Images:
    """
    埋め込み画像を集める。同じ画像は1回だけ数え、Markdown に置く目印を返す。
    Converse に渡せない画像（形式・大きさ）は、渡さない理由を目印に書く。
    """

    def __init__(self, package: _Package):
        self._package = package
        self._markers: dict[str, str] = {}
        self._usable: list[EmbeddedImage] = []

    def marker(self, part: str) -> str:
        if part in self._markers:
            return self._markers[part]
        name = posixpath.basename(part)
        data = self._package.read(part)
        if data is None:
            marker = f"[image missing: {name}]"
        else:
            image_format, size = _inspect_image(data)
            if image_format is None:
                marker = f"[image in a format that cannot be attached: {name}]"
            elif len(data) > MAX_IMAGE_BYTES or max(size) > MAX_IMAGE_SIDE_PIXELS:
                marker = f"[image too large to attach: {name}]"
            else:
                marker = f"[image: {name}]"
                self._usable.append(
                    EmbeddedImage(name=name, format=image_format, data=data)
                )
        self._markers[part] = marker
        return marker

    def select(self, limit: int) -> tuple[list[EmbeddedImage], list[str]]:
        """大きい順に limit 枚まで。並びは文書に出てきた順。外した画像の名前も返す"""
        if len(self._usable) <= limit:
            return list(self._usable), []
        largest = sorted(self._usable, key=lambda image: len(image.data), reverse=True)
        kept = {id(image) for image in largest[:limit]}
        return (
            [image for image in self._usable if id(image) in kept],
            [image.name for image in self._usable if id(image) not in kept],
        )


def _inspect_image(data: bytes) -> tuple[Optional[str], tuple[int, int]]:
    """バイト列から画像の形式と大きさを読む。拡張子ではなく中身で決める（Bedrock も中身で判定する）"""
    try:
        with Image.open(io.BytesIO(data)) as image:
            return _IMAGE_FORMATS.get(image.format or ""), image.size
    except Exception:
        return None, (0, 0)


def _sensitivity_label(package: _Package) -> Optional[str]:
    """Microsoft Purview の秘密度ラベル名（暗号化しないラベルは docProps/custom.xml に残る）"""
    root = package.xml("docProps/custom.xml")
    if root is None:
        return None
    for prop in root.findall(_q("cp:property")):
        name = prop.get("name", "")
        if name.startswith("MSIP_Label_") and name.endswith("_Name"):
            text = "".join(prop.itertext()).strip()
            if text:
                return text
    return None


# ---------------------------------------------------------------------------
# XML を読むための小さな道具
# ---------------------------------------------------------------------------


def _walk(
    element: Optional[ET.Element], skip: tuple[str, ...] = ()
) -> Iterator[ET.Element]:
    """
    子孫を文書の順にたどる。互換用の代わりの表現（mc:Fallback）には入らない。
    入ると、同じ図形やテキストボックスを2回数える。
    """
    if element is None:
        return
    yield element
    for child in element:
        if child.tag == _MC_FALLBACK or child.tag in skip:
            continue
        yield from _walk(child, skip)


def _first(element: Optional[ET.Element], name: str) -> Optional[ET.Element]:
    """子孫のうち最初に見つかった name"""
    tag = _q(name)
    return next((node for node in _walk(element) if node.tag == tag), None)


def _elements(element: Optional[ET.Element]) -> list[ET.Element]:
    """子の一覧。要素が無ければ空。要素の真偽で判定すると、子が無い要素も偽になる"""
    return list(element) if element is not None else []


def _child(element: Optional[ET.Element], name: str) -> Optional[ET.Element]:
    return element.find(_q(name)) if element is not None else None


def _path(element: Optional[ET.Element], *names: str) -> Optional[ET.Element]:
    for name in names:
        element = _child(element, name)
    return element


def _val(element: Optional[ET.Element], attribute: str = "w:val") -> Optional[str]:
    return element.get(_q(attribute)) if element is not None else None


def _int(text: Optional[str], default: int = 0) -> int:
    try:
        return int(text) if text is not None else default
    except ValueError:
        return default


def _table_cell(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace("|", "\\|")
        .replace("\r\n", "\n")
        .strip()
        .replace("\n", "<br>")
    )


def _markdown_table(rows: list[list[str]]) -> str:
    rows = [row for row in rows if row]
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    padded = [row + [""] * (width - len(row)) for row in rows]
    lines = ["| " + " | ".join(padded[0]) + " |", "|" + "---|" * width]
    lines += ["| " + " | ".join(row) + " |" for row in padded[1:]]
    return "\n".join(lines)


def _drawing_paragraphs(element: Optional[ET.Element]) -> list[tuple[int, str]]:
    """DrawingML の段落（a:p）ごとに (字下げの階層, 文字)"""
    paragraphs = []
    for paragraph in (node for node in _walk(element) if node.tag == _q("a:p")):
        parts = []
        for node in _walk(paragraph):
            if node.tag == _q("a:t"):
                parts.append(node.text or "")
            elif node.tag == _q("a:br"):
                parts.append("\n")
        text = "".join(parts).strip()
        if text:
            properties = _child(paragraph, "a:pPr")
            level = _int(properties.get("lvl") if properties is not None else None)
            paragraphs.append((level, text))
    return paragraphs


def _drawing_text(element: Optional[ET.Element]) -> str:
    return "\n".join(text for _, text in _drawing_paragraphs(element))


def _chart_lines(package: _Package, part: str) -> list[str]:
    """グラフのタイトルと、系列ごとの「分類=値」"""
    root = package.xml(part)
    if root is None:
        return ["[chart] (could not be read)"]
    title_element = _path(root, "c:chart", "c:title")
    title = _drawing_text(title_element) or " ".join(_chart_points(title_element))
    lines = [f"[chart] {title or '(untitled)'}"]
    for series in root.iter(_q("c:ser")):
        name = " ".join(_chart_points(_child(series, "c:tx")))
        categories = _chart_points(_child(series, "c:cat")) or _chart_points(
            _child(series, "c:xVal")
        )
        values = _chart_points(_child(series, "c:val")) or _chart_points(
            _child(series, "c:yVal")
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
    for point in element.iter(_q("c:pt")):
        value = _child(point, "c:v")
        points.append(
            (_int(point.get("idx")), (value.text or "") if value is not None else "")
        )
    if points:
        return [text for _, text in sorted(points, key=lambda point: point[0])]
    return [node.text or "" for node in element.iter(_q("c:v"))]


class _Converter:
    def __init__(self, package: _Package, images: _Images):
        self._package = package
        self._images = images

    def convert(self) -> str:
        raise NotImplementedError

    def _image_or_chart(
        self, node: ET.Element, relationships: dict[str, tuple[str, str]]
    ) -> Optional[str]:
        """a:blip・v:imagedata は画像の目印、c:chart はグラフの行にする"""
        if node.tag == _q("a:blip"):
            target = relationships.get(node.get(_q("r:embed")) or "")
            return self._images.marker(target[1]) if target else None
        if node.tag == _q("v:imagedata"):
            target = relationships.get(node.get(_q("r:id")) or "")
            return self._images.marker(target[1]) if target else None
        if node.tag == _q("c:chart"):
            target = relationships.get(node.get(_q("r:id")) or "")
            return "\n".join(_chart_lines(self._package, target[1])) if target else None
        return None


# ---------------------------------------------------------------------------
# Word
# ---------------------------------------------------------------------------

_FULL_WIDTH_DIGITS = str.maketrans("0123456789", "０１２３４５６７８９")
_WORD_WRAPPERS = ("w:sdt", "w:sdtContent", "w:customXml", "w:smartTag")


def _word_children(element: ET.Element, name: str) -> Iterator[ET.Element]:
    """直下の name。コンテンツコントロールなどの入れ物の中も見る"""
    tag = _q(name)
    wrappers = {_q(wrapper) for wrapper in _WORD_WRAPPERS}
    for child in element:
        if child.tag == tag:
            yield child
        elif child.tag in wrappers:
            yield from _word_children(child, name)


def _numbering_reference(properties: Optional[ET.Element]) -> Optional[tuple[str, int]]:
    numbering = _child(properties, "w:numPr")
    number_id = _val(_child(numbering, "w:numId"))
    if number_id is None:
        return None
    return number_id, _int(_val(_child(numbering, "w:ilvl")))


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
        letters = _column_letters(value)
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


class _DocxConverter(_Converter):
    _HEADING_STYLE = re.compile(r"heading ([1-9])")
    _NOTE_SEPARATORS = ("separator", "continuationSeparator", "continuationNotice")

    def __init__(self, package: _Package, images: _Images):
        super().__init__(package, images)
        self._styles = self._read_styles()
        self._numbering = self._read_numbering()
        self._counters: dict[str, dict[int, int]] = {}
        self._comment_ids: list[str] = []

    def convert(self) -> str:
        part = "word/document.xml"
        body = _child(self._package.xml(part), "w:body")
        if body is None:
            raise OfficeFileError("word/document.xml could not be read")
        relationships = self._package.relationships(part)

        blocks = self._headers_and_footers(relationships)
        blocks += self._blocks(body, relationships)
        blocks += self._notes(_related_part(relationships, "footnotes"), "footnote")
        blocks += self._notes(_related_part(relationships, "endnotes"), "endnote")
        blocks += self._comments(_related_part(relationships, "comments"))
        return "\n\n".join(blocks)

    # --- 文書の骨組み ---

    def _blocks(
        self, container: ET.Element, relationships: dict[str, tuple[str, str]]
    ) -> list[str]:
        """段落と表を、文書の順に Markdown のかたまりにする"""
        blocks = []
        paragraph_tag, table_tag = _q("w:p"), _q("w:tbl")
        wrappers = {_q(name) for name in _WORD_WRAPPERS} | {
            _MC_ALTERNATE,
            _q("mc:Choice"),
        }
        for child in container:
            if child.tag == paragraph_tag:
                text = self._paragraph(child, relationships)
            elif child.tag == table_tag:
                text = self._table(child, relationships)
            elif child.tag in wrappers:
                blocks += self._blocks(child, relationships)
                continue
            else:
                continue
            if text:
                blocks.append(text)
        return blocks

    def _headers_and_footers(
        self, relationships: dict[str, tuple[str, str]]
    ) -> list[str]:
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
            if note.get(_q("w:type")) in self._NOTE_SEPARATORS:
                continue
            text = " ".join(self._blocks(note, relationships)).strip()
            if text:
                blocks.append(f"[{kind} {note.get(_q('w:id'))}] {text}")
        return blocks

    def _comments(self, part: Optional[str]) -> list[str]:
        root = self._package.xml(part) if part else None
        if root is None or not self._comment_ids:
            return []
        relationships = self._package.relationships(part)
        comments = {
            comment.get(_q("w:id")): comment
            for comment in root.findall(_q("w:comment"))
        }
        blocks = []
        for comment_id in dict.fromkeys(self._comment_ids):
            comment = comments.get(comment_id)
            if comment is None:
                continue
            author = comment.get(_q("w:author")) or "unknown"
            text = " ".join(self._blocks(comment, relationships))
            blocks.append(f"[comment {comment_id}] ({author}) {text}")
        return blocks

    # --- 段落 ---

    def _paragraph(
        self, paragraph: ET.Element, relationships: dict[str, tuple[str, str]]
    ) -> str:
        properties = _child(paragraph, "w:pPr")
        text = self._inline(paragraph, relationships).strip()
        if not text:
            return ""
        style_id = _val(_child(properties, "w:pStyle"))

        outline = _val(_child(properties, "w:outlineLvl"))
        level = (
            _int(outline) + 1 if outline is not None and _int(outline, 9) < 9 else None
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

    def _inline(
        self, element: ET.Element, relationships: dict[str, tuple[str, str]]
    ) -> str:
        """段落の中身を文字にする。変更履歴・脚注・コメント・画像は目印にして残す"""
        parts = []
        for child in element:
            tag = child.tag
            if tag in (_q("w:pPr"), _q("w:rPr"), _q("w:instrText"), _MC_FALLBACK):
                continue
            if tag in (_q("w:t"), _q("w:delText")):
                parts.append(child.text or "")
            elif tag in (_q("w:tab"), _q("w:ptab")):
                parts.append("\t")
            elif tag in (_q("w:br"), _q("w:cr")):
                parts.append("\n")
            elif tag == _q("w:noBreakHyphen"):
                parts.append("-")
            elif tag in (_q("w:ins"), _q("w:del")):
                inner = self._inline(child, relationships)
                if inner:
                    kind = "inserted" if tag == _q("w:ins") else "deleted"
                    parts.append(f"[{kind}: {inner}]")
            elif tag in (_q("w:footnoteReference"), _q("w:endnoteReference")):
                kind = "footnote" if tag == _q("w:footnoteReference") else "endnote"
                parts.append(f"[{kind} {child.get(_q('w:id'))}]")
            elif tag == _q("w:commentReference"):
                comment_id = child.get(_q("w:id")) or ""
                self._comment_ids.append(comment_id)
                parts.append(f"[comment {comment_id}]")
            elif tag in (_q("w:drawing"), _q("w:pict"), _q("w:object")):
                parts.append(self._drawing(child, relationships))
            else:
                # w:r, w:hyperlink, w:sdt, w:fldSimple, mc:AlternateContent など
                parts.append(self._inline(child, relationships))
        return "".join(parts)

    def _drawing(
        self, element: ET.Element, relationships: dict[str, tuple[str, str]]
    ) -> str:
        text_box = _q("w:txbxContent")
        parts = []
        for node in _walk(element, skip=(text_box,)):
            found = self._image_or_chart(node, relationships)
            if found:
                parts.append(found)
        for box in (node for node in _walk(element) if node.tag == text_box):
            text = " / ".join(self._blocks(box, relationships))
            if text:
                parts.append(f"[text box] {text}")
        return " ".join(parts)

    def _table(
        self, table: ET.Element, relationships: dict[str, tuple[str, str]]
    ) -> str:
        rows = []
        for row in _word_children(table, "w:tr"):
            cells = []
            for cell in _word_children(row, "w:tc"):
                properties = _child(cell, "w:tcPr")
                span = max(_int(_val(_child(properties, "w:gridSpan")), 1), 1)
                merge = _child(properties, "w:vMerge")
                if merge is not None and _val(merge) != "restart":
                    cells.append("(merged)")
                else:
                    cells.append(
                        _table_cell("\n".join(self._blocks(cell, relationships)))
                    )
                cells += [""] * (span - 1)
            rows.append(cells)
        return _markdown_table(rows)

    # --- スタイルと番号 ---

    def _read_styles(self) -> dict[str, dict]:
        root = self._package.xml("word/styles.xml")
        styles = {}
        for style in root.findall(_q("w:style")) if root is not None else []:
            if style.get(_q("w:type")) != "paragraph":
                continue
            name = (_val(_child(style, "w:name")) or "").lower()
            properties = _child(style, "w:pPr")
            heading = self._HEADING_STYLE.fullmatch(name)
            level = (
                int(heading.group(1)) if heading else (1 if name == "title" else None)
            )
            outline = _val(_child(properties, "w:outlineLvl"))
            if level is None and outline is not None and _int(outline, 9) < 9:
                level = _int(outline) + 1
            styles[style.get(_q("w:styleId"), "")] = {
                "level": level,
                "numbering": _numbering_reference(properties),
                "based_on": _val(_child(style, "w:basedOn")),
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
        for definition in root.findall(_q("w:abstractNum")):
            levels = {}
            for level in definition.findall(_q("w:lvl")):
                levels[_int(level.get(_q("w:ilvl")))] = (
                    _val(_child(level, "w:numFmt")) or "decimal",
                    _val(_child(level, "w:lvlText")) or "",
                    _int(_val(_child(level, "w:start")), 1),
                )
            abstract[definition.get(_q("w:abstractNumId"))] = levels
        return {
            number.get(_q("w:numId")): abstract.get(
                _val(_child(number, "w:abstractNumId")), {}
            )
            for number in root.findall(_q("w:num"))
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


# ---------------------------------------------------------------------------
# Excel
# ---------------------------------------------------------------------------

# 組み込みの表示形式（numFmtId）。styles.xml には書かれない
_BUILTIN_NUMBER_FORMATS = {
    0: "General",
    1: "0",
    2: "0.00",
    3: "#,##0",
    4: "#,##0.00",
    9: "0%",
    10: "0.00%",
    11: "0.00E+00",
    12: "# ?/?",
    13: "# ??/??",
    14: "yyyy/m/d",
    15: "d-mmm-yy",
    16: "d-mmm",
    17: "mmm-yy",
    18: "h:mm AM/PM",
    19: "h:mm:ss AM/PM",
    20: "h:mm",
    21: "h:mm:ss",
    22: "yyyy/m/d h:mm",
    37: "#,##0 ;(#,##0)",
    38: "#,##0 ;(#,##0)",
    39: "#,##0.00;(#,##0.00)",
    40: "#,##0.00;(#,##0.00)",
    45: "mm:ss",
    46: "[h]:mm:ss",
    47: "mm:ss.0",
    48: "##0.0E+0",
    49: "@",
    # 日本語の Excel の組み込み形式（和暦を含む）。西暦の日付・時刻として出す
    27: "yyyy/m/d",
    28: "yyyy/m/d",
    29: "yyyy/m/d",
    30: "m/d/yy",
    31: "yyyy/m/d",
    32: "h:mm",
    33: "h:mm:ss",
    34: "yyyy/m/d",
    35: "yyyy/m/d",
    36: "yyyy/m/d",
    50: "yyyy/m/d",
    51: "yyyy/m/d",
    52: "yyyy/m",
    53: "m/d",
    54: "yyyy/m/d",
    55: "yyyy/m",
    56: "m/d",
    57: "yyyy/m/d",
    58: "yyyy/m/d",
}

# A1 形式のセル参照。関数名（LOG10( など）、シート名（Q1!）、名前の一部は除く
_REFERENCE = re.compile(
    r"(?<![A-Za-z0-9_.])(\$?)([A-Z]{1,3})(\$?)([0-9]+)(?![0-9A-Za-z_(!])"
)
_QUOTED = re.compile(r"(\"(?:[^\"]|\"\")*\"|'(?:[^']|'')*')")


def _column_letters(index: int) -> str:
    letters = ""
    while index > 0:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def _column_index(letters: str) -> int:
    index = 0
    for letter in letters:
        index = index * 26 + ord(letter) - 64
    return index


def _outside_quotes(text: str, transform: Callable[[str], str]) -> str:
    """文字列リテラルとシート名の引用の外だけを変える"""
    parts = _QUOTED.split(text)
    return "".join(
        part if index % 2 else transform(part) for index, part in enumerate(parts)
    )


def _shift_formula(formula: str, rows: int, columns: int) -> str:
    """
    共有数式を、元のセルからずれた位置の式に直す。

    下にコピーした数式は、先頭のセルにだけ式が入り、残りのセルは共有番号（si）
    だけで保存される。元の式の相対参照（$ の付かない行・列）をずらして戻す。
    """

    def shift(match: re.Match) -> str:
        column_absolute, letters, row_absolute, number = match.groups()
        column = _column_index(letters) + (0 if column_absolute else columns)
        row = int(number) + (0 if row_absolute else rows)
        if column < 1 or row < 1:
            return match.group(0)
        return f"{column_absolute}{_column_letters(column)}{row_absolute}{row}"

    return _outside_quotes(formula, lambda part: _REFERENCE.sub(shift, part))


def _relative_shape(formula: str, row: int) -> str:
    """
    数式の相対的な行を、そのセルの行からのずれ（{r}, {r-1}）で書いた形。

    行ごとにコピーした数式は同じ形になるので、1行にまとめられる。行を固定した
    参照（$H$2）は、固定しているのが意味なのでそのまま残す。
    """

    def replace(match: re.Match) -> str:
        column_absolute, letters, row_absolute, number = match.groups()
        if row_absolute:
            return match.group(0)
        offset = int(number) - row
        return f"{column_absolute}{letters}{{r{'' if offset == 0 else f'{offset:+d}'}}}"

    return _outside_quotes(formula, lambda part: _REFERENCE.sub(replace, part))


def _formula_lines(formulas: list[tuple[int, int, str]]) -> list[str]:
    """同じ列に同じ形でコピーされた数式を、範囲1行にまとめる"""
    groups: dict[tuple[int, str], list[tuple[int, str]]] = {}
    for row, column, formula in formulas:
        groups.setdefault((column, _relative_shape(formula, row)), []).append(
            (row, formula)
        )

    lines = []
    for index, ((column, shape), cells) in enumerate(groups.items()):
        if index >= MAX_FORMULAS_PER_SHEET:
            lines.append(
                f"[formulas left out] {len(groups) - MAX_FORMULAS_PER_SHEET} more distinct "
                "formulas are not shown."
            )
            break
        letters = _column_letters(column)
        if len(cells) == 1:
            row, formula = cells[0]
            lines.append(f"[formula] {letters}{row}: ={formula}")
        else:
            rows = [row for row, _ in cells]
            lines.append(
                f"[formula] {letters}{min(rows)}:{letters}{max(rows)}: ={shape}  "
                f"({len(cells)} cells; {{r}} is each cell's own row)"
            )
    return lines


def _general_number(number: float) -> str:
    if number.is_integer() and abs(number) < 1e15:
        return str(int(number))
    return f"{number:.15g}"


def _first_section(code: str) -> str:
    """表示形式の最初の区分（「正;負;ゼロ;文字」の「正」）"""
    parts = _QUOTED.split(code)
    kept = []
    for index, part in enumerate(parts):
        if index % 2 == 0 and ";" in part:
            kept.append(part.split(";", 1)[0])
            break
        kept.append(part)
    return "".join(kept)


def _excel_datetime(number: float, date1904: bool) -> Optional[datetime]:
    if number < 0 or number > 2_958_465:
        return None
    if date1904:
        base = datetime(1904, 1, 1)
    elif number < 60:
        # Excel は存在しない 1900/2/29 を数えるので、それより前は1日ずれる
        base = datetime(1899, 12, 31)
    else:
        base = datetime(1899, 12, 30)
    return base + timedelta(seconds=round(number * 86400))


def _format_datetime(number: float, section: str, bare: str, date1904: bool) -> str:
    lowered = bare.lower()
    if re.search(r"\[h+\]", section.lower()):
        # 経過時間（24時間を超えて数える）
        total = round(number * 86400)
        hours, remainder = divmod(total, 3600)
        minutes, seconds = divmod(remainder, 60)
        return (
            f"{hours}:{minutes:02d}:{seconds:02d}"
            if "s" in lowered
            else f"{hours}:{minutes:02d}"
        )
    moment = _excel_datetime(number, date1904)
    if moment is None:
        return _general_number(number)
    has_time = bool(re.search(r"[hs]", lowered))
    has_date = bool(re.search(r"[yd]", lowered)) or ("m" in lowered and not has_time)
    pieces = []
    if has_date:
        if "y" not in lowered:
            pieces.append(moment.strftime("%m/%d"))
        elif "d" not in lowered:
            pieces.append(moment.strftime("%Y/%m"))
        else:
            pieces.append(moment.strftime("%Y/%m/%d"))
    if has_time:
        pieces.append(moment.strftime("%H:%M:%S" if "s" in lowered else "%H:%M"))
    return " ".join(pieces)


def _affixes(section: str) -> tuple[str, str]:
    """数字の前後に表示する文字（"¥"、円、% など）"""
    tokens = re.findall(r'"[^"]*"|\\.|\[[^\]]*\]|_.|\*.|.', section)
    prefix: list[str] = []
    suffix: list[str] = []
    seen_digit = False
    for token in tokens:
        if token in "0#?,.":
            seen_digit = True
            suffix.clear()
            continue
        if token.startswith('"'):
            literal = token[1:-1]
        elif token.startswith("\\"):
            literal = token[1:]
        elif token.startswith("["):
            currency = re.match(r"\[\$([^-\]]*)", token)
            literal = currency.group(1) if currency else ""
        elif token.startswith("_"):
            literal = " "
        elif token.startswith("*"):
            literal = ""
        else:
            literal = token
        (suffix if seen_digit else prefix).append(literal)
    return "".join(prefix), "".join(suffix).rstrip()


def _format_number(raw: str, code: str, date1904: bool) -> str:
    """セルの値に表示形式を当てる。丸めで表示が変わるときは、元の値を括弧で添える"""
    try:
        number = float(raw)
    except ValueError:
        return raw
    section = _first_section(code)
    bare = re.sub(r'"[^"]*"|\\.|\[[^\]]*\]|_.|\*.', "", section)
    if bare.strip().lower() in ("", "general", "@"):
        return _general_number(number)
    if re.search(r"[ymdhs]", bare.lower()) and not re.search(r"[0#?]", bare):
        return _format_datetime(number, section, bare, date1904)

    digits = re.search(r"[0#?][0#?,]*(\.[0#?]+)?", bare)
    if digits is None:
        return _general_number(number)
    percent = "%" in bare
    exponent = "e" in bare.lower()
    value = number * 100 if percent else number
    decimals = len(digits.group(1)) - 1 if digits.group(1) else 0
    sign = "-" if value < 0 else ""
    prefix, suffix = _affixes(section)

    if exponent:
        return f"{sign}{prefix}{abs(value):.{decimals}E}"
    exact = Decimal(repr(abs(value)))
    rounded = exact.quantize(Decimal(1).scaleb(-decimals), rounding=ROUND_HALF_UP)
    text = (
        f"{rounded:,.{decimals}f}"
        if "," in digits.group(0)
        else f"{rounded:.{decimals}f}"
    )
    formatted = f"{sign}{prefix}{text}{suffix}"
    if not percent and rounded != exact:
        formatted += f" ({_general_number(number)})"
    return formatted


def _rich_text(element: Optional[ET.Element]) -> str:
    """共有文字列やコメントの文字。ふりがな（rPh）は読みなので入れない"""
    if element is None:
        return ""
    parts = []
    for child in element:
        if child.tag == _q("s:t"):
            parts.append(child.text or "")
        elif child.tag == _q("s:r"):
            text = _child(child, "s:t")
            parts.append((text.text or "") if text is not None else "")
    return "".join(parts)


@dataclass
class _SheetCells:
    values: dict[tuple[int, int], str] = field(default_factory=dict)
    formulas: list[tuple[int, int, str]] = field(default_factory=list)
    hidden_rows: set[int] = field(default_factory=set)
    rows_left_out: set[int] = field(default_factory=set)
    columns_left_out: bool = False
    cells_left_out: int = 0


class _XlsxConverter(_Converter):
    def __init__(self, package: _Package, images: _Images):
        super().__init__(package, images)
        self._strings = [
            _rich_text(item) for item in self._findall("xl/sharedStrings.xml", "s:si")
        ]
        self._formats = self._read_number_formats()
        self._date1904 = False
        self._cells_read = 0

    def _findall(self, part: str, name: str) -> list[ET.Element]:
        root = self._package.xml(part)
        return root.findall(_q(name)) if root is not None else []

    def convert(self) -> str:
        part = "xl/workbook.xml"
        workbook = self._package.xml(part)
        if workbook is None:
            raise OfficeFileError("xl/workbook.xml could not be read")
        properties = _child(workbook, "s:workbookPr")
        self._date1904 = properties is not None and properties.get("date1904") in (
            "1",
            "true",
        )
        relationships = self._package.relationships(part)

        sections = []
        for sheet in _elements(_child(workbook, "s:sheets")):
            target = relationships.get(sheet.get(_q("r:id")) or "")
            if target:
                sections.append(
                    self._sheet(
                        sheet.get("name", ""), target[1], sheet.get("state", "visible")
                    )
                )
        return "\n\n".join(sections)

    def _read_number_formats(self) -> list[str]:
        root = self._package.xml("xl/styles.xml")
        if root is None:
            return []
        custom = {
            _int(fmt.get("numFmtId")): fmt.get("formatCode", "")
            for fmt in _elements(_child(root, "s:numFmts"))
        }
        return [
            custom.get(
                _int(xf.get("numFmtId")),
                _BUILTIN_NUMBER_FORMATS.get(_int(xf.get("numFmtId")), "General"),
            )
            for xf in _elements(_child(root, "s:cellXfs"))
        ]

    def _sheet(self, name: str, part: str, state: str) -> str:
        heading = f"## Sheet: {name}" + ("" if state == "visible" else f" ({state})")
        root = self._package.xml(part)
        if root is None:
            return f"{heading}\n(this sheet could not be read)"

        cells = self._read_cells(root)
        lines = [heading, self._values_table(cells) or "(no values)"]

        hidden_columns = sorted(
            column
            for column in self._hidden_columns(root)
            if any(c == column for _, c in cells.values)
        )
        if hidden_columns:
            lines.append(
                "[hidden columns] "
                + ", ".join(_column_letters(c) for c in hidden_columns)
            )
        if cells.rows_left_out:
            lines.append(
                f"[rows left out] {len(cells.rows_left_out)} more rows with values are not shown "
                f"(only the first {MAX_SHEET_ROWS} are included)."
            )
        if cells.columns_left_out:
            lines.append(
                f"[columns left out] columns after {_column_letters(MAX_SHEET_COLUMNS)} are not shown."
            )
        if cells.cells_left_out:
            lines.append(
                f"[cells left out] {cells.cells_left_out} more cells are not shown "
                f"(the limit for a workbook is {MAX_WORKBOOK_CELLS} cells)."
            )
        merged = [
            merge.get("ref", "") for merge in _elements(_child(root, "s:mergeCells"))
        ]
        if merged:
            lines.append("[merged cells] " + ", ".join(merged))
        lines += _formula_lines(cells.formulas)

        for relationship_type, target in self._package.relationships(part).values():
            if relationship_type.endswith("/comments"):
                lines += self._comment_lines(target)
            elif relationship_type.endswith("/drawing"):
                lines += self._drawing_lines(target)
        return "\n".join(lines)

    def _read_cells(self, root: ET.Element) -> _SheetCells:
        cells = _SheetCells()
        shared: dict[str, tuple[int, int, str]] = {}
        rows_with_values: set[int] = set()
        row_number = 0
        for row in _elements(_child(root, "s:sheetData")):
            row_number = _int(row.get("r"), row_number + 1)
            if row.get("hidden") in ("1", "true"):
                cells.hidden_rows.add(row_number)
            column = 0
            for cell in row.findall(_q("s:c")):
                reference = re.fullmatch(r"\$?([A-Z]+)\$?\d+", cell.get("r") or "")
                column = _column_index(reference.group(1)) if reference else column + 1

                formula = self._formula(cell, row_number, column, shared)
                if formula:
                    cells.formulas.append((row_number, column, formula))
                text = self._cell_value(cell)
                if text == "":
                    continue
                if (
                    row_number not in rows_with_values
                    and len(rows_with_values) >= MAX_SHEET_ROWS
                ):
                    cells.rows_left_out.add(row_number)
                elif column > MAX_SHEET_COLUMNS:
                    cells.columns_left_out = True
                elif self._cells_read >= MAX_WORKBOOK_CELLS:
                    cells.cells_left_out += 1
                else:
                    rows_with_values.add(row_number)
                    cells.values[(row_number, column)] = text
                    self._cells_read += 1
        return cells

    def _values_table(self, cells: _SheetCells) -> str:
        if not cells.values:
            return ""
        columns = sorted({column for _, column in cells.values})
        rows = [[""] + [_column_letters(column) for column in columns]]
        for row in sorted({row for row, _ in cells.values}):
            label = f"{row} (hidden)" if row in cells.hidden_rows else str(row)
            rows.append(
                [label]
                + [
                    _table_cell(cells.values.get((row, column), ""))
                    for column in columns
                ]
            )
        return _markdown_table(rows)

    def _hidden_columns(self, root: ET.Element) -> set[int]:
        hidden: set[int] = set()
        for column in _elements(_child(root, "s:cols")):
            if column.get("hidden") in ("1", "true"):
                start = _int(column.get("min"))
                end = min(_int(column.get("max")), start + MAX_SHEET_COLUMNS)
                hidden.update(range(start, end + 1))
        return hidden

    def _formula(
        self,
        cell: ET.Element,
        row: int,
        column: int,
        shared: dict[str, tuple[int, int, str]],
    ) -> str:
        element = _child(cell, "s:f")
        if element is None:
            return ""
        text = element.text or ""
        if element.get("t") == "shared":
            index = element.get("si", "")
            if text:
                shared[index] = (row, column, text)
            elif index in shared:
                origin_row, origin_column, origin = shared[index]
                text = _shift_formula(origin, row - origin_row, column - origin_column)
        return text

    def _cell_value(self, cell: ET.Element) -> str:
        kind = cell.get("t", "n")
        if kind == "inlineStr":
            return _rich_text(_child(cell, "s:is"))
        value = _child(cell, "s:v")
        raw = value.text if value is not None and value.text is not None else ""
        if raw == "":
            return ""
        if kind == "s":
            index = _int(raw, -1)
            return self._strings[index] if 0 <= index < len(self._strings) else raw
        if kind == "b":
            return "TRUE" if raw == "1" else "FALSE"
        if kind in ("str", "e", "d"):
            return raw
        style = _int(cell.get("s"))
        code = self._formats[style] if style < len(self._formats) else "General"
        return _format_number(raw, code, self._date1904)

    def _comment_lines(self, part: str) -> list[str]:
        root = self._package.xml(part)
        if root is None:
            return []
        authors = [author.text or "" for author in _elements(_child(root, "s:authors"))]
        lines = []
        for comment in _elements(_child(root, "s:commentList")):
            author_id = _int(comment.get("authorId"), -1)
            author = authors[author_id] if 0 <= author_id < len(authors) else ""
            text = _rich_text(_child(comment, "s:text")).strip()
            lines.append(
                f"[comment] {comment.get('ref', '')}"
                + (f" ({author})" if author else "")
                + f": {text}"
            )
        return lines

    def _drawing_lines(self, part: str) -> list[str]:
        """シートに置いたグラフ・画像・図形。置いた場所のセルを添える"""
        root = self._package.xml(part)
        if root is None:
            return []
        relationships = self._package.relationships(part)
        lines = []
        for anchor in root:
            start = _child(anchor, "xdr:from")
            where = ""
            if start is not None:
                column = (
                    _int(
                        (
                            _child(start, "xdr:col").text
                            if _child(start, "xdr:col") is not None
                            else None
                        )
                    )
                    + 1
                )
                row = (
                    _int(
                        (
                            _child(start, "xdr:row").text
                            if _child(start, "xdr:row") is not None
                            else None
                        )
                    )
                    + 1
                )
                where = f" at {_column_letters(column)}{row}"
            for node in _walk(anchor):
                if node.tag == _q("xdr:sp"):
                    text = " ".join(_drawing_text(node).split("\n"))
                    if text:
                        lines.append(f"[shape{where}] {text}")
                    continue
                found = self._image_or_chart(node, relationships)
                if found:
                    first, _, rest = found.partition("\n")
                    lines.append(first + where + ("\n" + rest if rest else ""))
        return lines


# ---------------------------------------------------------------------------
# PowerPoint
# ---------------------------------------------------------------------------


def _position(shape: ET.Element) -> tuple[float, float]:
    """左上の位置（EMU）。読む順に並べるのに使う。位置が無ければ最後にする"""
    offset = _first(shape, "a:off")
    if offset is None:
        return (float("inf"), float("inf"))
    return (_int(offset.get("y")), _int(offset.get("x")))


class _PptxConverter(_Converter):
    _TITLE_PLACEHOLDERS = ("title", "ctrTitle")
    _NOTES_PLACEHOLDERS_SKIPPED = ("sldNum", "sldImg", "hdr", "ftr", "dt")

    def convert(self) -> str:
        slides = self._slide_parts()
        sections = []
        if len(slides) > MAX_SLIDES:
            sections.append(
                f"This deck has {len(slides)} slides. Only the first {MAX_SLIDES} are included below."
            )
        for number, part in enumerate(slides[:MAX_SLIDES], start=1):
            sections.append(self._slide(number, part))
        return "\n\n".join(sections)

    def _slide_parts(self) -> list[str]:
        """スライドの並び順は presentation.xml の一覧で決まる（ファイル名の番号とは限らない）"""
        part = "ppt/presentation.xml"
        relationships = self._package.relationships(part)
        slides = []
        for slide in _elements(_child(self._package.xml(part), "p:sldIdLst")):
            target = relationships.get(slide.get(_q("r:id")) or "")
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
            key=lambda name: _int(re.search(r"(\d+)\.xml$", name).group(1)),
        )

    def _slide(self, number: int, part: str) -> str:
        root = self._package.xml(part)
        if root is None:
            return f"## Slide {number}\n(this slide could not be read)"
        relationships = self._package.relationships(part)

        placed: list[tuple[float, float, str]] = []
        labels: dict[str, str] = {}
        connections: list[tuple[str, str]] = []
        title = self._shapes(
            _path(root, "p:cSld", "p:spTree"),
            relationships,
            placed,
            labels,
            connections,
        )

        heading = f"## Slide {number}" + (f": {title}" if title else "")
        if root.get("show") in ("0", "false"):
            heading += " (hidden)"
        placed.sort(key=lambda item: (item[0], item[1]))
        lines = [heading] + [text for _, _, text in placed]
        # コネクタは、つないだ図形の ID を持っている。図を画像で読むと矢印の両端を読み違える
        for start, end in connections:
            if labels.get(start) and labels.get(end):
                lines.append(f"[connection] {labels[start]} -> {labels[end]}")
        lines += self._notes(relationships)
        return "\n".join(lines)

    def _shapes(
        self,
        container: Optional[ET.Element],
        relationships: dict[str, tuple[str, str]],
        placed: list[tuple[float, float, str]],
        labels: dict[str, str],
        connections: list[tuple[str, str]],
    ) -> str:
        """図形を読み、配置順に並べる材料を集める。タイトルの文字を返す"""
        title = ""
        for shape in container if container is not None else []:
            tag = shape.tag
            if tag in (_MC_ALTERNATE, _q("mc:Choice"), _q("p:grpSp")):
                title = (
                    self._shapes(shape, relationships, placed, labels, connections)
                    or title
                )
            elif tag == _q("p:sp"):
                text = "\n".join(
                    "  " * level + line
                    for level, line in _drawing_paragraphs(_child(shape, "p:txBody"))
                )
                if not text:
                    continue
                one_line = " ".join(text.split())
                properties = _path(shape, "p:nvSpPr", "p:cNvPr")
                if properties is not None:
                    labels[properties.get("id", "")] = one_line
                placeholder = _path(shape, "p:nvSpPr", "p:nvPr", "p:ph")
                if (
                    placeholder is not None
                    and placeholder.get("type") in self._TITLE_PLACEHOLDERS
                    and not title
                ):
                    title = one_line
                else:
                    placed.append((*_position(shape), text))
            elif tag == _q("p:graphicFrame"):
                text = self._frame(shape, relationships)
                if text:
                    placed.append((*_position(shape), text))
            elif tag == _q("p:pic"):
                blip = _first(shape, "a:blip")
                marker = (
                    self._image_or_chart(blip, relationships)
                    if blip is not None
                    else None
                )
                if marker:
                    properties = _path(shape, "p:nvPicPr", "p:cNvPr")
                    description = (
                        (properties.get("descr") or "").strip()
                        if properties is not None
                        else ""
                    )
                    placed.append(
                        (
                            *_position(shape),
                            marker + (f" ({description})" if description else ""),
                        )
                    )
            elif tag == _q("p:cxnSp"):
                start, end = _first(shape, "a:stCxn"), _first(shape, "a:endCxn")
                if start is not None and end is not None:
                    connections.append((start.get("id", ""), end.get("id", "")))
        return title

    def _frame(
        self, frame: ET.Element, relationships: dict[str, tuple[str, str]]
    ) -> str:
        """表・グラフ・SmartArt"""
        table = _first(frame, "a:tbl")
        if table is not None:
            rows = []
            for row in table.findall(_q("a:tr")):
                rows.append(
                    [
                        (
                            "(merged)"
                            if cell.get("hMerge") in ("1", "true")
                            or cell.get("vMerge") in ("1", "true")
                            else _table_cell(_drawing_text(_child(cell, "a:txBody")))
                        )
                        for cell in row.findall(_q("a:tc"))
                    ]
                )
            return _markdown_table(rows)
        chart = _first(frame, "c:chart")
        if chart is not None:
            return self._image_or_chart(chart, relationships) or ""
        diagram = _first(frame, "dgm:relIds")
        if diagram is not None:
            target = relationships.get(diagram.get(_q("r:dm")) or "")
            text = _drawing_text(self._package.xml(target[1])) if target else ""
            return "[diagram] " + " / ".join(text.split("\n")) if text else ""
        return ""

    def _notes(self, relationships: dict[str, tuple[str, str]]) -> list[str]:
        part = _related_part(relationships, "notesSlide")
        tree = _path(self._package.xml(part), "p:cSld", "p:spTree") if part else None
        texts = []
        for shape in (node for node in _walk(tree) if node.tag == _q("p:sp")):
            placeholder = _path(shape, "p:nvSpPr", "p:nvPr", "p:ph")
            if (
                placeholder is not None
                and placeholder.get("type") in self._NOTES_PLACEHOLDERS_SKIPPED
            ):
                # ノートのスライド番号やスライドの縮小画像は、話す内容ではない
                continue
            text = " ".join(_drawing_text(_child(shape, "p:txBody")).split())
            if text:
                texts.append(text)
        return ["[notes] " + " ".join(texts)] if texts else []
