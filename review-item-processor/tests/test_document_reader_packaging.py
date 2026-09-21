"""読み取り Lambda に積み忘れたファイルが無いかを検査する。

一度これで落ちた。document_reader_lambda が document_library から定数を
読むようにしたのに、Dockerfile への追記を忘れ、Lambda が起動できず
審査が必ず失敗した。画面にはいつまでも「処理中」と出るだけで、
気づくまでに時間がかかった。

同梱するファイルは Dockerfile の COPY に並べてあるだけなので、
import を足しても誰も教えてくれない。ここで突き合わせる。
"""

from __future__ import annotations

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCKERFILE = ROOT / "Dockerfile.document-reader"
ENTRY = "document_reader_lambda"


def _copied_modules() -> set[str]:
    """Dockerfile が積んでいる自作モジュールの名前"""
    text = DOCKERFILE.read_text()
    copied = set(re.findall(r"([a-z_][a-z0-9_]*)\.py", text))
    if "office_documents" in text:
        copied.add("office_documents")
    return copied


def _required_modules() -> set[str]:
    """入口から辿って必要になる自作モジュールの名前"""
    local = {p.stem for p in ROOT.glob("*.py")} | {"office_documents"}
    required: set[str] = set()
    seen: set[str] = set()
    stack = [ENTRY]
    while stack:
        name = stack.pop()
        if name in seen:
            continue
        seen.add(name)
        source = ROOT / f"{name}.py"
        if not source.exists():
            continue
        for found in re.findall(
            r"^\s*(?:from|import)\s+([a-z_][a-z0-9_]*)", source.read_text(), re.M
        ):
            if found in local:
                required.add(found)
                stack.append(found)
    return required


def test_dockerfile_copies_everything_the_entry_needs():
    missing = sorted(_required_modules() - _copied_modules())
    assert not missing, (
        "読み取り Lambda が import するのに Dockerfile.document-reader で "
        f"積んでいないものがある: {missing}"
    )


def test_agent_only_modules_stay_out():
    """strands を読み込むものは積まない。積むと Lambda が起動できない"""
    copied = _copied_modules()
    for name in sorted(copied):
        source = ROOT / f"{name}.py"
        if not source.exists():
            continue
        assert "from strands" not in source.read_text(), (
            f"{name}.py は strands を読み込むので、読み取り Lambda には積めない"
        )
