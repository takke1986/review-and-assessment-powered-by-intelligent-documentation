"""PDF の、本文として取り出せない中身を読む。

## 記入値と注釈

`extract_text()` はページの本文しか返さない。実測すると、次はどちらも
空文字になる。

- **記入済みフォームの値**（申込者氏名＝山田 太郎）→ `get_fields()` にある
- **注釈・コメント・押印**（レビュー担当者が付けたもの）→ `/Annots` にある

申込書を審査する仕組みで、記入された内容が読めないのは致命的で、しかも
静かに壊れる。文字が0字なのでスキャン扱いになり、ページを画像で見る道に
回るが、

- 記入値は画像から読み直すことになり、20枚の枠を使う
- **付箋のコメントは画像にも写らない**（折りたたまれた印だけ）

ので、コメントはどこにも現れない。ここで拾えば、モデルを呼ばずに、
ただで、正確に読める。

## 文字化け

フォントに文字コード表（ToUnicode）が無い PDF は、extract_text が化けた
文字を大量に返す。文字数は多いので「スキャンではない」と判定され、画像で
見直す道に入らない。化けたまま審査されると、人は「読んだうえでの判定」だと
思ってしまう。割合で見分けて、画像で見るよう促す。
"""

from __future__ import annotations

import logging
from typing import Any, Iterable

logger = logging.getLogger(__name__)

# 化けた文字とみなす範囲。私用領域（フォント独自の割り当て）と、
# 置換文字、制御文字
_PRIVATE_USE = ((0xE000, 0xF8FF), (0xF0000, 0xFFFFD), (0x100000, 0x10FFFD))
_REPLACEMENT = "�"

# これを超える割合が化けていたら、読めていないとみなす。
# 記号混じりの文書で誤検知しないよう、高めにとる
GARBLED_RATIO = 0.2
# 短い文字列は割合が当てにならない
GARBLED_MIN_CHARS = 20


def _is_garbled(character: str) -> bool:
    if character == _REPLACEMENT:
        return True
    code = ord(character)
    if code < 0x20 and character not in "\t\n\r":
        return True
    return any(low <= code <= high for low, high in _PRIVATE_USE)


def looks_garbled(text: str) -> bool:
    """取り出した文字が化けているか。

    化けていると分かれば、そのページは画像で見るよう促せる。
    短すぎる文字列では判定しない（割合が当てにならない）
    """
    meaningful = [character for character in text if not character.isspace()]
    if len(meaningful) < GARBLED_MIN_CHARS:
        return False
    garbled = sum(1 for character in meaningful if _is_garbled(character))
    return garbled / len(meaningful) > GARBLED_RATIO


def field_values(reader: Any) -> dict[str, str]:
    """記入済みフォームの値。{欄の名前: 記入された値}。

    どのページの欄かは PDF の作りによって辿れないことがあるので、
    文書全体のものとして扱う。空欄は入れない（「未記入」を伝えたい
    場面もあるが、欄の名前だけ並べても判断できない）
    """
    try:
        fields = reader.get_fields() or {}
    except Exception as error:
        logger.debug("Could not read the form fields: %s", error)
        return {}

    values: dict[str, str] = {}
    for name, field in fields.items():
        try:
            value = field.get("/V")
        except AttributeError:
            continue
        if value is None:
            continue
        text = str(value).strip()
        if text:
            values[str(name)] = text
    return values


def page_notes(page: Any) -> list[str]:
    """ページに付いた注釈。押印・コメント・記入欄の中身。

    読めないものは飛ばす。注釈のせいで審査を落とさない
    """
    try:
        annotations = page.get("/Annots") or []
    except Exception:
        return []

    notes: list[str] = []
    for reference in annotations:
        try:
            annotation = reference.get_object()
        except Exception:
            continue
        try:
            subtype = str(annotation.get("/Subtype") or "")
            if subtype == "/Widget":
                name = annotation.get("/T")
                value = annotation.get("/V")
                if value is None:
                    continue
                text = str(value).strip()
                if text:
                    notes.append(f"{name}: {text}" if name else text)
                continue
            contents = annotation.get("/Contents")
            if contents is None:
                continue
            text = str(contents).strip()
            if text:
                label = subtype.lstrip("/") or "note"
                notes.append(f"[{label}] {text}")
        except Exception:
            continue
    return notes


def describe_extras(notes: Iterable[str], values: dict[str, str]) -> str:
    """ページの文字に添える一文にする。何も無ければ空。

    記入欄は、フォームの値としても注釈としても取れる。同じ内容を2回
    並べると、読む側は別々の記入だと思ってしまう
    """
    lines = []
    if values:
        filled = "; ".join(f"{name}={value}" for name, value in values.items())
        lines.append(f"(Filled into the form: {filled})")
    already = {f"{name}: {value}" for name, value in values.items()}
    for note in notes:
        if note in already:
            continue
        lines.append(f"(Note on the page: {note})")
    return "\n".join(lines)


def has_hidden_content(path: str) -> bool:
    """本文に出ない中身（記入値・注釈）を持つ PDF か。

    こういう PDF はそのまま渡す経路に載せてはいけない。Bedrock が
    document ブロックの記入値や注釈をどこまで読むかは公式に書かれて
    いないので、確かめられないことに賭けず、こちらで読み出せる道具の
    経路に回す。記入された申込書を「空の申込書」として審査するのが
    いちばん危ない
    """
    from pypdf import PdfReader

    try:
        reader = PdfReader(path)
        if reader.is_encrypted and not reader.decrypt(""):
            return False
        if field_values(reader):
            return True
        for page in reader.pages:
            if page_notes(page):
                return True
    except Exception as error:
        logger.debug("Could not look for hidden content in %s: %s", path, error)
    return False
