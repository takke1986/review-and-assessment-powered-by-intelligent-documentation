"""区切ったページをモデルに読ませ、文字と図の説明を取り出す。

審査そのものとは分けてある。読み取りは**書類ごとに1回**で、チェック項目の
数だけ繰り返さない。ここで作った結果を、あとで全項目が使い回す。

ページを画像にして渡すのは、スキャンした書類でも読めるようにするため。
文字の入った PDF でも、図・押印・レイアウトは画像でないと分からない。

返事は JSON で受け取るが、そのまま信じない。ページ番号が範囲の外だったり、
JSON が壊れていたりするのは普通に起きる。解釈は parse_pages に閉じてあり、
読めなかった部分は捨てる（黙って別のページの内容にしない）
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from document_digest import DigestBatch, ImageDigest, PageDigest

logger = logging.getLogger(__name__)

# ページ画像の大きさ。これより大きく描いてもモデルは縮めて読む
PAGE_IMAGE_LONG_SIDE = 1568

READ_PROMPT = """You are transcribing a document so that it can be reviewed later.

You are given pages {first}-{last} of "{name}", one image per page, in order.

For each page, return:
- "page": the page number, as printed above each image
- "text": everything written on the page, as text. Keep the wording exactly as
  it appears, including headings, table contents, stamps, handwriting and
  anything filled into a form. Lay tables out so the rows and columns can still
  be told apart. Do not summarise, correct or translate.
- "figures": one entry for each drawing, diagram, chart, photograph, floor plan
  or signature on the page. Say what it shows and what can be read off it, in
  enough detail that someone who cannot see the page could answer questions
  about it. Use an empty list when the page has none.

Write "text" and "figures" in {language}.

Return only JSON, in this shape:
{{"pages": [{{"page": 1, "text": "...", "figures": ["..."]}}]}}

Return one entry per page you were given, even if a page is blank (use an empty
string). Never invent a page number you were not given."""


def build_read_prompt(
    *, name: str, batch: DigestBatch, language: str = "Japanese"
) -> str:
    return READ_PROMPT.format(
        first=batch.first_page,
        last=batch.last_page,
        name=name,
        language=language,
    )


def parse_pages(reply: str, batch: DigestBatch) -> list[PageDigest]:
    """モデルの返事からページを取り出す。

    範囲の外のページは捨てる。読んでいないページの内容を、読んだことに
    してしまうため。JSON が取り出せなければ空で返す（呼び出し側が
    「読めなかったページ」として扱う）
    """
    data = _load_json(reply)
    if data is None:
        logger.warning(
            "Could not read the transcription as JSON for pages %s-%s",
            batch.first_page,
            batch.last_page,
        )
        return []

    pages = data.get("pages") if isinstance(data, dict) else None
    if not isinstance(pages, list):
        return []

    digests: list[PageDigest] = []
    for entry in pages:
        if not isinstance(entry, dict):
            continue
        try:
            number = int(entry["page"])
        except (KeyError, TypeError, ValueError):
            continue
        if not batch.first_page <= number <= batch.last_page:
            logger.warning(
                "Ignoring page %s: it is outside the range %s-%s that was read",
                number,
                batch.first_page,
                batch.last_page,
            )
            continue
        figures = entry.get("figures")
        digests.append(
            PageDigest(
                page=number,
                text=str(entry.get("text") or ""),
                figures=[
                    str(figure)
                    for figure in (figures if isinstance(figures, list) else [])
                    if str(figure).strip()
                ],
            )
        )
    return digests


def _load_json(reply: str) -> Optional[Any]:
    """返事から JSON を取り出す。

    前後に説明が付くことや、``` で囲まれることがあるので、素直に
    json.loads できないときは中括弧の範囲を探す
    """
    text = (reply or "").strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    fenced = re.search(r"```(?:json)?\s*(.+?)```", text, re.DOTALL)
    if fenced:
        try:
            return json.loads(fenced.group(1))
        except json.JSONDecodeError:
            pass

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None
    return None


def render_pages(path: str, batch: DigestBatch) -> list[tuple[int, str, bytes]]:
    """ページを画像にする。(ページ番号, 形式, データ) を返す。

    描けないページは飛ばす。1ページのために読み取り全体を落とさない
    """
    import pypdfium2

    from review_images import encode_image

    images: list[tuple[int, str, bytes]] = []
    pdf = pypdfium2.PdfDocument(path)
    try:
        for number in range(batch.first_page, batch.last_page + 1):
            try:
                page = pdf[number - 1]
                scale = PAGE_IMAGE_LONG_SIDE / max(*page.get_size(), 1)
                bitmap = page.render(scale=scale).to_pil()
            except Exception as error:
                logger.warning("Page %s could not be drawn: %s", number, error)
                continue
            image_format, data = encode_image(bitmap)
            images.append((number, image_format, data))
    finally:
        pdf.close()
    return images


def build_read_content(
    *, path: str, name: str, batch: DigestBatch, language: str = "Japanese"
) -> list[dict[str, Any]]:
    """モデルに渡す中身を組み立てる。

    画像の前にページ番号を書いたテキストを置く。番号を書かないと、
    モデルは「何枚目か」で数えるしかなく、描けなかったページがあると
    そこから先がすべてずれる
    """
    content: list[dict[str, Any]] = []
    for number, image_format, data in render_pages(path, batch):
        content.append({"text": f"Page {number} of {name}:"})
        content.append({"image": {"format": image_format, "source": {"bytes": data}}})
    if not content:
        return []
    content.append(
        {"text": build_read_prompt(name=name, batch=batch, language=language)}
    )
    return content


IMAGE_PROMPT = """You are describing the pictures inside "{name}" so that the
document can be reviewed later.

You are given the pictures embedded in the file, each after its name.

For each picture, say what it shows and what can be read off it: the kind of
drawing or chart, what it depicts, the labels, figures and units on it, and how
the parts relate. Someone who cannot see it should be able to answer questions
about it from your description. Write in {language}.

Return only JSON, in this shape:
{{"images": [{{"name": "image1.png", "description": "..."}}]}}

Use the names exactly as they were given to you. Never invent a name."""


def build_image_prompt(*, name: str, language: str = "Japanese") -> str:
    return IMAGE_PROMPT.format(name=name, language=language)


def parse_image_descriptions(reply: str, names: list[str]) -> list[ImageDigest]:
    """モデルの返事から、画像の説明を取り出す。

    渡していない名前は捨てる。見ていない画像の説明を、見たことに
    してしまうため
    """
    data = _load_json(reply)
    if not isinstance(data, dict):
        return []
    entries = data.get("images")
    if not isinstance(entries, list):
        return []

    known = set(names)
    described: list[ImageDigest] = []
    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or "")
        if name not in known or name in seen:
            continue
        description = str(entry.get("description") or "").strip()
        if not description:
            continue
        seen.add(name)
        described.append(ImageDigest(name=name, description=description))
    return described


def build_image_content(
    images: list[Any], *, name: str, language: str = "Japanese"
) -> list[dict[str, Any]]:
    """埋め込み画像をモデルに渡す形にする。

    1回に渡せる画像は20枚までなので、呼び出し側が20枚ずつに分けて渡す。
    画像の前に名前を置くのは、返事をどの画像のものか対応づけるため
    """
    content: list[dict[str, Any]] = []
    for image in images:
        content.append({"text": f"{image.name}:"})
        content.append(
            {"image": {"format": image.format, "source": {"bytes": image.data}}}
        )
    if not content:
        return []
    content.append({"text": build_image_prompt(name=name, language=language)})
    return content


IMAGE_FILE_PROMPT = """You are reading the picture "{name}" so that it can be
reviewed later.

Return:
- "text": everything written in the picture, as text. Keep the wording exactly as
  it appears, including labels, numbers, units, stamps and handwriting. Lay any
  table out so the rows and columns can still be told apart. Use an empty string
  when nothing is written.
- "description": what the picture shows and what can be read off it. Someone who
  cannot see it should be able to answer questions about it from this.

Write both in {language}.

Return only JSON, in this shape:
{{"text": "...", "description": "..."}}"""


def build_image_file_prompt(*, name: str, language: str = "Japanese") -> str:
    return IMAGE_FILE_PROMPT.format(name=name, language=language)


def build_image_file_content(
    *, path: str, name: str, language: str = "Japanese"
) -> list[dict[str, Any]]:
    """審査に上げた画像ファイルを、読み取りのためにモデルへ渡す形にする。

    道具で読む経路では、画像ファイルはそのままでは読めない。先に読んで
    おけば、文字は画像の枠を使わずに読め、見る必要があるときだけ開ける
    """
    from PIL import Image

    from review_images import encode_image

    try:
        with Image.open(path) as opened:
            image_format, data = encode_image(opened.convert("RGB"))
    except Exception as error:
        logger.warning("%s could not be opened as a picture: %s", name, error)
        return []

    return [
        {"text": f"{name}:"},
        {"image": {"format": image_format, "source": {"bytes": data}}},
        {"text": build_image_file_prompt(name=name, language=language)},
    ]


def parse_image_file(reply: str, name: str) -> Optional[ImageDigest]:
    """画像ファイル1枚の読み取り結果。読めなければ None"""
    data = _load_json(reply)
    if not isinstance(data, dict):
        return None
    text = str(data.get("text") or "").strip()
    description = str(data.get("description") or "").strip()
    if not text and not description:
        return None
    return ImageDigest(name=name, description=description, text=text)
