"""
変換の上限。

画像の上限は Converse API のもの。それ以外は Bedrock の上限ではなく、費用と
処理時間の目安。変換では limits.MAX_... として読むので、テストで差し替えられる。
"""

MAX_SLIDES = 300
MAX_SHEET_ROWS = 2000
MAX_SHEET_COLUMNS = 200
MAX_WORKBOOK_CELLS = 100_000
MAX_FORMULAS_PER_SHEET = 2000
MAX_IMAGES_PER_FILE = 20
# Converse の文書は1つ 4.5MB まで。日本語は UTF-8 で1文字3バイトなので、文字数で余裕を見る
MAX_MARKDOWN_CHARS = 1_200_000
# ZIP の中の1部品を読む上限（展開後）。壊れたファイルや ZIP 爆弾でメモリを使い切らない
MAX_PART_BYTES = 100_000_000

# Converse に画像として渡せる上限
MAX_IMAGE_BYTES = 3_750_000
MAX_IMAGE_SIDE_PIXELS = 8000
