"""
Word・Excel・PowerPoint のファイルを、XML から Markdown に変換する。

Bedrock の Converse API は pptx を受け付けない（DocumentBlock の形式は pdf, csv,
doc, docx, xls, xlsx, html, txt, md）。docx と xlsx は受け付けるが、Bedrock が取り
出すのは文字だけで、数式・コメント・グラフの値・埋め込み画像・非表示のシートや
セル番地は落ちる。審査では「どのシートのどのセルの値か」「合計がどの式か」が
根拠になるので、Office ファイル（中身は ZIP に入った XML）を自分で読み、構造を
残した Markdown と、埋め込み画像を別に返す。

- Excel（excel.py）: シート名、セル番地つきの表（表示形式を当てた値）、数式、
  結合セル、非表示の行・列・シート、コメント、グラフの系列、図形の文字
- Word（word.py）: 見出し、段落、番号つきの箇条書き、表、脚注、コメント、
  変更履歴、ヘッダーとフッター、テキストボックス、画像の位置
- PowerPoint（powerpoint.py）: スライドの並び順、配置順の文字、表、図のつながり、
  グラフ、SmartArt の文字、ノート

上限（limits.py）を超えた分は省き、省いたことを Markdown に書く。黙って切ると、
モデルは見た分を全体だと思って答える。

依存は標準ライブラリだけ。画像の形式と大きさの確認にだけ Pillow（既存の依存）を使う。
"""

from .convert import OFFICE_FILE_EXTENSIONS, convert_office_file, is_office_file
from .model import (
    EmbeddedImage,
    OfficeDocument,
    OfficeFileError,
    ProtectedOfficeFileError,
)

__all__ = [
    "OFFICE_FILE_EXTENSIONS",
    "EmbeddedImage",
    "OfficeDocument",
    "OfficeFileError",
    "ProtectedOfficeFileError",
    "convert_office_file",
    "is_office_file",
]
