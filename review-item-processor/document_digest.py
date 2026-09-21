"""書類を先に読み取っておき、審査のときに文字と図の両方を使えるようにする。

## なぜ要るか

1回の呼び出しには上限がある（PDF 合計100ページ、画像20枚、文書1つ 4.5MB）。
これは Bedrock と Converse API の制限で、引き上げられない。

スキャンした書類では、この20枚が**文字を読むために**消える。1ページ＝1画像
なので、20ページ読んだ時点で打ち止めになり、図・押印・レイアウトを見る枠が
残らない。文字で解ける項目と、見ないと解けない項目が、同じ枠を奪い合っている。

OCR で文字にしてしまえば枠は空くが、Amazon Textract は日本語の文字検出に
対応していない（対応言語は英・仏・独・伊・葡・西。縦書きも非対応と明記）。
図も文字にはならない。

そこで、**読み取りだけをモデルにやらせて先に済ませる**。20ページずつに区切れば
1回の呼び出しの上限に収まり、区切った回数だけ読める。合計ページ数の上限は
なくなり、代わりに時間と費用が天井になる。

## 何を作るか

ページごとに「書き起こした文字」と「図の説明」を残す。審査のときは
- 文字はいくらでも読める（画像の枠を使わない）
- どのページに図があるか最初から分かるので、**枠を図だけに使える**

読み取りは**書類ごとに1回**で、チェック項目の数だけ繰り返さない。項目が
20個あっても読み取りは1回のまま。項目が多いほど割に合う。

## いつ回すか

全部の書類に回すと、文字の入った短い PDF にまで費用がかかる。そのまま
1回で渡せる書類は、いまのやり方のほうが安くて速い。だから

- 1回に収まらない（ページ数・大きさ）
- 文字が取り出せないページがある（スキャン）

のどちらかに当てはまる書類だけを読み取る。

なお「文字が取り出せないページ」を条件に入れているのは、Bedrock が
document ブロックに入れたスキャン PDF をどこまで見るかが公式には書かれて
いないため。読めているかもしれないし、空のまま判定しているかもしれない。
確かめられないことに賭けず、こちらで読み取っておく
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Iterable

# 1回の読み取りで扱うページ数。Converse が1回に受け取る画像は20枚まで
MAX_PAGES_PER_BATCH = 20

# これより文字が少ないページは、取り出せていないとみなす。
# 空白やページ番号だけが拾えることがあるので 0 では判定できない
SCANNED_PAGE_CHARS = 20


@dataclass(frozen=True)
class PageSurvey:
    """読み取りが要るかを決めるための、ページ1枚の下見"""

    page: int
    characters: int
    has_drawing: bool = False

    @property
    def looks_scanned(self) -> bool:
        return self.characters < SCANNED_PAGE_CHARS


@dataclass(frozen=True)
class DigestBatch:
    """1回の呼び出しで読み取るページの範囲。両端を含む"""

    first_page: int
    last_page: int

    @property
    def page_count(self) -> int:
        return self.last_page - self.first_page + 1


@dataclass
class PageDigest:
    """読み取った結果。ページ1枚ぶん"""

    page: int
    text: str = ""
    figures: list[str] = field(default_factory=list)

    @property
    def has_figure(self) -> bool:
        return bool(self.figures)


def needs_digest(
    survey: Iterable[PageSurvey],
    *,
    size_bytes: int,
    page_limit: int,
    byte_limit: int,
) -> bool:
    """この書類を先に読み取っておくか。

    1回で渡せて、どのページからも文字が取れるなら、読み取らない。
    余計な費用をかけないため
    """
    pages = list(survey)
    if not pages:
        return False
    if len(pages) > page_limit or size_bytes > byte_limit:
        return True
    return any(page.looks_scanned for page in pages)


def plan_batches(
    page_count: int, batch_size: int = MAX_PAGES_PER_BATCH
) -> list[DigestBatch]:
    """ページを、1回の呼び出しに収まる範囲へ区切る。

    最後の1回が1ページだけになっても分けたままにする。詰め直すと
    どのページがどの呼び出しに入ったか追えなくなる
    """
    if page_count <= 0:
        return []
    if batch_size <= 0:
        raise ValueError("batch_size must be at least 1")
    return [
        DigestBatch(first, min(first + batch_size - 1, page_count))
        for first in range(1, page_count + 1, batch_size)
    ]


def merge_batches(
    results: Iterable[Iterable[PageDigest]], *, page_count: int
) -> list[PageDigest]:
    """区切って読み取った結果を、ページ順に1つへまとめる。

    読み取れなかったページも空のまま残す。抜けたページを黙って詰めると、
    「12ページ」と言われたものが別のページを指すようになる。
    範囲の外や重複は捨てる。モデルの返事をそのまま信用しない
    """
    merged: dict[int, PageDigest] = {
        page: PageDigest(page=page) for page in range(1, page_count + 1)
    }
    for batch in results:
        for digest in batch:
            if digest.page not in merged:
                continue
            current = merged[digest.page]
            if current.text or current.figures:
                # 同じページが2回返ってきた。先に入ったものを残す
                continue
            merged[digest.page] = digest
    return [merged[page] for page in range(1, page_count + 1)]


def unread_pages(digests: Iterable[PageDigest]) -> list[int]:
    """読み取れなかったページ。審査のときに「ここは見ていない」と言うために使う"""
    return [
        digest.page
        for digest in digests
        if not digest.text.strip() and not digest.figures
    ]


def figure_pages(digests: Iterable[PageDigest]) -> list[dict[str, Any]]:
    """図のあるページの一覧。審査のとき、どこを見るか選ぶ手がかりになる"""
    return [
        {"page": digest.page, "figures": digest.figures}
        for digest in digests
        if digest.has_figure
    ]


def to_json(digests: Iterable[PageDigest]) -> str:
    return json.dumps(
        {
            "version": 1,
            "pages": [
                {"page": d.page, "text": d.text, "figures": d.figures}
                for d in digests
            ],
        },
        ensure_ascii=False,
    )


def from_json(payload: str) -> list[PageDigest]:
    """保存した読み取り結果を読み戻す。

    壊れていたら空で返す。読み取りは補助なので、読めないことで審査を
    止めない。そのかわり、審査は元のファイルを見に行く
    """
    try:
        data = json.loads(payload)
        pages = data.get("pages") or []
    except (json.JSONDecodeError, AttributeError):
        return []
    digests = []
    for page in pages:
        try:
            digests.append(
                PageDigest(
                    page=int(page["page"]),
                    text=str(page.get("text") or ""),
                    figures=[str(figure) for figure in page.get("figures") or []],
                )
            )
        except (KeyError, TypeError, ValueError):
            continue
    return digests


def survey_pdf(path: str) -> list[PageSurvey]:
    """PDF を1ページずつ下見する。読み取りが要るかを決めるためだけのもの。

    モデルは呼ばない。文字の量と、絵が貼られているかを見るだけなので、
    ページ数に関わらず一瞬で終わる。

    読めない PDF は空で返す。ここで例外を投げると、下見のせいで審査が
    止まる。審査そのものは元のファイルを渡す道が別にある
    """
    from pypdf import PdfReader

    try:
        reader = PdfReader(path)
        if reader.is_encrypted and not reader.decrypt(""):
            return []
        pages = reader.pages
    except Exception:
        return []

    survey = []
    for number, page in enumerate(pages, start=1):
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        survey.append(
            PageSurvey(
                page=number,
                characters=len(text.strip()),
                has_drawing=_has_drawing(page),
            )
        )
    return survey


def _has_drawing(page: Any) -> bool:
    """ページに絵が貼られているか。

    文字が取れるページでも、図面や写真が載っていることがある。そういう
    ページは、文字だけ読んでも判断できない
    """
    try:
        resources = page.get("/Resources")
        if resources is None:
            return False
        xobjects = resources.get_object().get("/XObject")
        if xobjects is None:
            return False
        for reference in xobjects.get_object().values():
            if reference.get_object().get("/Subtype") == "/Image":
                return True
    except Exception:
        return False
    return False
