"""評価で、手元のファイルを S3 のように見せる。

評価は検証環境と同じ入口（agent.process_review）を通す。その入口は S3 から
書類を落とし、前読みをジョブごとのキーで読む。以前の評価は手前の関数を直接
呼んでいたので、入口がジョブ ID を渡し忘れて前読みが一度も使われていない
不具合を拾えなかった。
"""

import io
import shutil
import threading


class LocalS3:
    """download_file と get_object だけを持つ、S3 の代わり"""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._files: dict[str, str] = {}
        self._objects: dict[str, bytes] = {}

    def put_file(self, key: str, path: str) -> None:
        with self._lock:
            self._files[key] = path

    def put_object_text(self, key: str, text: str) -> None:
        with self._lock:
            self._objects[key] = text.encode("utf-8")

    def download_file(self, bucket: str, key: str, path: str) -> None:
        with self._lock:
            source = self._files[key]
        shutil.copyfile(source, path)

    def get_object(self, Bucket: str, Key: str) -> dict:  # noqa: N803 - boto3 と同じ名前
        with self._lock:
            if Key not in self._objects:
                raise KeyError(f"NoSuchKey: {Key}")
            body = self._objects[Key]
        return {"Body": io.BytesIO(body)}
