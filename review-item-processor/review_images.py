"""
画像を Converse の ImageBlock に収める。

Converse は画像1枚 3.75MB・一辺 8000px まで、形式は png・jpeg・gif・webp だけを受け付ける。
アップロードされた画像がこれを超えるときや BMP・TIFF のときは、縮小や形式の変換をした
コピーを作って、それを読ませる。
"""

from __future__ import annotations

import io
import os

from PIL import Image

MAX_IMAGE_BYTES = 3_750_000
MAX_IMAGE_SIDE_PIXELS = 8000

_SENDABLE_FORMATS = ("PNG", "JPEG", "GIF", "WEBP")
_JPEG_QUALITY = 85
# 収まるまで、一辺をこの割合ずつ縮める
_SHRINK_RATIO = 0.75


def encode_image(image: Image.Image) -> tuple[str, bytes]:
    """
    画像を JPEG（透過のある画像は PNG）にし、上限に収まるまで縮める。

    Returns:
        (Converse の画像形式, データ)
    """
    max_bytes, max_side = MAX_IMAGE_BYTES, MAX_IMAGE_SIDE_PIXELS
    has_alpha = image.mode in ("RGBA", "LA") or (
        image.mode == "P" and "transparency" in image.info
    )
    image = image.convert("RGBA" if has_alpha else "RGB")
    if max(image.size) > max_side:
        image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    while True:
        buffer = io.BytesIO()
        if has_alpha:
            image.save(buffer, "PNG", optimize=True)
        else:
            image.save(buffer, "JPEG", quality=_JPEG_QUALITY)
        data = buffer.getvalue()
        if len(data) <= max_bytes or min(image.size) <= 1:
            return ("png" if has_alpha else "jpeg"), data
        image = image.resize(
            (
                max(1, int(image.width * _SHRINK_RATIO)),
                max(1, int(image.height * _SHRINK_RATIO)),
            ),
            Image.Resampling.LANCZOS,
        )


def prepare_image_file(path: str, directory: str) -> str:
    """
    そのまま送れる画像はそのパスを、送れない画像は directory に作った縮小コピーのパスを返す。
    画像として開けないファイルはそのまま返し、読むときのエラーでモデルに伝える。
    """
    try:
        with Image.open(path) as image:
            if (
                image.format in _SENDABLE_FORMATS
                and max(image.size) <= MAX_IMAGE_SIDE_PIXELS
                and os.path.getsize(path) <= MAX_IMAGE_BYTES
            ):
                return path
            # 複数ページの TIFF などは、最初のページを使う
            image.seek(0)
            image_format, data = encode_image(image)
    except (OSError, Image.DecompressionBombError):
        return path

    stem = os.path.splitext(os.path.basename(path))[0]
    extension = "png" if image_format == "png" else "jpg"
    prepared = os.path.join(directory, f"{stem}.{extension}")
    with open(prepared, "wb") as handle:
        handle.write(data)
    return prepared
