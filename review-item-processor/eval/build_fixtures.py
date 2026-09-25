"""cases.json の HTML から、評価に使う PDF を作る。

PDF はリポジトリに入れてあるので、ふだんは作り直さなくてよい。ケースを
足したり直したりしたときだけ流す（Playwright が要る）。

    python3 eval/build_fixtures.py
"""

import json
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).parent

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    for case in json.loads((HERE / "cases.json").read_text()):
        page.set_content(case["html"])
        page.pdf(path=str(HERE / "fixtures" / case["file"]), format="A4")
    browser.close()
print("done")
