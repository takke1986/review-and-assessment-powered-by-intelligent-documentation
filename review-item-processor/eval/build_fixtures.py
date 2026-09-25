"""cases.py の書類から、評価に使うファイル（PDF・Word・Excel・PowerPoint）を作る。

ファイルはリポジトリに入れてあるので、ふだんは作り直さなくてよい。ケースを
足したり直したりしたときだけ流す。

    uv run --no-project --with playwright --with python-docx --with openpyxl \\
      --with python-pptx python eval/build_fixtures.py
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
            if how[0] == "pdf":
                page.set_content(how[1])
                page.pdf(path=str(FIXTURES / name), format="A4")
            else:
                _, build, kwargs = how
                build(str(FIXTURES / name), **kwargs)
    browser.close()
print("done")
