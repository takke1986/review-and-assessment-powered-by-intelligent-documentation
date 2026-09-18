"""
審査するファイルを、Converse API に渡す content ブロックに組み立てる。

Converse API には1回の呼び出しに次の上限がある。
- 文書は5つまで、1つ 4.5MB まで
- 画像は20枚まで

RAPID は1ジョブに20ファイルまでアップロードでき、ファイルをまたいで見比べられる
よう、チェック項目ごとに全ファイルを1回の呼び出しで渡す。上限に収めるため:
- Word・Excel・PowerPoint は XML から Markdown に変換する。5つに収まらなければ、
  Markdown をまとめて1つの文書にする（各ファイルは「# ファイル名」で始まる）
- PDF も収まらなければ結合して数を減らす。どのページがどのファイルかを伝える
- 埋め込み画像は20枚までにし、外した画像の名前を伝える

Bedrock に渡す文書名はファイル名にできない（使える文字が限られ、同じ名前も
許されない）ので、各文書の前に、元のファイル名を書いたテキストを置く。

それでも収まらないジョブ（4.5MB を超える PDF、合計100ページを超える PDF など）では
RequestTooLargeError を出す。呼び出し側は、ファイルをツールで少しずつ読む方式
（document_library）に切り替える。
"""

from __future__ import annotations

import io
import os
from dataclasses import dataclass
from typing import Any, Callable, Iterable, TypeVar

from pypdf import PdfReader, PdfWriter

from PIL import Image

from review_images import encode_image
from office_documents import OfficeDocument, convert_office_file, is_office_file

MAX_DOCUMENTS_PER_REQUEST = 5
MAX_DOCUMENT_BYTES = 4_500_000
# Converse が受け付ける画像。BMP・TIFF は送る前に変換される
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff")

MAX_IMAGES_PER_REQUEST = 20
# 画像の合計の上限。Converse の文書にはない上限だが、呼び出し全体の大きさを抑える
# （Nova は1回の呼び出し全体で 25MB まで）。文書5つで最大 22.5MB になるので、その残り
MAX_IMAGE_BYTES_PER_REQUEST = 10_000_000
# 結合した PDF は元のファイルの合計より少し大きくなることがあるので、余裕を見て詰める
PDF_JOIN_TARGET_BYTES = 4_000_000
# Bedrock の Claude は、1回の呼び出しに PDF を合計100ページまでしか読まない
MAX_PDF_PAGES_PER_REQUEST = 100

_MARKDOWN_GUIDE = (
    "In spreadsheets, row numbers are on the left and column letters on top, so a "
    "value can be cited by its cell. Lines in square brackets describe parts of the "
    "original file: formulas, comments, charts, images, hidden rows, columns and "
    "sheets, merged cells, revisions, notes and anything left out."
)

T = TypeVar("T")


class ReviewDocumentError(ValueError):
    """ファイルを Converse API に渡せるかたちにできない"""


class RequestTooLargeError(ReviewDocumentError):
    """ファイルが1回の呼び出しの上限に収まらない。ツールで読む方式なら審査できる"""

    def __init__(self, message: str, converted: dict[str, OfficeDocument]):
        super().__init__(message)
        # 変換済みの Office ファイル（パス → 変換結果）。ツールで読む方式が変換し直さずに使う
        self.converted = converted


@dataclass(frozen=True)
class ReviewFile:
    path: str
    # 利用者がアップロードしたときのファイル名。モデルにはこの名前で伝える
    name: str

    @property
    def is_pdf(self) -> bool:
        return self.path.lower().endswith(".pdf")

    @property
    def is_image(self) -> bool:
        return self.path.lower().endswith(IMAGE_EXTENSIONS)


def build_document_blocks(
    files: list[ReviewFile], citations: bool
) -> list[dict[str, Any]]:
    """
    ファイルを、Converse の content ブロック（text・document・image）にする。
    プロンプトは含めない。並びは、文書ごとに「説明のテキスト、文書」、最後に画像。
    """
    unsupported = [
        file.name
        for file in files
        if not file.is_pdf and not file.is_image and not is_office_file(file.path)
    ]
    if unsupported:
        raise ReviewDocumentError(f"Unsupported file type: {', '.join(unsupported)}")

    order = {file: index for index, file in enumerate(files)}
    pdfs = [file for file in files if file.is_pdf]
    images = [file for file in files if file.is_image]
    offices = [
        (file, convert_office_file(file.path, display_name=file.name))
        for file in files
        if is_office_file(file.path)
    ]
    converted = {file.path: document for file, document in offices}

    oversized = [file.name for file in pdfs if _file_size(file) > MAX_DOCUMENT_BYTES]
    if oversized:
        raise RequestTooLargeError(
            f"These PDFs are over the {MAX_DOCUMENT_BYTES} bytes a document can be: "
            f"{', '.join(oversized)}",
            converted,
        )
    pages = sum(_page_count(file) for file in pdfs)
    if pages > MAX_PDF_PAGES_PER_REQUEST:
        raise RequestTooLargeError(
            f"The PDFs have {pages} pages in total, over the "
            f"{MAX_PDF_PAGES_PER_REQUEST} pages a request can take",
            converted,
        )

    if len(pdfs) + len(offices) <= MAX_DOCUMENTS_PER_REQUEST:
        markdown_groups = [[office] for office in offices]
        pdf_groups = [[pdf] for pdf in pdfs]
    else:
        markdown_groups = _pack(
            offices,
            size=lambda office: len(office[1].markdown.encode("utf-8")),
            capacity=MAX_DOCUMENT_BYTES,
            order=lambda office: order[office[0]],
        )
        slots = MAX_DOCUMENTS_PER_REQUEST - len(markdown_groups)
        pdf_groups = (
            [[pdf] for pdf in pdfs]
            if len(pdfs) <= slots
            else _pack(
                pdfs,
                size=_file_size,
                capacity=PDF_JOIN_TARGET_BYTES,
                order=order.__getitem__,
            )
        )
        if len(pdf_groups) > slots:
            raise RequestTooLargeError(
                f"These files cannot be sent in one request: a request takes at most "
                f"{MAX_DOCUMENTS_PER_REQUEST} documents of {MAX_DOCUMENT_BYTES} bytes each, "
                f"and the PDFs alone need {len(pdf_groups)} after joining.",
                converted,
            )
    for group in markdown_groups:
        size = sum(len(document.markdown.encode("utf-8")) for _, document in group)
        if size > MAX_DOCUMENT_BYTES:
            raise RequestTooLargeError(
                f"{', '.join(file.name for file, _ in group)} come to {size} bytes as "
                f"Markdown, over the {MAX_DOCUMENT_BYTES} bytes a document can be",
                converted,
            )

    documents: list[tuple[int, Callable[[int], list[dict[str, Any]]]]] = []
    for group in markdown_groups:
        documents.append(
            (
                order[group[0][0]],
                lambda number, group=group: _markdown_document(
                    number, group, citations
                ),
            )
        )
    for group in pdf_groups:
        documents.append(
            (
                order[group[0]],
                lambda number, group=group: _pdf_document(
                    number, group, citations, converted
                ),
            )
        )
    documents.sort(key=lambda document: document[0])

    blocks: list[dict[str, Any]] = []
    for number, (_, build) in enumerate(documents, start=1):
        blocks += build(number)
    blocks += _image_blocks(offices, images)
    return blocks


def write_office_files_as_markdown(
    files: list[ReviewFile], directory: str
) -> list[str]:
    """
    文書ブロックを使えないモデルのための、読むファイルのパス。
    Office ファイルは Markdown に変換したファイルに置き換える（画像は渡せない）。
    """
    paths = []
    for index, file in enumerate(files, start=1):
        if not is_office_file(file.path):
            paths.append(file.path)
            continue
        document = convert_office_file(file.path, display_name=file.name)
        path = os.path.join(directory, f"office-{index}.md")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(document.markdown)
        paths.append(path)
    return paths


def _pack(
    items: Iterable[T],
    size: Callable[[T], int],
    capacity: int,
    order: Callable[[T], int],
) -> list[list[T]]:
    """
    大きい順に、入る最初のまとまりに詰める（First Fit Decreasing）。
    まとまりの中は元の順に並べ、まとまりも先頭のファイルの順に並べる。
    """
    groups: list[tuple[int, list[T]]] = []
    for item in sorted(items, key=size, reverse=True):
        item_size = size(item)
        for index, (used, members) in enumerate(groups):
            if used + item_size <= capacity:
                groups[index] = (used + item_size, members + [item])
                break
        else:
            groups.append((item_size, [item]))
    packed = [sorted(members, key=order) for _, members in groups]
    return sorted(packed, key=lambda members: order(members[0]))


def _file_size(file: ReviewFile) -> int:
    return os.path.getsize(file.path)


def _page_count(file: ReviewFile) -> int:
    """読めない PDF は 0 ページとして扱い、読めるかどうかの判断は Bedrock に任せる"""
    try:
        return len(PdfReader(file.path).pages)
    except Exception:
        return 0


def _document_block(
    number: int, document_format: str, data: bytes, citations: bool
) -> dict[str, Any]:
    return {
        "document": {
            # 使える文字が限られ、同じ名前は許されないので、ファイル名ではなく番号にする
            "name": f"document-{number}",
            "format": document_format,
            "source": {"bytes": data},
            "citations": {"enabled": citations},
        }
    }


def _markdown_document(
    number: int, group: list[tuple[ReviewFile, OfficeDocument]], citations: bool
) -> list[dict[str, Any]]:
    names = ", ".join(file.name for file, _ in group)
    if len(group) == 1:
        label = f"Document {number} is the file {names}, converted from its XML to Markdown."
    else:
        label = (
            f"Document {number} joins these files, each converted from its XML to Markdown "
            f"and starting with a heading that names the file: {names}."
        )
    text = "\n\n".join(document.markdown for _, document in group)
    return [
        {"text": f"{label} {_MARKDOWN_GUIDE}"},
        _document_block(number, "md", text.encode("utf-8"), citations),
    ]


def _pdf_document(
    number: int,
    group: list[ReviewFile],
    citations: bool,
    converted: dict[str, OfficeDocument],
) -> list[dict[str, Any]]:
    if len(group) == 1:
        with open(group[0].path, "rb") as handle:
            data = handle.read()
        return [
            {"text": f"Document {number} is the file {group[0].name}."},
            _document_block(number, "pdf", data, citations),
        ]

    data, ranges = _join_pdfs(group)
    if len(data) > MAX_DOCUMENT_BYTES:
        raise RequestTooLargeError(
            f"The joined PDFs {', '.join(file.name for file in group)} come to {len(data)} bytes, "
            f"over the {MAX_DOCUMENT_BYTES} bytes a document can be.",
            converted,
        )
    parts = ", ".join(
        f"{name} is pages {start}-{end} (its own pages 1-{end - start + 1})"
        for name, start, end in ranges
    )
    label = (
        f"Document {number} joins several PDF files into one, in this order: {parts}. "
        "When you refer to a page, name the original file and give the page number within that file."
    )
    return [{"text": label}, _document_block(number, "pdf", data, citations)]


def _join_pdfs(group: list[ReviewFile]) -> tuple[bytes, list[tuple[str, int, int]]]:
    """PDF を順につなげる。ファイルごとに、つなげた文書での (名前, 最初のページ, 最後のページ)"""
    writer = PdfWriter()
    ranges = []
    for file in group:
        try:
            reader = PdfReader(file.path)
            start = len(writer.pages) + 1
            for page in reader.pages:
                writer.add_page(page)
        except Exception as error:
            raise ReviewDocumentError(
                f"{file.name} could not be joined with the other PDFs: {error}"
            ) from error
        ranges.append((file.name, start, len(writer.pages)))
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue(), ranges


def _uploaded_images(
    images: list[ReviewFile],
) -> list[tuple[str, str, bytes]]:
    """アップロードされた画像を (伝える名前, 形式, データ) にする。送れない形式や大きさは変換する"""
    prepared = []
    for file in images:
        with Image.open(file.path) as image:
            image_format, data = encode_image(image)
        prepared.append((file.name, image_format, data))
    return prepared


def _image_blocks(
    offices: list[tuple[ReviewFile, OfficeDocument]],
    images: list[ReviewFile] | None = None,
) -> list[dict[str, Any]]:
    """
    アップロードされた画像と、Office ファイルの埋め込み画像。
    Converse の上限は要求ごとなので、両者は同じ枚数・バイト数の枠を分け合う。
    超えた分は、名前だけ伝えて添付しない。
    """
    blocks: list[dict[str, Any]] = []
    attached = 0
    attached_bytes = 0
    left_out = []
    for name, image_format, data in _uploaded_images(images or []):
        if (
            attached >= MAX_IMAGES_PER_REQUEST
            or attached_bytes + len(data) > MAX_IMAGE_BYTES_PER_REQUEST
        ):
            left_out.append(name)
            continue
        blocks.append({"text": f"The next image is {name}."})
        blocks.append({"image": {"format": image_format, "source": {"bytes": data}}})
        attached += 1
        attached_bytes += len(data)
    for file, document in offices:
        for image in document.images:
            if (
                attached >= MAX_IMAGES_PER_REQUEST
                or attached_bytes + len(image.data) > MAX_IMAGE_BYTES_PER_REQUEST
            ):
                left_out.append(f"{image.name} in {file.name}")
                continue
            blocks.append(
                {"text": f"The next image is {image.name}, embedded in {file.name}."}
            )
            blocks.append(
                {"image": {"format": image.format, "source": {"bytes": image.data}}}
            )
            attached += 1
            attached_bytes += len(image.data)
    if left_out:
        blocks.append(
            {
                "text": "These embedded images are not attached, to keep a request within "
                f"{MAX_IMAGES_PER_REQUEST} images and {MAX_IMAGE_BYTES_PER_REQUEST} bytes of images: "
                f"{', '.join(left_out)}."
            }
        )
    return blocks
