#!/usr/bin/env python3
"""
Word・Excel・PowerPoint を XML から Markdown に変換するテスト。

Office ファイルは XML を ZIP に詰めたものなので、実物と同じ部品の配置で最小の
ファイルをその場で作る。
"""

import io
import os
import sys
import zipfile

import pytest
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import office_documents as od
from office_documents import excel, limits

RELATIONSHIP = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
WORD = (
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    f'xmlns:r="{RELATIONSHIP}" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'
)
SHEET = f'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="{RELATIONSHIP}"'
DRAWING = (
    'xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" '
    f'xmlns:r="{RELATIONSHIP}"'
)
CHART = (
    'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
)
SLIDE = (
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    f'xmlns:r="{RELATIONSHIP}"'
)


def relationships(*entries):
    body = "".join(
        f'<Relationship Id="{rid}" Type="{RELATIONSHIP}/{kind}" Target="{target}"/>'
        for rid, kind, target in entries
    )
    return f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{body}</Relationships>'


def png(width=4, height=3):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), "red").save(buffer, "PNG")
    return buffer.getvalue()


def write_package(tmp_path, name, parts):
    path = tmp_path / name
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for part, content in parts.items():
            archive.writestr(part, content)
    return str(path)


# ---------------------------------------------------------------------------
# Excel
# ---------------------------------------------------------------------------

CHART_XML = (
    f"<c:chartSpace {CHART}><c:chart>"
    "<c:title><c:tx><c:rich><a:p><a:r><a:t>月別売上</a:t></a:r></a:p></c:rich></c:tx></c:title>"
    "<c:plotArea><c:barChart><c:ser>"
    '<c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>売上</c:v></c:pt></c:strCache></c:strRef></c:tx>'
    '<c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>1月</c:v></c:pt><c:pt idx="1"><c:v>2月</c:v></c:pt></c:strCache></c:strRef></c:cat>'
    '<c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>100</c:v></c:pt><c:pt idx="1"><c:v>120</c:v></c:pt></c:numCache></c:numRef></c:val>'
    "</c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>"
)


def workbook_parts(rows=None):
    strings = "".join(
        f"<si><t>{text}</t></si>" for text in ["日付", "品目", "金額", "合計", "保守"]
    )
    strings += '<si><r><t>見積</t></r><r><t>書</t></r><rPh sb="0" eb="2"><t>ミツモリ</t></rPh></si>'
    rows = rows or (
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c>'
        '<c r="C1" t="s"><v>2</v></c><c r="E1" t="s"><v>5</v></c></row>'
        '<row r="2"><c r="A2" s="1"><v>45292</v></c><c r="B2" t="s"><v>4</v></c>'
        '<c r="C2" s="2"><v>30000</v></c>'
        '<c r="D2"><f t="shared" ref="D2:D3" si="0">C2*1.1</f><v>33000</v></c></row>'
        '<row r="3"><c r="A3" s="1"><v>45293</v></c><c r="B3" t="inlineStr"><is><t>点検</t></is></c>'
        '<c r="C3" s="2"><v>1234.5</v></c><c r="D3"><f t="shared" si="0"/><v>1357.95</v></c></row>'
        '<row r="4" hidden="1"><c r="A4" t="s"><v>3</v></c>'
        '<c r="C4" s="2"><f>SUM(C2:C3)</f><v>31234.5</v></c></row>'
        '<row r="6"><c r="A6" t="b"><v>1</v></c><c r="B6" t="e"><v>#DIV/0!</v></c></row>'
    )
    drawing = (
        f"<xdr:wsDr {DRAWING}>"
        "<xdr:twoCellAnchor><xdr:from><xdr:col>5</xdr:col><xdr:row>1</xdr:row></xdr:from>"
        '<xdr:graphicFrame><a:graphic><a:graphicData><c:chart r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame>'
        "</xdr:twoCellAnchor>"
        "<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:row>9</xdr:row></xdr:from>"
        '<xdr:pic><xdr:blipFill><a:blip r:embed="rId2"/></xdr:blipFill></xdr:pic></xdr:oneCellAnchor>'
        "</xdr:wsDr>"
    )
    return {
        "xl/workbook.xml": (
            f'<workbook {SHEET}><sheets><sheet name="明細" sheetId="1" r:id="rId1"/>'
            '<sheet name="データ" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>'
        ),
        "xl/_rels/workbook.xml.rels": relationships(
            ("rId1", "worksheet", "worksheets/sheet1.xml"),
            ("rId2", "worksheet", "worksheets/sheet2.xml"),
        ),
        "xl/sharedStrings.xml": f"<sst {SHEET}>{strings}</sst>",
        "xl/styles.xml": (
            f'<styleSheet {SHEET}><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;¥&quot;#,##0"/></numFmts>'
            '<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>'
        ),
        "xl/worksheets/sheet1.xml": (
            f'<worksheet {SHEET}><cols><col min="5" max="5" hidden="1"/></cols>'
            f"<sheetData>{rows}</sheetData>"
            '<mergeCells count="1"><mergeCell ref="A8:C8"/></mergeCells></worksheet>'
        ),
        "xl/worksheets/_rels/sheet1.xml.rels": relationships(
            ("rId1", "comments", "../comments1.xml"),
            ("rId2", "drawing", "../drawings/drawing1.xml"),
        ),
        "xl/comments1.xml": (
            f"<comments {SHEET}><authors><author>山田</author></authors><commentList>"
            '<comment ref="C2" authorId="0"><text><r><t>税抜</t></r></text></comment>'
            "</commentList></comments>"
        ),
        "xl/drawings/drawing1.xml": drawing,
        "xl/drawings/_rels/drawing1.xml.rels": relationships(
            ("rId1", "chart", "../charts/chart1.xml"),
            ("rId2", "image", "../media/image1.png"),
        ),
        "xl/charts/chart1.xml": CHART_XML,
        "xl/media/image1.png": png(),
        "xl/worksheets/sheet2.xml": (
            f'<worksheet {SHEET}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>控え</t></is></c></row>'
            "</sheetData></worksheet>"
        ),
    }


def test_workbook_keeps_cell_addresses_formats_and_structure(tmp_path):
    path = write_package(tmp_path, "book.xlsx", workbook_parts())

    document = od.convert_office_file(path, display_name="見積.xlsx")
    markdown = document.markdown

    assert markdown.startswith("# 見積.xlsx\n")
    assert "## Sheet: 明細" in markdown
    assert "| A | B | C | D | E |" in markdown
    assert "| 2 | 2024/01/01 | 保守 | ¥30,000 | 33000 |  |" in markdown
    # 表示形式で丸めた値には、元の値を添える
    assert "| 3 | 2024/01/02 | 点検 | ¥1,235 (1234.5) | 1357.95 |  |" in markdown
    assert "| 4 (hidden) | 合計 |  | ¥31,235 (31234.5) |  |  |" in markdown
    assert "| 6 | TRUE | #DIV/0! |  |  |  |" in markdown
    # ふりがなは入れない
    assert "見積書" in markdown and "ミツモリ" not in markdown
    assert "[hidden columns] E" in markdown
    assert "[merged cells] A8:C8" in markdown
    assert "[comment] C2 (山田): 税抜" in markdown
    assert "## Sheet: データ (hidden)" in markdown and "控え" in markdown


def test_workbook_expands_shared_formulas_and_groups_copied_ones(tmp_path):
    path = write_package(tmp_path, "book.xlsx", workbook_parts())

    markdown = od.convert_office_file(path).markdown

    # 共有数式は先頭のセルにしか式が無いが、コピーした全セル分として数える
    assert (
        "[formula] D2:D3: =C{r}*1.1  (2 cells; {r} is each cell's own row)" in markdown
    )
    assert "[formula] C4: =SUM(C2:C3)" in markdown


def test_workbook_reads_charts_and_images_placed_on_a_sheet(tmp_path):
    path = write_package(tmp_path, "book.xlsx", workbook_parts())

    document = od.convert_office_file(path)

    assert "[chart] 月別売上 at F2" in document.markdown
    assert "  売上: 1月=100, 2月=120" in document.markdown
    assert "[image: image1.png] at A10" in document.markdown
    assert [(image.name, image.format) for image in document.images] == [
        ("image1.png", "png")
    ]


def test_workbook_says_when_rows_are_left_out(tmp_path, monkeypatch):
    monkeypatch.setattr(limits, "MAX_SHEET_ROWS", 2)
    path = write_package(tmp_path, "book.xlsx", workbook_parts())

    markdown = od.convert_office_file(path).markdown

    assert (
        "[rows left out] 3 more rows with values are not shown (only the first 2 are included)."
        in markdown
    )
    assert "点検" not in markdown


@pytest.mark.parametrize(
    "raw, code, expected",
    [
        ("0.5", "0%", "50%"),
        ("45292.5", "yyyy/m/d h:mm", "2024/01/01 12:00"),
        ("-1234.5", "#,##0.00", "-1,234.50"),
        ("12", "General", "12"),
        ("1500", '#,##0"円"', "1,500円"),
        ("1.25", "[h]:mm:ss", "30:00:00"),
    ],
)
def test_number_formats(raw, code, expected):
    assert excel._format_number(raw, code, date1904=False) == expected


def test_shift_formula_moves_only_relative_references():
    assert (
        excel._shift_formula("SUM(A1:$B$2)+'Q1'!C3+\"A1\"+LOG10(A1)", 2, 1)
        == "SUM(B3:$B$2)+'Q1'!D5+\"A1\"+LOG10(B3)"
    )


def test_relative_shape_describes_rows_from_the_cell():
    assert excel._relative_shape("SUM(B2:B4)+$H$2", 5) == "SUM(B{r-3}:B{r-1})+$H$2"


# ---------------------------------------------------------------------------
# Word
# ---------------------------------------------------------------------------


def document_parts():
    body = (
        '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>社内稟議</w:t></w:r></w:p>'
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>概要</w:t></w:r></w:p>'
        '<w:p><w:r><w:t xml:space="preserve">本文の</w:t></w:r>'
        '<w:ins w:id="1" w:author="A"><w:r><w:t>追記</w:t></w:r></w:ins>'
        '<w:del w:id="2" w:author="A"><w:r><w:delText>削除</w:delText></w:r></w:del>'
        '<w:r><w:t>です</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r>'
        '<w:commentRangeStart w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>'
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>一つ目</w:t></w:r></w:p>'
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>二つ目</w:t></w:r></w:p>'
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>その下</w:t></w:r></w:p>'
        '<w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr><w:r><w:t>箇条書き</w:t></w:r></w:p>'
        "<w:tbl>"
        "<w:tr><w:tc><w:p><w:r><w:t>項目</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>金額</w:t></w:r></w:p></w:tc></w:tr>"
        '<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>横に結合</w:t></w:r></w:p></w:tc></w:tr>'
        '<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>縦に結合</w:t></w:r></w:p></w:tc>'
        "<w:tc><w:p><w:r><w:t>A|B</w:t></w:r></w:p></w:tc></w:tr>"
        "<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>2行目</w:t></w:r></w:p></w:tc></w:tr>"
        "</w:tbl>"
        '<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId5"/>'
        "</pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"
        '<w:sectPr><w:headerReference r:id="rId6"/></w:sectPr>'
    )
    styles = (
        f"<w:styles {WORD}>"
        '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>'
        '<w:style w:type="paragraph" w:styleId="List"><w:name w:val="List"/>'
        '<w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="List"/></w:style>'
        "</w:styles>"
    )
    numbering = (
        f"<w:numbering {WORD}>"
        '<w:abstractNum w:abstractNumId="0">'
        '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>'
        '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/></w:lvl>'
        "</w:abstractNum>"
        '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>'
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
        '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>'
        "</w:numbering>"
    )
    return {
        "word/document.xml": f"<w:document {WORD}><w:body>{body}</w:body></w:document>",
        "word/_rels/document.xml.rels": relationships(
            ("rId5", "image", "media/image1.png"),
            ("rId6", "header", "header1.xml"),
            ("rId7", "footnotes", "footnotes.xml"),
            ("rId8", "comments", "comments.xml"),
        ),
        "word/styles.xml": styles,
        "word/numbering.xml": numbering,
        "word/media/image1.png": png(),
        "word/header1.xml": f"<w:hdr {WORD}><w:p><w:r><w:t>社外秘</w:t></w:r></w:p></w:hdr>",
        "word/footnotes.xml": (
            f'<w:footnotes {WORD}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>'
            '<w:footnote w:id="1"><w:p><w:r><w:t>金額は税抜</w:t></w:r></w:p></w:footnote></w:footnotes>'
        ),
        "word/comments.xml": (
            f'<w:comments {WORD}><w:comment w:id="0" w:author="佐藤"><w:p><w:r><w:t>根拠を添付</w:t></w:r></w:p>'
            "</w:comment></w:comments>"
        ),
        "docProps/custom.xml": (
            '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" '
            'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
            '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="MSIP_Label_1234_Name">'
            "<vt:lpwstr>社外秘ラベル</vt:lpwstr></property></Properties>"
        ),
    }


def test_document_keeps_headings_lists_tables_and_revisions(tmp_path):
    path = write_package(tmp_path, "doc.docx", document_parts())

    document = od.convert_office_file(path, display_name="稟議書.docx")
    markdown = document.markdown

    assert markdown.startswith("# 稟議書.docx\nSensitivity label: 社外秘ラベル\n")
    assert "[header] 社外秘" in markdown
    assert "## 社内稟議" in markdown and "## 概要" in markdown
    assert (
        "本文の[inserted: 追記][deleted: 削除]です[footnote 1][comment 0]" in markdown
    )
    assert "1. 一つ目" in markdown and "2. 二つ目" in markdown
    assert "  2.1 その下" in markdown
    # 番号の設定はスタイルの元（basedOn）から引き継ぐ
    assert "- 箇条書き" in markdown
    assert "| 項目 | 金額 |" in markdown
    assert "| 横に結合 |  |" in markdown
    assert "| 縦に結合 | A\\|B |" in markdown
    assert "| (merged) | 2行目 |" in markdown
    assert "[image: image1.png]" in markdown
    assert "[footnote 1] 金額は税抜" in markdown
    assert "[comment 0] (佐藤) 根拠を添付" in markdown
    assert [image.name for image in document.images] == ["image1.png"]


# ---------------------------------------------------------------------------
# PowerPoint
# ---------------------------------------------------------------------------


def presentation_parts():
    def shape(shape_id, text, y=None, x=0, placeholder=None):
        position = f'<a:xfrm><a:off x="{x}" y="{y}"/></a:xfrm>' if y is not None else ""
        ph = f'<p:ph type="{placeholder}"/>' if placeholder else ""
        return (
            f'<p:sp><p:nvSpPr><p:cNvPr id="{shape_id}" name="s{shape_id}"/><p:cNvSpPr/><p:nvPr>{ph}</p:nvPr></p:nvSpPr>'
            f"<p:spPr>{position}</p:spPr><p:txBody><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp>"
        )

    table = (
        '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
        '<p:xfrm><a:off x="0" y="2000"/></p:xfrm><a:graphic><a:graphicData><a:tbl>'
        "<a:tr><a:tc><a:txBody><a:p><a:r><a:t>項目</a:t></a:r></a:p></a:txBody></a:tc>"
        "<a:tc><a:txBody><a:p><a:r><a:t>値</a:t></a:r></a:p></a:txBody></a:tc></a:tr>"
        "<a:tr><a:tc><a:txBody><a:p><a:r><a:t>件数</a:t></a:r></a:p></a:txBody></a:tc>"
        "<a:tc><a:txBody><a:p><a:r><a:t>3</a:t></a:r></a:p></a:txBody></a:tc></a:tr>"
        "</a:tbl></a:graphicData></a:graphic></p:graphicFrame>"
    )
    picture = (
        '<p:pic><p:nvPicPr><p:cNvPr id="8" name="Picture" descr="構成図"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>'
        '<p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="4000"/></a:xfrm></p:spPr></p:pic>'
    )
    connector = (
        '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="6" name="Arrow"/><p:cNvCxnSpPr>'
        '<a:stCxn id="3" idx="0"/><a:endCxn id="4" idx="0"/></p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr><p:spPr/></p:cxnSp>'
    )
    first_slide = (
        f"<p:sld {SLIDE}><p:cSld><p:spTree>"
        + shape(5, "下の説明", y=3000)
        + shape(2, "構成", placeholder="title")
        + shape(3, "ブラウザ", y=1000)
        + shape(4, "Runtime", y=1000, x=5000)
        + connector
        + table
        + picture
        + "</p:spTree></p:cSld></p:sld>"
    )
    hidden_slide = (
        f'<p:sld {SLIDE} show="0"><p:cSld><p:spTree>'
        + shape(2, "おまけ", y=0)
        + '<p:pic><p:nvPicPr><p:cNvPr id="3" name="Big"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>'
        '<p:blipFill><a:blip r:embed="rId1"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="100"/></a:xfrm></p:spPr></p:pic>'
        + "</p:spTree></p:cSld></p:sld>"
    )
    notes = (
        f"<p:notes {SLIDE}><p:cSld><p:spTree>"
        + shape(2, "2", placeholder="sldNum")
        + shape(3, "ここで補足", y=0)
        + "</p:spTree></p:cSld></p:notes>"
    )
    return {
        "ppt/presentation.xml": (
            f'<p:presentation {SLIDE}><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/>'
            "</p:sldIdLst></p:presentation>"
        ),
        "ppt/_rels/presentation.xml.rels": relationships(
            ("rId2", "slide", "slides/slide1.xml"),
            ("rId3", "slide", "slides/slide2.xml"),
        ),
        # presentation.xml の一覧で slide2.xml が1枚目
        "ppt/slides/slide2.xml": first_slide,
        "ppt/slides/_rels/slide2.xml.rels": relationships(
            ("rId1", "notesSlide", "../notesSlides/notesSlide1.xml"),
            ("rId2", "image", "../media/image1.png"),
        ),
        "ppt/notesSlides/notesSlide1.xml": notes,
        "ppt/slides/slide1.xml": hidden_slide,
        "ppt/slides/_rels/slide1.xml.rels": relationships(
            ("rId1", "image", "../media/image2.png")
        ),
        "ppt/media/image1.png": png(),
        "ppt/media/image2.png": png(64, 48),
    }


def test_presentation_follows_slide_list_and_reading_order(tmp_path):
    path = write_package(tmp_path, "deck.pptx", presentation_parts())

    document = od.convert_office_file(path, display_name="説明資料.pptx")
    markdown = document.markdown

    assert markdown.index("## Slide 1: 構成") < markdown.index("## Slide 2 (hidden)")
    # XML の順（z 順）ではなく、スライド上の位置の順
    order = [
        markdown.index(text)
        for text in [
            "ブラウザ",
            "Runtime",
            "| 項目 | 値 |",
            "下の説明",
            "[image: image1.png] (構成図)",
        ]
    ]
    assert order == sorted(order)
    assert "[connection] ブラウザ -> Runtime" in markdown
    assert "[notes] ここで補足" in markdown
    assert "[notes] 2" not in markdown
    assert "おまけ" in markdown
    assert [image.name for image in document.images] == ["image1.png", "image2.png"]


def test_presentation_says_when_slides_are_left_out(tmp_path, monkeypatch):
    monkeypatch.setattr(limits, "MAX_SLIDES", 1)
    path = write_package(tmp_path, "deck.pptx", presentation_parts())

    markdown = od.convert_office_file(path).markdown

    assert "This deck has 2 slides. Only the first 1 are included below." in markdown
    assert "おまけ" not in markdown


def test_only_the_largest_images_are_attached_and_the_rest_are_named(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(limits, "MAX_IMAGES_PER_FILE", 1)
    path = write_package(tmp_path, "deck.pptx", presentation_parts())

    document = od.convert_office_file(path)

    assert [image.name for image in document.images] == ["image2.png"]
    assert (
        "Images not attached (only the 1 largest are): image1.png" in document.markdown
    )


# ---------------------------------------------------------------------------
# 読めないファイル
# ---------------------------------------------------------------------------


def test_protected_file_is_refused_with_a_reason(tmp_path):
    path = tmp_path / "secret.docx"
    path.write_bytes(bytes.fromhex("d0cf11e0a1b11ae1") + b"\0" * 64)

    with pytest.raises(od.ProtectedOfficeFileError, match="protected"):
        od.convert_office_file(str(path))


def test_file_that_is_not_an_office_package_is_refused(tmp_path):
    path = tmp_path / "broken.xlsx"
    path.write_bytes(b"not a zip file")

    with pytest.raises(od.OfficeFileError):
        od.convert_office_file(str(path))


def test_is_office_file():
    assert od.is_office_file("/tmp/doc_1a2b.DOCX")
    assert not od.is_office_file("/tmp/doc_1a2b.pdf")
