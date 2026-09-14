"""Office ファイル（ZIP）の部品、部品どうしの関係、埋め込み画像、秘密度ラベルを読む"""

from __future__ import annotations

import io
import posixpath
import zipfile
from typing import Optional
from xml.etree import ElementTree as ET

from PIL import Image

from . import limits
from .model import EmbeddedImage, OfficeFileError
from .ooxml import Relationships, q

_IMAGE_FORMATS = {"PNG": "png", "JPEG": "jpeg", "GIF": "gif", "WEBP": "webp"}


class Package:
    def __init__(self, archive: zipfile.ZipFile):
        self._archive = archive
        self.names = set(archive.namelist())

    def read(self, name: str) -> Optional[bytes]:
        try:
            info = self._archive.getinfo(name)
        except KeyError:
            return None
        if info.file_size > limits.MAX_PART_BYTES:
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

    def relationships(self, part: str) -> Relationships:
        """部品の関係。外部へのリンクは除く"""
        directory, base = posixpath.split(part)
        root = self.xml(posixpath.join(directory, "_rels", base + ".rels"))
        if root is None:
            return {}
        result = {}
        for relationship in root.findall(q("rel:Relationship")):
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


def related_part(relationships: Relationships, kind: str) -> Optional[str]:
    """種類の URI が /kind で終わる最初の参照先"""
    for relationship_type, target in relationships.values():
        if relationship_type.endswith("/" + kind):
            return target
    return None


class Images:
    """
    埋め込み画像を集める。同じ画像は1回だけ数え、Markdown に置く目印を返す。
    Converse に渡せない画像（形式・大きさ）は、渡さない理由を目印に書く。
    """

    def __init__(self, package: Package):
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
            elif (
                len(data) > limits.MAX_IMAGE_BYTES
                or max(size) > limits.MAX_IMAGE_SIDE_PIXELS
            ):
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


def sensitivity_label(package: Package) -> Optional[str]:
    """Microsoft Purview の秘密度ラベル名（暗号化しないラベルは docProps/custom.xml に残る）"""
    root = package.xml("docProps/custom.xml")
    if root is None:
        return None
    for prop in root.findall(q("cp:property")):
        name = prop.get("name", "")
        if name.startswith("MSIP_Label_") and name.endswith("_Name"):
            text = "".join(prop.itertext()).strip()
            if text:
                return text
    return None
