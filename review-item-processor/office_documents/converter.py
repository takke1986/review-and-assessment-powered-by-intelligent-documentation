"""形式ごとの変換（Word・Excel・PowerPoint）の土台"""

from __future__ import annotations

from typing import Optional
from xml.etree import ElementTree as ET

from .drawing import chart_lines
from .ooxml import Relationships, q
from .package import Images, Package


class Converter:
    def __init__(self, package: Package, images: Images):
        self._package = package
        self._images = images

    def convert(self) -> str:
        """文書の本文を Markdown にする（ファイル名などの見出しは含めない）"""
        raise NotImplementedError

    def _image_or_chart(
        self, node: ET.Element, relationships: Relationships
    ) -> Optional[str]:
        """a:blip・v:imagedata は画像の目印、c:chart はグラフの行にする"""
        if node.tag == q("a:blip"):
            target = relationships.get(node.get(q("r:embed")) or "")
            return self._images.marker(target[1]) if target else None
        if node.tag == q("v:imagedata"):
            target = relationships.get(node.get(q("r:id")) or "")
            return self._images.marker(target[1]) if target else None
        if node.tag == q("c:chart"):
            target = relationships.get(node.get(q("r:id")) or "")
            return "\n".join(chart_lines(self._package, target[1])) if target else None
        return None
