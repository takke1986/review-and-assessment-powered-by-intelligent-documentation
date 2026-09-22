"""審査に上げた画像を、枚数を数えながらモデルに見せる。

Converse API には「1回の呼び出しで見せられる画像の枚数」に上限がある。
数えずに見せると上限に当たって項目ごと失敗するので、ここで数えて断る。
断っても審査は「見た範囲で」続き、何枚見たかは結果に残る。

agent.py から切り出した。agent.py は審査の流れ（どの経路で読ませ、
どう結果を整えるか）に絞り、個々の部品はそれぞれのモジュールに置く。
"""

import os
from typing import Any, Dict, List, Optional

from PIL import Image

from document_library import MAX_IMAGES_PER_REVIEW
from review_documents import ReviewFile
from review_images import encode_image


class PictureViewer:
    """審査に上げた画像を、枚数を数えながら見せる。

    外の image_reader は枚数を数えないので、素直に全部開いて Converse の
    上限に当たり、項目が失敗してジョブごと落ちていた。しかも上限は
    モデルに伝えていなかったので、節約する理由が無かった。

    ここで数えて断れば、審査は「見た範囲で」続く。何枚見たかと、断った
    かどうかは結果に残すので、人が確かめられる
    """

    def __init__(self, files: List[ReviewFile]):
        self._by_path = {file.path: file for file in files}
        self._by_name = {file.name: file for file in files}
        self.images_returned = 0
        self.refused = False

    def find(self, wanted: str) -> ReviewFile:
        # モデルには、縮小した写しの置き場所を伝えてある。元のファイルとは
        # 場所が違うので、置き場所・名前・ファイル名の順に当てる
        file = (
            self._by_path.get(wanted)
            or self._by_name.get(wanted)
            or self._by_name.get(os.path.basename(wanted))
        )
        if file is None:
            known = ", ".join(sorted(self._by_name))
            raise ValueError(f"No such picture: {wanted}. The pictures are: {known}")
        return file

    def take(self) -> None:
        if self.images_returned >= MAX_IMAGES_PER_REVIEW:
            self.refused = True
            raise ValueError(
                f"You have already looked at {MAX_IMAGES_PER_REVIEW} pictures, which "
                "is all you may see for this check item. Make your judgment from what "
                "you have seen and from what was read from the pictures before the "
                "review."
            )
        self.images_returned += 1


def create_picture_tools(viewer: PictureViewer) -> List[Any]:
    from strands import tool

    @tool
    def view_picture(file: str) -> dict:
        """
        Look at a picture that was uploaded for review.

        The number of pictures you may look at is limited, and looking at the same
        one again counts. Use what was already read from the pictures when that is
        enough.

        Args:
            file: The file name, as it was given to you.
        """
        found = viewer.find(file)
        viewer.take()
        with Image.open(found.path) as opened:
            image_format, data = encode_image(opened.convert("RGB"))
        return {
            "status": "success",
            "content": [
                {"text": f"{found.name}:"},
                {"image": {"format": image_format, "source": {"bytes": data}}},
            ],
        }

    return [view_picture]


def _pictures_already_read(files: List[ReviewFile], digests: Optional[Dict[str, Any]]) -> str:
    """先に読んである画像の中身を、指示に添える形にする。

    画像だけの審査では道具で書類を読む仕組みを使わないので、読み取った
    ものをここで渡さないと使われない
    """
    if not digests:
        return ""

    parts = []
    for file in files:
        digest = digests.get(file.path)
        if not digest:
            continue
        for note in (digest.image_descriptions or {}).values():
            parts.append(f"- {file.name}: {note}")
    if not parts:
        return ""

    listed = "\n".join(parts)
    return (
        "\n\n## WHAT WAS READ FROM THE PICTURES BEFORE THIS REVIEW\n"
        f"{listed}\n"
        f"You can see at most {MAX_IMAGES_PER_REVIEW} images in one review, and "
        "looking at the same picture again counts too. Use what is written above "
        "when it is enough, and open a picture with view_picture only when you "
        "have to see it yourself.\n"
    )
