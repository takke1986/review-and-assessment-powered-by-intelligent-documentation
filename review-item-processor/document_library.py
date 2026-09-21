"""
Converse の1回の呼び出しに収まらないジョブで、モデルがツールでファイルを少しずつ読むための仕組み。

一括方式（review_documents.build_document_blocks）は、1回の呼び出しに文書5つ・1つ 4.5MB・
PDF 合計100ページまでしか渡せない。これを超えるジョブでは、ファイルを渡す代わりに次の
ツールを渡し、モデルに必要な箇所だけを読ませる。
- list_documents: ファイルの一覧（PDF のページ数、Office ファイルの見出し、埋め込み画像）
- search_documents: 語句を含むページ・見出しを探す
- read_pdf_pages: PDF のページの文字
- view_pdf_page: PDF のページを画像で見る（図、表の形、押印、スキャンしたページ）
- read_office_section: Word・Excel・PowerPoint の見出しごとの Markdown
- view_embedded_image: Word・Excel・PowerPoint の埋め込み画像

エージェントは呼び出しのたびに会話の履歴を送り直すので、読んだ文字や画像は履歴に積もる。
Converse の画像20枚の上限とコンテキストの大きさに収まるよう、1回の審査で返す量に上限を置く。
"""

from __future__ import annotations

import os
import re
import threading
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Optional

from document_digest import PageDigest as PageDigestType

import pypdfium2
from pypdf import PdfReader
from strands import tool

from office_documents import (
    EmbeddedImage,
    OfficeDocument,
    OfficeFileError,
    convert_office_file,
)
from document_digest import DocumentDigest, figure_pages, unread_pages
from pdf_extras import describe_extras, field_values, looks_garbled, page_notes
from review_documents import ReviewFile
from review_images import encode_image

MAX_PAGES_PER_READ = 20
MAX_CHARS_PER_READ = 30_000
MAX_CHARS_PER_REVIEW = 200_000
# Converse は1回の呼び出しに画像20枚まで。履歴に積もった画像も数に入る
MAX_IMAGES_PER_REVIEW = 20
# Claude は長辺がこれより大きい画像を縮めて読むので、これより大きく描いても読みやすくならない
PAGE_IMAGE_LONG_SIDE = 1568
SECTION_PART_CHARS = 20_000
MAX_SEARCH_HITS = 30
MAX_SECTIONS_LISTED = 300

_SNIPPET_RADIUS = 60
# 文字がこれより少ないページは、スキャンや図だけのページとみなす
_SCANNED_PAGE_CHARS = 20
_KINDS = {".pdf": "pdf", ".docx": "word", ".xlsx": "excel", ".pptx": "powerpoint"}
# 審査に上げた画像ファイル。この道具では中身を直接は読めないので、先に
# 読み取っておいたものを渡す。読み取りが無ければ「読めない」と伝える
_IMAGE_KINDS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff")
_OFFICE_KINDS = ("word", "excel", "powerpoint")
# 変換した Markdown では、シート・スライド・Word の見出し1が「## 」で始まる
_SECTION_HEADING = re.compile(r"^## ", re.MULTILINE)


class DocumentToolError(ValueError):
    """ツールの引数が正しくない、またはファイルを読めない。メッセージはモデルに返る"""


@dataclass
class Section:
    heading: str
    parts: list[str]


@dataclass
class _Document:
    file: ReviewFile
    # モデルに見せる名前。同じ名前のファイルには番号を付ける
    name: str
    kind: str
    office: Optional[OfficeDocument] = None
    sections: Optional[list[Section]] = None
    reader: Optional[PdfReader] = None
    page_texts: dict[int, str] = field(default_factory=dict)
    # 先に読み取っておいた結果。ページ番号 → その1枚ぶん。
    # 大きい書類やスキャンした書類でだけ作られるので、普段は空
    digest: dict[int, "PageDigestType"] = field(default_factory=dict)
    # 埋め込み画像の説明。名前 → 何が描かれているか（Office 用）
    image_notes: dict[str, str] = field(default_factory=dict)
    # 記入済みフォームの値。まだ読んでいなければ None
    form_values: Optional[dict[str, str]] = None


def _normalize(text: str) -> str:
    return unicodedata.normalize("NFKC", text).casefold()


def split_sections(markdown: str) -> list[Section]:
    """「## 」の見出しで分け、長い見出しは行の切れ目で SECTION_PART_CHARS 字ずつに分ける"""
    edges = sorted(
        {
            0,
            len(markdown),
            *(match.start() for match in _SECTION_HEADING.finditer(markdown)),
        }
    )
    sections = []
    for start, end in zip(edges, edges[1:]):
        text = markdown[start:end].strip("\n")
        if not text:
            continue
        first_line = text.split("\n", 1)[0]
        heading = (
            first_line[3:].strip()
            if first_line.startswith("## ")
            else "(beginning of the file)"
        )
        sections.append(Section(heading, _split_lines(text, SECTION_PART_CHARS)))
    return sections


def _split_lines(text: str, limit: int) -> list[str]:
    parts: list[str] = []
    current: list[str] = []
    size = 0
    for line in text.split("\n"):
        if len(line) > limit:
            if current:
                parts.append("\n".join(current))
                current, size = [], 0
            while len(line) > limit:
                parts.append(line[:limit])
                line = line[limit:]
        if current and size + len(line) + 1 > limit:
            parts.append("\n".join(current))
            current, size = [], 0
        current.append(line)
        size += len(line) + 1
    if current:
        parts.append("\n".join(current))
    return parts or [""]


class DocumentLibrary:
    """審査するファイルを、ツールから読むためのもの。読んだ量を数え、上限を守る"""

    def __init__(
        self,
        files: list[ReviewFile],
        converted: Optional[dict[str, OfficeDocument]] = None,
        digests: Optional[dict[str, DocumentDigest]] = None,
    ):
        # Strands はツールを並行して呼ぶ。pypdf と PDFium はスレッドセーフではない
        self._lock = threading.RLock()
        self._documents: list[_Document] = []
        counts: dict[str, int] = {}
        for file in files:
            key = _normalize(file.name)
            counts[key] = counts.get(key, 0) + 1
            name = file.name if counts[key] == 1 else f"{file.name} ({counts[key]})"
            extension = os.path.splitext(file.path.lower())[1]
            kind = _KINDS.get(extension, "other")
            if kind == "other" and extension in _IMAGE_KINDS:
                kind = "picture"
            read = (digests or {}).get(file.path) or DocumentDigest()
            self._documents.append(
                _Document(
                    file,
                    name,
                    kind,
                    office=(converted or {}).get(file.path),
                    digest={page.page: page for page in read.pages},
                    image_notes=read.image_descriptions,
                )
            )
        self.chars_returned = 0
        self.images_returned = 0

    # ---- ツールから呼ぶもの ----

    def overview(self) -> dict[str, Any]:
        with self._lock:
            files = []
            for document in self._documents:
                entry: dict[str, Any] = {"file": document.name, "type": document.kind}
                try:
                    if document.kind == "pdf":
                        entry["pages"] = len(self._pdf(document).pages)
                        if document.digest:
                            # どのページに図があるかを先に見せる。探すために
                            # ページを開くと、それだけで画像の枠が減る
                            figures = figure_pages(document.digest.values())
                            if figures:
                                entry["figurePages"] = figures
                            missing = unread_pages(document.digest.values())
                            if missing:
                                entry["pagesNotRead"] = missing
                    elif document.kind in _OFFICE_KINDS:
                        office, sections = self._office(document)
                        entry["sections"] = [
                            {
                                "section": number,
                                "heading": section.heading,
                                "parts": len(section.parts),
                            }
                            for number, section in enumerate(
                                sections[:MAX_SECTIONS_LISTED], start=1
                            )
                        ]
                        if len(sections) > MAX_SECTIONS_LISTED:
                            entry["sectionsNotListed"] = (
                                len(sections) - MAX_SECTIONS_LISTED
                            )
                        if office.images:
                            # 名前（image1.png）だけでは、どれを見るべきか
                            # 分からない。先に説明してあれば添える。
                            # 探すために開くと、それだけで画像の枠が減る
                            entry["images"] = [
                                {
                                    "name": image.name,
                                    "shows": document.image_notes[image.name],
                                }
                                if image.name in document.image_notes
                                else {"name": image.name}
                                for image in office.images
                            ]
                    elif document.kind == "picture":
                        # 読み取ってあれば、その中身を渡す。画像の枠は
                        # 使わない。読み取りが無ければ、ここでは読めない
                        read = document.image_notes.get(document.name)
                        if read:
                            entry["shows"] = read
                        else:
                            entry["error"] = (
                                "This picture was not read before the review, so it "
                                "cannot be read with these tools."
                            )
                    else:
                        entry["error"] = (
                            "This file type cannot be read with these tools."
                        )
                except DocumentToolError as error:
                    entry["error"] = str(error)
                files.append(entry)
            return {
                "files": files,
                "limits": {
                    "pagesPerRead": MAX_PAGES_PER_READ,
                    "charactersLeft": max(
                        0, MAX_CHARS_PER_REVIEW - self.chars_returned
                    ),
                    "imagesLeft": max(0, MAX_IMAGES_PER_REVIEW - self.images_returned),
                },
            }

    def search(self, query: str) -> dict[str, Any]:
        terms = [_normalize(term) for term in query.split()]
        if not terms:
            raise DocumentToolError("Give at least one word to search for.")
        with self._lock:
            matches = []
            for order, document in enumerate(self._documents):
                try:
                    locations = list(self._searchable(document))
                except DocumentToolError:
                    continue
                for location, text in locations:
                    normalized = _normalize(text)
                    found = [term for term in terms if term in normalized]
                    if found:
                        at = normalized.find(found[0])
                        snippet = normalized[
                            max(0, at - _SNIPPET_RADIUS) : at
                            + len(found[0])
                            + _SNIPPET_RADIUS
                        ]
                        matches.append(
                            (
                                -len(found),
                                order,
                                {
                                    "file": document.name,
                                    **location,
                                    "matchedTerms": found,
                                    "snippet": " ".join(snippet.split()),
                                },
                            )
                        )
            matches.sort(key=lambda match: (match[0], match[1]))
            hits = [hit for _, _, hit in matches[:MAX_SEARCH_HITS]]
            self._count_chars(sum(len(hit["snippet"]) for hit in hits))
            return {"totalMatches": len(matches), "hits": hits}

    def pdf_pages_text(
        self, name: str, first_page: int, last_page: Optional[int] = None
    ) -> str:
        with self._lock:
            document = self._find(name)
            count = len(self._pdf(document).pages)
            last_page = last_page or first_page
            if not 1 <= first_page <= count or last_page < first_page:
                raise DocumentToolError(f"{document.name} has pages 1-{count}.")
            last = min(last_page, count, first_page + MAX_PAGES_PER_READ - 1)
            blocks = []
            for page in range(first_page, last + 1):
                text = self._page_text(document, page)
                read = document.digest.get(page)
                if len(text) < _SCANNED_PAGE_CHARS and read and read.text.strip():
                    # ファイルから文字が取れないページ。先に読み取っておいた
                    # 書き起こしを渡す。これがないと、スキャンした書類は
                    # ページを画像で開くしかなく、20枚の枠を文字読みで使い切る
                    text = (
                        f"{read.text}\n(Transcribed from the page image before the "
                        "review, because no text could be taken from the file.)"
                    )
                elif len(text) < _SCANNED_PAGE_CHARS:
                    text += (
                        "\n(Little or no text could be taken from this page. It may be "
                        "scanned or made of figures: use view_pdf_page to see it.)"
                    )
                if read and read.figures:
                    # 図がある目印。どんな図かまで書いておくと、見るべき
                    # ページを選べる。20枚の枠を探すために使わずに済む
                    listed = "; ".join(read.figures)
                    text += (
                        f"\n(Figures on this page: {listed}. "
                        "Use view_pdf_page to see the page itself when the drawing "
                        "matters.)"
                    )
                blocks.append(
                    f"--- {document.name}, page {page} of {count} ---\n{text}"
                )
            if last < min(last_page, count):
                blocks.append(
                    f"(Pages {last + 1}-{min(last_page, count)} were not returned: read at "
                    f"most {MAX_PAGES_PER_READ} pages at a time.)"
                )
            return self._spend("\n\n".join(blocks))

    def pdf_page_image(self, name: str, page: int) -> EmbeddedImage:
        with self._lock:
            document = self._find(name)
            count = len(self._pdf(document).pages)
            if not 1 <= page <= count:
                raise DocumentToolError(f"{document.name} has pages 1-{count}.")
            self._check_image_budget()
            try:
                pdf = pypdfium2.PdfDocument(document.file.path)
                try:
                    pdf_page = pdf[page - 1]
                    scale = PAGE_IMAGE_LONG_SIDE / max(*pdf_page.get_size(), 1)
                    bitmap = pdf_page.render(scale=scale).to_pil()
                finally:
                    pdf.close()
            except Exception as error:
                raise DocumentToolError(
                    f"Page {page} of {document.name} could not be drawn: {error}"
                ) from error
            image_format, data = encode_image(bitmap)
            self.images_returned += 1
            return EmbeddedImage(f"page {page}", image_format, data)

    def picture_text(self, name: str) -> str:
        """審査に上げた画像から、先に読み取っておいた文字と説明"""
        with self._lock:
            document = self._find(name)
            if document.kind != "picture":
                raise DocumentToolError(f"{document.name} is not a picture.")
            read = document.image_notes.get(document.name)
            if not read:
                raise DocumentToolError(
                    f"{document.name} was not read before the review, so it cannot "
                    "be read here."
                )
            return self._spend(f"--- {document.name} ---\n{read}")

    def office_section(self, name: str, section: int, part: int = 1) -> str:
        with self._lock:
            document = self._find(name)
            _, sections = self._office(document)
            if not 1 <= section <= len(sections):
                raise DocumentToolError(
                    f"{document.name} has sections 1-{len(sections)}."
                )
            chosen = sections[section - 1]
            if not 1 <= part <= len(chosen.parts):
                raise DocumentToolError(
                    f"Section {section} of {document.name} has parts 1-{len(chosen.parts)}."
                )
            header = f"--- {document.name}, section {section} ({chosen.heading})"
            if len(chosen.parts) > 1:
                header += f", part {part} of {len(chosen.parts)}"
            return self._spend(f"{header} ---\n{chosen.parts[part - 1]}")

    def embedded_image(self, name: str, image: str) -> EmbeddedImage:
        with self._lock:
            document = self._find(name)
            office, _ = self._office(document)
            key = _normalize(image.strip())
            for candidate in office.images:
                if key in (
                    _normalize(candidate.name),
                    _normalize(os.path.basename(candidate.name)),
                ):
                    self._check_image_budget()
                    self.images_returned += 1
                    return candidate
            names = ", ".join(candidate.name for candidate in office.images) or "none"
            raise DocumentToolError(
                f"{document.name} has no image named {image!r}. Its images are: {names}."
            )

    # ---- 内部 ----

    def _find(self, name: str) -> _Document:
        key = _normalize(name.strip())
        for document in self._documents:
            if _normalize(document.name) == key:
                return document
        # モデルは拡張子を省くことがある
        stems = [
            document
            for document in self._documents
            if _normalize(os.path.splitext(document.name)[0]) == key
        ]
        if len(stems) == 1:
            return stems[0]
        names = ", ".join(document.name for document in self._documents)
        raise DocumentToolError(f"No file is named {name!r}. The files are: {names}.")

    def _pdf(self, document: _Document) -> PdfReader:
        if document.kind != "pdf":
            raise DocumentToolError(
                f"{document.name} is not a PDF. Use read_office_section to read it."
            )
        if document.reader is None:
            try:
                reader = PdfReader(document.file.path)
                if reader.is_encrypted and not reader.decrypt(""):
                    raise DocumentToolError(
                        f"{document.name} is protected by a password, so it cannot be read."
                    )
                len(reader.pages)
            except DocumentToolError:
                raise
            except Exception as error:
                raise DocumentToolError(
                    f"{document.name} could not be read as a PDF: {error}"
                ) from error
            document.reader = reader
        return document.reader

    def _page_text(self, document: _Document, page: int) -> str:
        if page not in document.page_texts:
            reader = self._pdf(document)
            try:
                pdf_page = reader.pages[page - 1]
                text = (pdf_page.extract_text() or "").strip()
            except DocumentToolError:
                raise
            except Exception:
                pdf_page, text = None, ""

            if pdf_page is not None:
                # 本文には出ない中身を足す。記入済みフォームの値と、注釈・
                # 押印・コメント。申込書の記入内容がここにしか無いことが
                # あり、拾わないと「空の申込書」を審査することになる
                extras = describe_extras(
                    page_notes(pdf_page), self._form_values(document)
                )
                if extras:
                    # 本文が取れないページに注釈だけがある場合、足したせいで
                    # 「文字のあるページ」に見えてしまい、画像で見る案内が
                    # 出なくなる。ここで先に付けておく
                    if len(text) < _SCANNED_PAGE_CHARS:
                        text += (
                            "\n(Little or no text could be taken from this page. It "
                            "may be scanned or made of figures: use view_pdf_page to "
                            "see it.)"
                        )
                    text = f"{text}\n{extras}".strip()

            if text and looks_garbled(text):
                # 文字コード表の無いフォント。文字数はあるので「スキャンでは
                # ない」と判定されてしまい、画像で見直す道に入らない
                text += (
                    "\n(The text taken from this page looks garbled, so the file's "
                    "own text cannot be trusted here: use view_pdf_page to see it.)"
                )
            document.page_texts[page] = text
        return document.page_texts[page]

    def _form_values(self, document: _Document) -> dict[str, str]:
        """記入済みフォームの値。どのページの欄かは辿れないので文書全体で1度だけ読む"""
        if document.form_values is None:
            document.form_values = field_values(self._pdf(document))
        # 何度も同じ値を並べない。最初に読んだページにだけ添える
        values, document.form_values = document.form_values, {}
        return values

    def _office(self, document: _Document) -> tuple[OfficeDocument, list[Section]]:
        if document.kind not in _OFFICE_KINDS:
            raise DocumentToolError(
                f"{document.name} is not a Word, Excel or PowerPoint file. "
                "Use read_pdf_pages or view_pdf_page to read it."
            )
        if document.office is None:
            try:
                document.office = convert_office_file(
                    document.file.path, display_name=document.file.name
                )
            except OfficeFileError as error:
                raise DocumentToolError(str(error)) from error
        if document.sections is None:
            document.sections = split_sections(document.office.markdown)
        return document.office, document.sections

    def _searchable(self, document: _Document):
        if document.kind == "pdf":
            for page in range(1, len(self._pdf(document).pages) + 1):
                yield {"page": page}, self._page_text(document, page)
        elif document.kind in _OFFICE_KINDS:
            _, sections = self._office(document)
            for number, section in enumerate(sections, start=1):
                for part_number, text in enumerate(section.parts, start=1):
                    location: dict[str, Any] = {
                        "section": number,
                        "heading": section.heading,
                    }
                    if len(section.parts) > 1:
                        location["part"] = part_number
                    yield location, text

    def _spend(self, text: str) -> str:
        remaining = MAX_CHARS_PER_REVIEW - self.chars_returned
        if remaining <= 0:
            raise DocumentToolError(
                "The reading budget for this check item is used up. Make your judgment "
                "from what you have already read."
            )
        limit = min(MAX_CHARS_PER_READ, remaining)
        if len(text) > limit:
            text = text[:limit] + (
                f"\n(Cut off here: at most {limit} characters can be returned now. "
                "Read a narrower range to see the rest.)"
            )
            self._count_chars(limit)
        else:
            self._count_chars(len(text))
        return text

    def _count_chars(self, count: int) -> None:
        self.chars_returned += count

    def _check_image_budget(self) -> None:
        if self.images_returned >= MAX_IMAGES_PER_REVIEW:
            raise DocumentToolError(
                f"No more images can be shown for this check item (at most "
                f"{MAX_IMAGES_PER_REVIEW}). Read the text instead."
            )


def _success(*content: dict[str, Any]) -> dict[str, Any]:
    return {"status": "success", "content": list(content)}


def _image_block(image: EmbeddedImage) -> dict[str, Any]:
    return {"image": {"format": image.format, "source": {"bytes": image.data}}}


def create_document_tools(library: DocumentLibrary) -> list[Any]:
    """library のファイルを読むツール。モデルへの説明は docstring から作られる"""

    @tool
    def list_documents() -> dict[str, Any]:
        """
        List the files under review: each file's type, the number of pages of a PDF, the
        sections (sheets, slides or headings) of a Word, Excel or PowerPoint file, the images
        embedded in it, and how much more you can read. Call this first.
        """
        return _success({"json": library.overview()})

    @tool
    def search_documents(query: str) -> dict[str, Any]:
        """
        Find the PDF pages and Office sections that contain any of the words in the query.
        Matching ignores case and full-width/half-width differences. Results are pointers
        only: read the pages or sections they point to before relying on them.

        Args:
            query: Words to look for, separated by spaces. Places containing more of the words come first.
        """
        return _success({"json": library.search(query)})

    @tool
    def read_pdf_pages(
        file: str, first_page: int, last_page: Optional[int] = None
    ) -> dict[str, Any]:
        """
        Read the text of pages of a PDF file, up to 20 pages at a time.

        Args:
            file: The file name, as list_documents shows it.
            first_page: The first page to read, counting from 1 within this file.
            last_page: The last page to read. Omit it to read one page.
        """
        return _success({"text": library.pdf_pages_text(file, first_page, last_page)})

    @tool
    def view_pdf_page(file: str, page: int) -> dict[str, Any]:
        """
        See a PDF page as an image. Use it when the layout, a figure, a table's shape, a stamp
        or handwriting matters, or when a page has no text because it is scanned. The number
        of images you can see is limited, so read the text when that is enough.

        Args:
            file: The file name, as list_documents shows it.
            page: The page to see, counting from 1 within this file.
        """
        image = library.pdf_page_image(file, page)
        return _success({"text": f"Page {page} of {file}:"}, _image_block(image))

    @tool
    def read_office_section(file: str, section: int, part: int = 1) -> dict[str, Any]:
        """
        Read one section of a Word, Excel or PowerPoint file, converted from its XML to
        Markdown. In spreadsheets, row numbers are on the left and column letters on top.
        Lines in square brackets describe formulas, comments, charts, images, hidden rows,
        columns and sheets, merged cells, revisions and notes.

        Args:
            file: The file name, as list_documents shows it.
            section: The section number from list_documents.
            part: The part of a long section, counting from 1.
        """
        return _success({"text": library.office_section(file, section, part)})

    @tool
    def read_picture(file: str) -> dict[str, Any]:
        """
        Read what is written in a picture that was uploaded for review, and what it
        shows. The picture was read before the review, so this costs you none of the
        images you are allowed to see.

        Args:
            file: The file name, as list_documents shows it.
        """
        return _success({"text": library.picture_text(file)})

    @tool
    def view_embedded_image(file: str, image: str) -> dict[str, Any]:
        """
        See an image embedded in a Word, Excel or PowerPoint file. The Markdown marks where it
        is with [image: name].

        Args:
            file: The file name, as list_documents shows it.
            image: The image name, as list_documents or the Markdown shows it.
        """
        embedded = library.embedded_image(file, image)
        return _success(
            {"text": f"Image {embedded.name} in {file}:"}, _image_block(embedded)
        )

    return [
        list_documents,
        search_documents,
        read_pdf_pages,
        view_pdf_page,
        read_office_section,
        read_picture,
        view_embedded_image,
    ]
