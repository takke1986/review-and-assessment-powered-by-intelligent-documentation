"""変換の結果と、読めないときの例外"""

from __future__ import annotations

from dataclasses import dataclass, field


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
