"""Office ファイルを Markdown と埋め込み画像にする入口"""

from __future__ import annotations

import posixpath
import zipfile
from typing import Callable, Optional

from . import limits
from .converter import Converter
from .excel import ExcelConverter
from .model import OfficeDocument, OfficeFileError, ProtectedOfficeFileError
from .package import Images, Package, sensitivity_label
from .powerpoint import PowerPointConverter
from .word import WordConverter

OFFICE_FILE_EXTENSIONS = (".docx", ".xlsx", ".pptx")

# パスワードや暗号化ラベルで保護された OOXML は ZIP ではなく、この形式になる
_CFB_SIGNATURE = bytes.fromhex("d0cf11e0a1b11ae1")

_CONVERTERS: dict[str, Callable[[Package, Images], Converter]] = {
    ".docx": WordConverter,
    ".xlsx": ExcelConverter,
    ".pptx": PowerPointConverter,
}


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
    converter = _CONVERTERS.get(posixpath.splitext(path.lower())[1])
    if converter is None:
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
        package = Package(archive)
        images = Images(package)
        body = converter(package, images).convert()
        label = sensitivity_label(package)

    header = [f"# {name}"]
    if label:
        # Bedrock はこのラベルをモデルに渡さないので、社外秘の文書も普通の文書と同じに読まれる
        header.append(f"Sensitivity label: {label}")
    selected, left_out = images.select(limits.MAX_IMAGES_PER_FILE)
    if left_out:
        header.append(
            f"Images not attached (only the {limits.MAX_IMAGES_PER_FILE} largest are): "
            + ", ".join(left_out)
        )
    if len(body) > limits.MAX_MARKDOWN_CHARS:
        body = body[: limits.MAX_MARKDOWN_CHARS]
        header.append(
            "This document is too long to include in full. Only its first "
            f"{limits.MAX_MARKDOWN_CHARS} characters are included below."
        )
    return OfficeDocument(markdown="\n".join(header) + "\n\n" + body, images=selected)
