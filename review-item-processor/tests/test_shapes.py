#!/usr/bin/env python3
"""図形の形・位置・つながりを XML から読めているかのテスト。

モデルを呼ばずに取れるところなので、結果は毎回同じでなければならない。
"""

import os
import sys
from xml.etree import ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from office_documents.shapes import (  # noqa: E402
    connections_in,
    describe,
    shapes_in,
)

NS = (
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
)


def shape(shape_id, name, prst, text, x_cm, y_cm, w_cm=4, h_cm=2):
    emu = 360000
    return f"""
    <p:sp>
      <p:nvSpPr><p:cNvPr id="{shape_id}" name="{name}"/></p:nvSpPr>
      <p:spPr>
        <a:xfrm>
          <a:off x="{int(x_cm * emu)}" y="{int(y_cm * emu)}"/>
          <a:ext cx="{int(w_cm * emu)}" cy="{int(h_cm * emu)}"/>
        </a:xfrm>
        <a:prstGeom prst="{prst}"/>
      </p:spPr>
      <p:txBody><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:txBody>
    </p:sp>"""


def connector(from_id, to_id, text=""):
    body = (
        f"<p:txBody><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:txBody>"
        if text
        else ""
    )
    start = f'<a:stCxn id="{from_id}" idx="0"/>' if from_id else ""
    end = f'<a:endCxn id="{to_id}" idx="0"/>' if to_id else ""
    return f"""
    <p:cxnSp>
      <p:nvCxnSpPr>
        <p:cNvPr id="99" name="コネクタ"/>
        <p:cNvCxnSpPr>{start}{end}</p:cNvCxnSpPr>
      </p:nvCxnSpPr>
      <p:spPr><a:prstGeom prst="straightConnector1"/></p:spPr>
      {body}
    </p:cxnSp>"""


def tree(*parts):
    return ET.fromstring(f"<p:spTree {NS}>{''.join(parts)}</p:spTree>")


class TestShapes:
    def test_reads_the_kind_of_each_shape(self):
        found = shapes_in(
            tree(
                shape(2, "開始", "flowChartTerminator", "受付", 1, 1),
                shape(3, "判断", "flowChartDecision", "金額は10万円以上か", 1, 5),
            )
        )
        assert [s.kind for s in found] == ["開始終了", "判断"]

    def test_reads_the_text_inside_the_shape(self):
        found = shapes_in(tree(shape(2, "箱", "rect", "申込書の確認", 1, 1)))
        assert found[0].text == "申込書の確認"

    def test_reads_where_the_shape_sits_in_centimetres(self):
        found = shapes_in(tree(shape(2, "箱", "rect", "A", 2.5, 3.5, 6, 1.5)))
        assert (found[0].left, found[0].top) == (2.5, 3.5)
        assert (found[0].width, found[0].height) == (6.0, 1.5)

    # 上から、同じ高さなら左から。読む順に並んでいないと、人が突き合わせにくい
    def test_puts_the_shapes_in_reading_order(self):
        found = shapes_in(
            tree(
                shape(2, "下", "rect", "あと", 1, 10),
                shape(3, "上右", "rect", "みぎ", 5, 1),
                shape(4, "上左", "rect", "ひだり", 1, 1),
            )
        )
        assert [s.text for s in found] == ["ひだり", "みぎ", "あと"]

    def test_keeps_a_shape_that_has_no_position(self):
        without = """
        <p:sp>
          <p:nvSpPr><p:cNvPr id="2" name="箱"/></p:nvSpPr>
          <p:spPr><a:prstGeom prst="rect"/></p:spPr>
          <p:txBody><a:p><a:r><a:t>位置なし</a:t></a:r></a:p></p:txBody>
        </p:sp>"""
        found = shapes_in(tree(without))
        assert found[0].text == "位置なし"
        assert found[0].left is None

    def test_says_nothing_about_an_empty_slide(self):
        assert shapes_in(tree()) == []


class TestConnections:
    def test_reads_which_shape_leads_to_which(self):
        found = connections_in(tree(connector(2, 3)))
        assert (found[0].from_id, found[0].to_id) == ("2", "3")

    def test_keeps_the_words_written_on_the_arrow(self):
        found = connections_in(tree(connector(2, 3, "はい")))
        assert found[0].text == "はい"

    # 飾りの線を並べても、読む人が困るだけ
    def test_ignores_a_line_that_joins_nothing(self):
        assert connections_in(tree(connector(None, None))) == []

    def test_keeps_a_line_that_is_joined_at_one_end(self):
        assert len(connections_in(tree(connector(2, None)))) == 1


class TestDescribe:
    def test_writes_the_flow_so_it_can_be_followed(self):
        lines = describe(
            tree(
                shape(2, "開始", "flowChartTerminator", "受付", 1, 1),
                shape(3, "判断", "flowChartDecision", "10万円以上か", 1, 4),
                shape(4, "処理", "flowChartProcess", "部長承認", 1, 8),
                connector(2, 3),
                connector(3, 4, "はい"),
            )
        )
        text = "\n".join(lines)
        assert "[flow] 受付 → 10万円以上か" in text
        assert "[flow] 10万円以上か → 部長承認（はい）" in text

    def test_writes_where_each_shape_is(self):
        lines = describe(tree(shape(2, "箱", "rect", "間取り", 2.0, 3.0, 5, 4)))
        assert "[shape] 四角形「間取り」 左2.0cm 上3.0cm 幅5.0cm 高さ4.0cm" in lines

    # 「近い」「隣接」の判断はここでしない。基準を埋め込むと、審査の結果を
    # 左右するのに誰も見直せなくなる
    def test_does_not_decide_what_is_near_what(self):
        lines = describe(
            tree(
                shape(2, "箱", "rect", "浴室", 1, 1),
                shape(3, "箱", "rect", "洗面台", 1.2, 1),
            )
        )
        text = "\n".join(lines)
        assert "隣接" not in text and "近い" not in text

    def test_leaves_out_a_shape_with_neither_text_nor_a_known_kind(self):
        blank = """
        <p:sp>
          <p:nvSpPr><p:cNvPr id="2" name="装飾"/></p:nvSpPr>
          <p:spPr/>
          <p:txBody/>
        </p:sp>"""
        assert describe(tree(blank)) == []

    def test_says_nothing_when_there_are_no_shapes(self):
        assert describe(tree()) == []

    def test_uses_the_shape_name_when_a_preset_is_not_translated(self):
        lines = describe(tree(shape(2, "星", "star5", "重要", 1, 1)))
        assert "star5" in "\n".join(lines)


# --- Word と Excel の図形 ---
# import の付け忘れで、図形のある文書だけ落ちるところだった。
# 変換を通しで呼んで塞ぐ

WORD_NS = (
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"'
)


def test_word_says_the_shape_kind_and_size_around_a_text_box(tmp_path):
    from tests.test_office_documents import write_package
    from office_documents import convert_office_file

    drawing = f"""
    <w:p><w:r><w:drawing>
      <wps:wsp>
        <wps:spPr>
          <a:xfrm><a:off x="360000" y="720000"/><a:ext cx="1440000" cy="720000"/></a:xfrm>
          <a:prstGeom prst="flowChartDecision"/>
        </wps:spPr>
        <wps:txbx><w:txbxContent><w:p><w:r><w:t>承認する？</w:t></w:r></w:p></w:txbxContent></wps:txbx>
      </wps:wsp>
    </w:drawing></w:r></w:p>"""
    parts = {
        "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
        "_rels/.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        "word/document.xml": f"<w:document {WORD_NS}><w:body>{drawing}</w:body></w:document>",
        "word/_rels/document.xml.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    }
    path = write_package(tmp_path, "shape.docx", parts)
    markdown = convert_office_file(path, display_name="shape.docx").markdown

    assert "承認する？" in markdown
    assert "判断" in markdown
    assert "幅4.0cm 高さ2.0cm" in markdown


def test_excel_says_which_cells_a_shape_covers(tmp_path):
    from tests.test_office_documents import write_package
    from office_documents import convert_office_file

    xdr = (
        'xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" '
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
    )
    drawing = f"""<xdr:wsDr {xdr}>
      <xdr:twoCellAnchor>
        <xdr:from><xdr:col>1</xdr:col><xdr:row>2</xdr:row></xdr:from>
        <xdr:to><xdr:col>3</xdr:col><xdr:row>7</xdr:row></xdr:to>
        <xdr:sp>
          <xdr:spPr><a:prstGeom prst="flowChartProcess"/></xdr:spPr>
          <xdr:txBody><a:p><a:r><a:t>集計範囲</a:t></a:r></a:p></xdr:txBody>
        </xdr:sp>
      </xdr:twoCellAnchor>
    </xdr:wsDr>"""
    s_ns = 'xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    parts = {
        "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
        "_rels/.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        "xl/workbook.xml": f'<s:workbook {s_ns}><s:sheets><s:sheet name="Sheet1" sheetId="1" r:id="rId1"/></s:sheets></s:workbook>',
        "xl/_rels/workbook.xml.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        "xl/worksheets/sheet1.xml": f'<s:worksheet {s_ns}><s:sheetData/><s:drawing r:id="rId9"/></s:worksheet>',
        "xl/worksheets/_rels/sheet1.xml.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
        "xl/drawings/drawing1.xml": drawing,
    }
    path = write_package(tmp_path, "shape.xlsx", parts)
    markdown = convert_office_file(path, display_name="shape.xlsx").markdown

    assert "集計範囲" in markdown
    assert "処理" in markdown
    # 表計算では、cm より「どのセルを覆っているか」のほうが突き合わせられる
    assert "B3:D8" in markdown


# --- グループの中の図形 ---
# 図はたいていグループにまとめられているので、換算を忘れると必ず当たる


def group(x_cm, y_cm, *inner, scale=1.0):
    emu = 360000
    size = int(3600000 * scale)
    return f"""<p:grpSp>
      <p:nvGrpSpPr><p:cNvPr id="9" name="グループ"/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm>
        <a:off x="{int(x_cm * emu)}" y="{int(y_cm * emu)}"/>
        <a:ext cx="{size}" cy="{size}"/>
        <a:chOff x="0" y="0"/><a:chExt cx="3600000" cy="3600000"/>
      </a:xfrm></p:grpSpPr>
      {''.join(inner)}
    </p:grpSp>"""


class TestGroupedShapes:
    def test_reports_where_a_grouped_shape_really_is(self):
        found = shapes_in(tree(group(10, 10, shape(2, "箱", "rect", "中身", 1, 1))))
        assert (found[0].left, found[0].top) == (11.0, 11.0)

    def test_follows_a_group_inside_a_group(self):
        inner = group(2, 2, shape(2, "箱", "rect", "奥", 1, 1))
        found = shapes_in(tree(group(10, 10, inner)))
        assert (found[0].left, found[0].top) == (13.0, 13.0)

    # グループを縮めて貼ると、中の図形も縮む
    def test_scales_a_shape_when_the_group_was_resized(self):
        found = shapes_in(
            tree(group(0, 0, shape(2, "箱", "rect", "半分", 2, 2, 4, 2), scale=0.5))
        )
        assert (found[0].left, found[0].top) == (1.0, 1.0)
        assert (found[0].width, found[0].height) == (2.0, 1.0)

    def test_leaves_an_ungrouped_shape_alone(self):
        found = shapes_in(tree(shape(2, "箱", "rect", "そのまま", 3, 4)))
        assert (found[0].left, found[0].top) == (3.0, 4.0)
