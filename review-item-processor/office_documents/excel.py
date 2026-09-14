"""Excel（xlsx）を Markdown にする"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Callable, Optional
from xml.etree import ElementTree as ET

from . import limits
from .converter import Converter
from .drawing import drawing_text
from .model import OfficeFileError
from .ooxml import (
    child,
    column_letters,
    elements,
    markdown_table,
    q,
    table_cell,
    to_int,
    walk,
)
from .package import Images, Package

# 組み込みの表示形式（numFmtId）。styles.xml には書かれない
_BUILTIN_NUMBER_FORMATS = {
    0: "General",
    1: "0",
    2: "0.00",
    3: "#,##0",
    4: "#,##0.00",
    9: "0%",
    10: "0.00%",
    11: "0.00E+00",
    12: "# ?/?",
    13: "# ??/??",
    14: "yyyy/m/d",
    15: "d-mmm-yy",
    16: "d-mmm",
    17: "mmm-yy",
    18: "h:mm AM/PM",
    19: "h:mm:ss AM/PM",
    20: "h:mm",
    21: "h:mm:ss",
    22: "yyyy/m/d h:mm",
    37: "#,##0 ;(#,##0)",
    38: "#,##0 ;(#,##0)",
    39: "#,##0.00;(#,##0.00)",
    40: "#,##0.00;(#,##0.00)",
    45: "mm:ss",
    46: "[h]:mm:ss",
    47: "mm:ss.0",
    48: "##0.0E+0",
    49: "@",
    # 日本語の Excel の組み込み形式（和暦を含む）。西暦の日付・時刻として出す
    27: "yyyy/m/d",
    28: "yyyy/m/d",
    29: "yyyy/m/d",
    30: "m/d/yy",
    31: "yyyy/m/d",
    32: "h:mm",
    33: "h:mm:ss",
    34: "yyyy/m/d",
    35: "yyyy/m/d",
    36: "yyyy/m/d",
    50: "yyyy/m/d",
    51: "yyyy/m/d",
    52: "yyyy/m",
    53: "m/d",
    54: "yyyy/m/d",
    55: "yyyy/m",
    56: "m/d",
    57: "yyyy/m/d",
    58: "yyyy/m/d",
}

# A1 形式のセル参照。関数名（LOG10( など）、シート名（Q1!）、名前の一部は除く
_REFERENCE = re.compile(
    r"(?<![A-Za-z0-9_.])(\$?)([A-Z]{1,3})(\$?)([0-9]+)(?![0-9A-Za-z_(!])"
)
_QUOTED = re.compile(r"(\"(?:[^\"]|\"\")*\"|'(?:[^']|'')*')")


def _column_index(letters: str) -> int:
    index = 0
    for letter in letters:
        index = index * 26 + ord(letter) - 64
    return index


# --- 数式 ---


def _outside_quotes(text: str, transform: Callable[[str], str]) -> str:
    """文字列リテラルとシート名の引用の外だけを変える"""
    parts = _QUOTED.split(text)
    return "".join(
        part if index % 2 else transform(part) for index, part in enumerate(parts)
    )


def _shift_formula(formula: str, rows: int, columns: int) -> str:
    """
    共有数式を、元のセルからずれた位置の式に直す。

    下にコピーした数式は、先頭のセルにだけ式が入り、残りのセルは共有番号（si）
    だけで保存される。元の式の相対参照（$ の付かない行・列）をずらして戻す。
    """

    def shift(match: re.Match) -> str:
        column_absolute, letters, row_absolute, number = match.groups()
        column = _column_index(letters) + (0 if column_absolute else columns)
        row = int(number) + (0 if row_absolute else rows)
        if column < 1 or row < 1:
            return match.group(0)
        return f"{column_absolute}{column_letters(column)}{row_absolute}{row}"

    return _outside_quotes(formula, lambda part: _REFERENCE.sub(shift, part))


def _relative_shape(formula: str, row: int) -> str:
    """
    数式の相対的な行を、そのセルの行からのずれ（{r}, {r-1}）で書いた形。

    行ごとにコピーした数式は同じ形になるので、1行にまとめられる。行を固定した
    参照（$H$2）は、固定しているのが意味なのでそのまま残す。
    """

    def replace(match: re.Match) -> str:
        column_absolute, letters, row_absolute, number = match.groups()
        if row_absolute:
            return match.group(0)
        offset = int(number) - row
        return f"{column_absolute}{letters}{{r{'' if offset == 0 else f'{offset:+d}'}}}"

    return _outside_quotes(formula, lambda part: _REFERENCE.sub(replace, part))


def _formula_lines(formulas: list[tuple[int, int, str]]) -> list[str]:
    """同じ列に同じ形でコピーされた数式を、範囲1行にまとめる"""
    groups: dict[tuple[int, str], list[tuple[int, str]]] = {}
    for row, column, formula in formulas:
        groups.setdefault((column, _relative_shape(formula, row)), []).append(
            (row, formula)
        )

    lines = []
    for index, ((column, shape), cells) in enumerate(groups.items()):
        if index >= limits.MAX_FORMULAS_PER_SHEET:
            lines.append(
                f"[formulas left out] {len(groups) - limits.MAX_FORMULAS_PER_SHEET} "
                "more distinct formulas are not shown."
            )
            break
        letters = column_letters(column)
        if len(cells) == 1:
            row, formula = cells[0]
            lines.append(f"[formula] {letters}{row}: ={formula}")
        else:
            rows = [row for row, _ in cells]
            lines.append(
                f"[formula] {letters}{min(rows)}:{letters}{max(rows)}: ={shape}  "
                f"({len(cells)} cells; {{r}} is each cell's own row)"
            )
    return lines


# --- 表示形式 ---


def _general_number(number: float) -> str:
    if number.is_integer() and abs(number) < 1e15:
        return str(int(number))
    return f"{number:.15g}"


def _first_section(code: str) -> str:
    """表示形式の最初の区分（「正;負;ゼロ;文字」の「正」）"""
    parts = _QUOTED.split(code)
    kept = []
    for index, part in enumerate(parts):
        if index % 2 == 0 and ";" in part:
            kept.append(part.split(";", 1)[0])
            break
        kept.append(part)
    return "".join(kept)


def _excel_datetime(number: float, date1904: bool) -> Optional[datetime]:
    if number < 0 or number > 2_958_465:
        return None
    if date1904:
        base = datetime(1904, 1, 1)
    elif number < 60:
        # Excel は存在しない 1900/2/29 を数えるので、それより前は1日ずれる
        base = datetime(1899, 12, 31)
    else:
        base = datetime(1899, 12, 30)
    return base + timedelta(seconds=round(number * 86400))


def _format_datetime(number: float, section: str, bare: str, date1904: bool) -> str:
    lowered = bare.lower()
    if re.search(r"\[h+\]", section.lower()):
        # 経過時間（24時間を超えて数える）
        total = round(number * 86400)
        hours, remainder = divmod(total, 3600)
        minutes, seconds = divmod(remainder, 60)
        return (
            f"{hours}:{minutes:02d}:{seconds:02d}"
            if "s" in lowered
            else f"{hours}:{minutes:02d}"
        )
    moment = _excel_datetime(number, date1904)
    if moment is None:
        return _general_number(number)
    has_time = bool(re.search(r"[hs]", lowered))
    has_date = bool(re.search(r"[yd]", lowered)) or ("m" in lowered and not has_time)
    pieces = []
    if has_date:
        if "y" not in lowered:
            pieces.append(moment.strftime("%m/%d"))
        elif "d" not in lowered:
            pieces.append(moment.strftime("%Y/%m"))
        else:
            pieces.append(moment.strftime("%Y/%m/%d"))
    if has_time:
        pieces.append(moment.strftime("%H:%M:%S" if "s" in lowered else "%H:%M"))
    return " ".join(pieces)


def _affixes(section: str) -> tuple[str, str]:
    """数字の前後に表示する文字（"¥"、円、% など）"""
    tokens = re.findall(r'"[^"]*"|\\.|\[[^\]]*\]|_.|\*.|.', section)
    prefix: list[str] = []
    suffix: list[str] = []
    seen_digit = False
    for token in tokens:
        if token in "0#?,.":
            seen_digit = True
            suffix.clear()
            continue
        if token.startswith('"'):
            literal = token[1:-1]
        elif token.startswith("\\"):
            literal = token[1:]
        elif token.startswith("["):
            currency = re.match(r"\[\$([^-\]]*)", token)
            literal = currency.group(1) if currency else ""
        elif token.startswith("_"):
            literal = " "
        elif token.startswith("*"):
            literal = ""
        else:
            literal = token
        (suffix if seen_digit else prefix).append(literal)
    return "".join(prefix), "".join(suffix).rstrip()


def _format_number(raw: str, code: str, date1904: bool) -> str:
    """セルの値に表示形式を当てる。丸めで表示が変わるときは、元の値を括弧で添える"""
    try:
        number = float(raw)
    except ValueError:
        return raw
    section = _first_section(code)
    bare = re.sub(r'"[^"]*"|\\.|\[[^\]]*\]|_.|\*.', "", section)
    if bare.strip().lower() in ("", "general", "@"):
        return _general_number(number)
    if re.search(r"[ymdhs]", bare.lower()) and not re.search(r"[0#?]", bare):
        return _format_datetime(number, section, bare, date1904)

    digits = re.search(r"[0#?][0#?,]*(\.[0#?]+)?", bare)
    if digits is None:
        return _general_number(number)
    percent = "%" in bare
    exponent = "e" in bare.lower()
    value = number * 100 if percent else number
    decimals = len(digits.group(1)) - 1 if digits.group(1) else 0
    sign = "-" if value < 0 else ""
    prefix, suffix = _affixes(section)

    if exponent:
        return f"{sign}{prefix}{abs(value):.{decimals}E}"
    exact = Decimal(repr(abs(value)))
    rounded = exact.quantize(Decimal(1).scaleb(-decimals), rounding=ROUND_HALF_UP)
    text = (
        f"{rounded:,.{decimals}f}"
        if "," in digits.group(0)
        else f"{rounded:.{decimals}f}"
    )
    formatted = f"{sign}{prefix}{text}{suffix}"
    if not percent and rounded != exact:
        formatted += f" ({_general_number(number)})"
    return formatted


def _rich_text(element: Optional[ET.Element]) -> str:
    """共有文字列やコメントの文字。ふりがな（rPh）は読みなので入れない"""
    if element is None:
        return ""
    parts = []
    for node in element:
        if node.tag == q("s:t"):
            parts.append(node.text or "")
        elif node.tag == q("s:r"):
            text = child(node, "s:t")
            parts.append((text.text or "") if text is not None else "")
    return "".join(parts)


# --- シート ---


@dataclass
class _SheetCells:
    values: dict[tuple[int, int], str] = field(default_factory=dict)
    formulas: list[tuple[int, int, str]] = field(default_factory=list)
    hidden_rows: set[int] = field(default_factory=set)
    rows_left_out: set[int] = field(default_factory=set)
    columns_left_out: bool = False
    cells_left_out: int = 0


class ExcelConverter(Converter):
    def __init__(self, package: Package, images: Images):
        super().__init__(package, images)
        shared_strings = self._package.xml("xl/sharedStrings.xml")
        self._strings = [
            _rich_text(item)
            for item in (
                shared_strings.findall(q("s:si")) if shared_strings is not None else []
            )
        ]
        self._formats = self._read_number_formats()
        self._date1904 = False
        self._cells_read = 0

    def convert(self) -> str:
        part = "xl/workbook.xml"
        workbook = self._package.xml(part)
        if workbook is None:
            raise OfficeFileError("xl/workbook.xml could not be read")
        properties = child(workbook, "s:workbookPr")
        self._date1904 = properties is not None and properties.get("date1904") in (
            "1",
            "true",
        )
        relationships = self._package.relationships(part)

        sections = []
        for sheet in elements(child(workbook, "s:sheets")):
            target = relationships.get(sheet.get(q("r:id")) or "")
            if target:
                sections.append(
                    self._sheet(
                        sheet.get("name", ""), target[1], sheet.get("state", "visible")
                    )
                )
        return "\n\n".join(sections)

    def _read_number_formats(self) -> list[str]:
        root = self._package.xml("xl/styles.xml")
        if root is None:
            return []
        custom = {
            to_int(number_format.get("numFmtId")): number_format.get("formatCode", "")
            for number_format in elements(child(root, "s:numFmts"))
        }
        return [
            custom.get(
                to_int(xf.get("numFmtId")),
                _BUILTIN_NUMBER_FORMATS.get(to_int(xf.get("numFmtId")), "General"),
            )
            for xf in elements(child(root, "s:cellXfs"))
        ]

    def _sheet(self, name: str, part: str, state: str) -> str:
        heading = f"## Sheet: {name}" + ("" if state == "visible" else f" ({state})")
        root = self._package.xml(part)
        if root is None:
            return f"{heading}\n(this sheet could not be read)"

        cells = self._read_cells(root)
        lines = [heading, self._values_table(cells) or "(no values)"]
        lines += self._notes(root, cells)
        lines += _formula_lines(cells.formulas)
        for relationship_type, target in self._package.relationships(part).values():
            if relationship_type.endswith("/comments"):
                lines += self._comment_lines(target)
            elif relationship_type.endswith("/drawing"):
                lines += self._drawing_lines(target)
        return "\n".join(lines)

    def _notes(self, root: ET.Element, cells: _SheetCells) -> list[str]:
        """非表示の列、上限で省いた分、結合セル"""
        lines = []
        used_columns = {column for _, column in cells.values}
        hidden_columns = sorted(
            column for column in self._hidden_columns(root) if column in used_columns
        )
        if hidden_columns:
            lines.append(
                "[hidden columns] "
                + ", ".join(column_letters(column) for column in hidden_columns)
            )
        if cells.rows_left_out:
            lines.append(
                f"[rows left out] {len(cells.rows_left_out)} more rows with values are "
                f"not shown (only the first {limits.MAX_SHEET_ROWS} are included)."
            )
        if cells.columns_left_out:
            lines.append(
                "[columns left out] columns after "
                f"{column_letters(limits.MAX_SHEET_COLUMNS)} are not shown."
            )
        if cells.cells_left_out:
            lines.append(
                f"[cells left out] {cells.cells_left_out} more cells are not shown "
                f"(the limit for a workbook is {limits.MAX_WORKBOOK_CELLS} cells)."
            )
        merged = [
            merge.get("ref", "") for merge in elements(child(root, "s:mergeCells"))
        ]
        if merged:
            lines.append("[merged cells] " + ", ".join(merged))
        return lines

    def _read_cells(self, root: ET.Element) -> _SheetCells:
        cells = _SheetCells()
        shared: dict[str, tuple[int, int, str]] = {}
        rows_with_values: set[int] = set()
        row_number = 0
        for row in elements(child(root, "s:sheetData")):
            row_number = to_int(row.get("r"), row_number + 1)
            if row.get("hidden") in ("1", "true"):
                cells.hidden_rows.add(row_number)
            column = 0
            for cell in row.findall(q("s:c")):
                reference = re.fullmatch(r"\$?([A-Z]+)\$?\d+", cell.get("r") or "")
                column = _column_index(reference.group(1)) if reference else column + 1

                formula = self._formula(cell, row_number, column, shared)
                if formula:
                    cells.formulas.append((row_number, column, formula))
                text = self._cell_value(cell)
                if text == "":
                    continue
                if (
                    row_number not in rows_with_values
                    and len(rows_with_values) >= limits.MAX_SHEET_ROWS
                ):
                    cells.rows_left_out.add(row_number)
                elif column > limits.MAX_SHEET_COLUMNS:
                    cells.columns_left_out = True
                elif self._cells_read >= limits.MAX_WORKBOOK_CELLS:
                    cells.cells_left_out += 1
                else:
                    rows_with_values.add(row_number)
                    cells.values[(row_number, column)] = text
                    self._cells_read += 1
        return cells

    def _values_table(self, cells: _SheetCells) -> str:
        if not cells.values:
            return ""
        columns = sorted({column for _, column in cells.values})
        rows = [[""] + [column_letters(column) for column in columns]]
        for row in sorted({row for row, _ in cells.values}):
            label = f"{row} (hidden)" if row in cells.hidden_rows else str(row)
            rows.append(
                [label]
                + [
                    table_cell(cells.values.get((row, column), ""))
                    for column in columns
                ]
            )
        return markdown_table(rows)

    def _hidden_columns(self, root: ET.Element) -> set[int]:
        hidden: set[int] = set()
        for column in elements(child(root, "s:cols")):
            if column.get("hidden") in ("1", "true"):
                start = to_int(column.get("min"))
                end = min(to_int(column.get("max")), start + limits.MAX_SHEET_COLUMNS)
                hidden.update(range(start, end + 1))
        return hidden

    def _formula(
        self,
        cell: ET.Element,
        row: int,
        column: int,
        shared: dict[str, tuple[int, int, str]],
    ) -> str:
        element = child(cell, "s:f")
        if element is None:
            return ""
        text = element.text or ""
        if element.get("t") == "shared":
            index = element.get("si", "")
            if text:
                shared[index] = (row, column, text)
            elif index in shared:
                origin_row, origin_column, origin = shared[index]
                text = _shift_formula(origin, row - origin_row, column - origin_column)
        return text

    def _cell_value(self, cell: ET.Element) -> str:
        kind = cell.get("t", "n")
        if kind == "inlineStr":
            return _rich_text(child(cell, "s:is"))
        value = child(cell, "s:v")
        raw = value.text if value is not None and value.text is not None else ""
        if raw == "":
            return ""
        if kind == "s":
            index = to_int(raw, -1)
            return self._strings[index] if 0 <= index < len(self._strings) else raw
        if kind == "b":
            return "TRUE" if raw == "1" else "FALSE"
        if kind in ("str", "e", "d"):
            return raw
        style = to_int(cell.get("s"))
        code = self._formats[style] if style < len(self._formats) else "General"
        return _format_number(raw, code, self._date1904)

    def _comment_lines(self, part: str) -> list[str]:
        root = self._package.xml(part)
        if root is None:
            return []
        authors = [author.text or "" for author in elements(child(root, "s:authors"))]
        lines = []
        for comment in elements(child(root, "s:commentList")):
            author_id = to_int(comment.get("authorId"), -1)
            author = authors[author_id] if 0 <= author_id < len(authors) else ""
            text = _rich_text(child(comment, "s:text")).strip()
            lines.append(
                f"[comment] {comment.get('ref', '')}"
                + (f" ({author})" if author else "")
                + f": {text}"
            )
        return lines

    def _drawing_lines(self, part: str) -> list[str]:
        """シートに置いたグラフ・画像・図形。置いた場所のセルを添える"""
        root = self._package.xml(part)
        if root is None:
            return []
        relationships = self._package.relationships(part)
        lines = []
        for anchor in root:
            where = _anchor_cell(child(anchor, "xdr:from"))
            for node in walk(anchor):
                if node.tag == q("xdr:sp"):
                    text = " ".join(drawing_text(node).split("\n"))
                    if text:
                        lines.append(f"[shape{where}] {text}")
                    continue
                found = self._image_or_chart(node, relationships)
                if found:
                    first_line, _, rest = found.partition("\n")
                    lines.append(first_line + where + ("\n" + rest if rest else ""))
        return lines


def _anchor_cell(start: Optional[ET.Element]) -> str:
    """図形を置いたセル（xdr:from の列と行は 0 から数える）を「 at D3」の形で"""
    if start is None:
        return ""
    column_element = child(start, "xdr:col")
    row_element = child(start, "xdr:row")
    column = to_int(column_element.text if column_element is not None else None) + 1
    row = to_int(row_element.text if row_element is not None else None) + 1
    return f" at {column_letters(column)}{row}"
