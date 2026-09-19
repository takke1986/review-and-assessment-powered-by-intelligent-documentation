"""
PDF 以外のファイルをテキストのページにして、チェックリスト抽出に渡す Lambda。

チェックリストのワークフローは TypeScript だが、Office ファイルを読む処理は
ここ（Python）にある。同じものを TypeScript でもう一度書くと、同じ Excel が
審査とチェックリストとで違って見えることになるので、こちらを呼ぶ形にした。
テキストファイルも同じ入口に通す。ページへの分け方を2か所に置かないため。

PDF は画像にしてから読む必要があるが、Office ファイルは中身が XML なので
そのままテキストにできる。画像化を挟まない分、表の値も数式も欠けない。
"""

from __future__ import annotations

import os
import posixpath
import tempfile
from typing import Any

import boto3

from office_documents import (
    OfficeFileError,
    ProtectedOfficeFileError,
    convert_office_file,
    is_office_file,
)

# そのまま読めるファイル。.csv も行が読めれば十分なので、表として解釈しない
TEXT_FILE_EXTENSIONS = (".txt", ".md", ".csv")

# 読む順。日本語のテキストは UTF-8 とは限らず、Excel から出した CSV は
# CP932 のことが多い。utf-8-sig は BOM 付きも落とせる
TEXT_ENCODINGS = ("utf-8-sig", "cp932")

# メモ帳が「Unicode」で保存するとこれが付く。UTF-16 は CP932 でも
# 例外を出さずに読めてしまうので、印を見て先に分ける
_UTF16_BOMS = {b"\xff\xfe": "utf-16", b"\xfe\xff": "utf-16"}

# 1回の抽出に渡すテキストの上限。長すぎると取りこぼしが増え、費用も伸びる。
# シートやスライドの切れ目で分けたうえで、なお長いものはここで切る
MAX_PAGE_CHARS = 30_000

_s3 = boto3.client("s3")


def _original_key(document_id: str, filename: str) -> str:
    """backend の getChecklistOriginalKey と同じ形。変えるときは両方を直す"""
    return f"checklist/original/{document_id}/{filename}"


def _page_key(document_id: str, page_number: int) -> str:
    """backend の getChecklistPageKey と同じ形"""
    return f"checklist/pages/{document_id}/page_{page_number}.md"


def _split_by_section(markdown: str) -> tuple[str, list[str]]:
    """
    シートやスライドの切れ目で分け、前書きと本体に分ける。

    Excel は「## Sheet: 名前」、PowerPoint は「## Slide 1」で始まる。
    最初の見出しより前には、ファイル名や「長すぎて途中までです」といった
    断り書きが入る。これはどのページを読むときにも要るので、本体から外して
    各ページの先頭に付け直す。1ページにまとめると、中身の無いページが
    1つできるうえ、他のページはどのファイルの話か分からなくなる。

    Word にはこの見出しが無いので、本体は丸ごと1つになる
    """
    preamble: list[str] = []
    sections: list[str] = []
    current: list[str] | None = None
    for line in markdown.split("\n"):
        if line.startswith("## "):
            if current is not None:
                sections.append("\n".join(current))
            current = [line]
        elif current is None:
            preamble.append(line)
        else:
            current.append(line)
    if current is not None:
        sections.append("\n".join(current))
    return (
        "\n".join(preamble).strip(),
        [section for section in sections if section.strip()],
    )


def _split_by_size(section: str) -> list[str]:
    """上限を超える塊を行の切れ目で分ける。表の行を途中で切らないため"""
    if len(section) <= MAX_PAGE_CHARS:
        return [section]
    parts: list[str] = []
    current: list[str] = []
    length = 0
    for line in section.split("\n"):
        # 1行だけで上限を超える場合もそのまま入れる。切ると意味が壊れる
        if current and length + len(line) + 1 > MAX_PAGE_CHARS:
            parts.append("\n".join(current))
            current = []
            length = 0
        current.append(line)
        length += len(line) + 1
    if current:
        parts.append("\n".join(current))
    return parts


def split_into_pages(markdown: str) -> list[str]:
    """抽出に渡す単位に分ける。PDF のページに当たるもの"""
    preamble, sections = _split_by_section(markdown)
    if not sections:
        # シートやスライドの見出しが無い文書。丸ごと渡す
        return _split_by_size(markdown)
    pages: list[str] = []
    for section in sections:
        pages.extend(_split_by_size(section))
    if not preamble:
        return pages
    return [f"{preamble}\n\n{page}" for page in pages]


def is_text_file(filename: str) -> bool:
    return filename.lower().endswith(TEXT_FILE_EXTENSIONS)


def decode_text(data: bytes, filename: str) -> str:
    """
    文字コードを決め打ちせずに読む。

    間違った文字コードで読むと、落ちずに化けたまま通ってしまい、出来上がった
    チェックリストを見るまで気づけない。とくに CP932 はほとんどのバイト列を
    読めてしまうので、「例外が出なければ正しい」とは言えない。
    そこで、読めた結果に NUL が混じっていたらテキストではないと見なす。

    ここで見抜けないものが一つある。印の無い UTF-16 で、中身が漢字だけの
    場合は NUL が出ないので、CP932 として化けたまま通る。印を付けずに
    UTF-16 で保存する道具は少ないので、そこは追わない
    """
    for bom, encoding in _UTF16_BOMS.items():
        if data.startswith(bom):
            return data.decode(encoding)

    for encoding in TEXT_ENCODINGS:
        try:
            text = data.decode(encoding)
        except UnicodeDecodeError:
            continue
        if "\x00" in text:
            # 読めたように見えるが、中身はテキストではない
            break
        return text

    raise RuntimeError(
        f"{filename} could not be read as text. Save it as UTF-8 and upload it again."
    )


def handler(event: dict[str, Any], _context: Any = None) -> dict[str, Any]:
    document_id = event["documentId"]
    filename = event["fileName"]
    bucket = os.environ["DOCUMENT_BUCKET"]

    print(f"Converting {filename} for document {document_id}")

    with tempfile.TemporaryDirectory() as directory:
        local_path = posixpath.join(directory, posixpath.basename(filename))
        _s3.download_file(bucket, _original_key(document_id, filename), local_path)
        if is_office_file(filename):
            try:
                markdown = convert_office_file(
                    local_path, display_name=filename
                ).markdown
            except ProtectedOfficeFileError as error:
                # 読めない理由が利用者に伝わるよう、そのまま上げる。
                # ここを握りつぶすと「0件のチェックリスト」ができてしまう
                raise RuntimeError(str(error)) from error
            except OfficeFileError as error:
                raise RuntimeError(str(error)) from error
        elif is_text_file(filename):
            with open(local_path, "rb") as file:
                body = decode_text(file.read(), filename)
            # Office 側と同じく、どのファイルの話かがページに残るようにする
            markdown = f"# {filename}\n\n{body}"
        else:
            raise RuntimeError(f"{filename} is not a file this step can read")

    pages = split_into_pages(markdown)
    for number, text in enumerate(pages, start=1):
        _s3.put_object(
            Bucket=bucket,
            Key=_page_key(document_id, number),
            Body=text.encode("utf-8"),
            ContentType="text/markdown; charset=utf-8",
        )

    print(f"Converted {filename} into {len(pages)} pages")
    return {
        "documentId": document_id,
        "pageCount": len(pages),
        "pages": [{"pageNumber": number} for number in range(1, len(pages) + 1)],
        # 抽出側が document ブロックではなくテキストとして渡すための目印
        "pageFormat": "md",
    }
