"""cases.py の書類から、評価に使うファイル（PDF・Word・Excel・PowerPoint）を作る。

ファイルはリポジトリに入れてあるので、ふだんは作り直さなくてよい。ケースを
足したり直したりしたときだけ流す。

    uv run --no-project --with playwright --with python-docx --with openpyxl \\
      --with python-pptx --with pypdfium2 --with pillow python eval/build_fixtures.py

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

                page.set_content(how[1])
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
            elif how[0] == "pdf":
                page.set_content(how[1])
                page.pdf(path=str(FIXTURES / name), format="A4")
            else:
                _, build, kwargs = how
                build(str(FIXTURES / name), **kwargs)
    browser.close()
print("done")
