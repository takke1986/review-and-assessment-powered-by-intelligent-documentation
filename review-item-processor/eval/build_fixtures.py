"""cases.py の書類から、評価に使うファイル（PDF・Word・Excel・PowerPoint）を作る。

ファイルはリポジトリに入れてあるので、ふだんは作り直さなくてよい。ケースを
足したり直したりしたときだけ流す。

    uv run --no-project --with playwright --with python-docx --with openpyxl \\
      --with python-pptx --with pypdfium2 --with pillow --with pypdf --with reportlab \\
      python eval/build_fixtures.py

既存のファイルは作り直さない（中身が同じでも作成日時が変わり、git に差分が
出るため）。作り直したいファイルは消してから流す。
"""

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

from cases import CASES  # noqa: E402

FIXTURES = HERE / "fixtures"
FIXTURES.mkdir(exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    for _, _, _, files, _, _ in CASES:
        for name, how in files.items():
            if (FIXTURES / name).exists():
                continue
            if how[0] == "scan":
                # 印刷した PDF を各ページ画像にして、文字の無い PDF に作り直す
                import io

                import pypdfium2
                from PIL import Image

                page.set_content(how[1], wait_until="networkidle")
                page.evaluate("document.fonts.ready")
                printed = page.pdf(format="A4")
                pdf = pypdfium2.PdfDocument(io.BytesIO(printed))
                images = [
                    pdf[i].render(scale=how[2]).to_pil().convert("RGB")
                    for i in range(len(pdf))
                ]
                images[0].save(
                    FIXTURES / name,
                    save_all=True,
                    append_images=images[1:],
                    resolution=72 * how[2],
                )
                pdf.close()
            elif how[0] == "annotate":
                # PDF にしてから、付箋の注釈（/Annots の /Text）を付ける
                import io

                from pypdf import PdfReader, PdfWriter
                from pypdf.annotations import Text

                page.set_content(how[1])
                writer = PdfWriter(clone_from=PdfReader(io.BytesIO(page.pdf(format="A4"))))
                writer.add_annotation(
                    page_number=0,
                    annotation=Text(text=how[2], rect=(420, 600, 440, 620), open=True),
                )
                writer.write(FIXTURES / name)
            elif how[0] == "raster":
                # 図（SVG）を画像にして、本文の中に埋め込む。寸法は画像の中にだけある
                import base64

                page.set_content(how[2])
                png = page.locator("svg").screenshot()
                html = how[1].replace(
                    "<!--DRAWING-->",
                    f"<img src='data:image/png;base64,{base64.b64encode(png).decode()}' width='640'>",
                )
                page.set_content(html)
                page.pdf(path=str(FIXTURES / name), format="A4")
            elif how[0] == "png":
                page.set_viewport_size({"width": 900, "height": 1100})
                page.set_content(how[1])
                page.screenshot(path=str(FIXTURES / name), full_page=True)
            elif how[0] == "pdf":
                page.set_content(how[1])
                page.pdf(path=str(FIXTURES / name), format="A4")
            else:
                _, build, kwargs = how
                build(str(FIXTURES / name), **kwargs)
    browser.close()
print("done")
