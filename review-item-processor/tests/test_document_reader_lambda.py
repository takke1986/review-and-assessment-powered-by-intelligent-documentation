#!/usr/bin/env python3
"""読み取り Lambda の3つの役（plan / read / store）のテスト。

S3 と Bedrock は差し替える。ここで確かめたいのは、
- 読む必要のない書類に費用をかけないこと
- 途中の結果を状態に載せず S3 に置くこと（256KB で審査ごと落ちるため）
- まとめたときにページがずれないこと
"""

import json
import os
import sys

import pytest
from pypdf import PdfWriter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import document_reader_lambda as reader  # noqa: E402

SAMPLE_PDF = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "office_planning.pdf"
)


class FakeS3:
    """置いたもの・消したものを覚えるだけの S3"""

    def __init__(self, files=None):
        self.objects = dict(files or {})
        self.deleted = []

    def download_file(self, bucket, key, path):
        with open(path, "wb") as handle:
            handle.write(self.objects[key])

    def put_object(self, Bucket, Key, Body, ContentType=None):
        self.objects[Key] = Body

    def get_object(self, Bucket, Key):
        import io

        return {"Body": io.BytesIO(self.objects[Key])}

    def delete_object(self, Bucket, Key):
        self.deleted.append(Key)
        self.objects.pop(Key, None)


class FakeBedrock:
    def __init__(self, reply):
        self.reply = reply
        self.calls = 0

    def converse(self, **kwargs):
        self.calls += 1
        return {
            "output": {"message": {"content": [{"text": self.reply}]}},
            "usage": {"inputTokens": 10, "outputTokens": 5},
        }


def scanned_pdf_bytes(pages=3):
    """文字の取り出せない PDF。スキャンした書類はこう見える"""
    import io

    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=200)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


@pytest.fixture
def wired(monkeypatch):
    def use(files=None, reply="{}"):
        fake_s3 = FakeS3(files)
        fake_bedrock = FakeBedrock(reply)
        monkeypatch.setattr(reader, "s3", lambda: fake_s3)
        monkeypatch.setattr(reader, "bedrock", lambda: fake_bedrock)
        monkeypatch.setattr(reader.digest_store, "_client", lambda: fake_s3)
        return fake_s3, fake_bedrock

    return use


class TestPlan:
    # 普段の審査に費用も時間も足さない
    def test_leaves_a_small_readable_pdf_alone(self, wired):
        with open(SAMPLE_PDF, "rb") as handle:
            wired({"docs/a.pdf": handle.read()})
        result = reader.plan(
            {
                "action": "plan",
                "bucket": "b",
                "documents": [{"key": "docs/a.pdf", "filename": "a.pdf"}],
            }
        )
        assert result["tasks"] == []
        assert result["anyToRead"] is False

    def test_splits_a_scanned_pdf_into_runs(self, wired):
        wired({"docs/scan.pdf": scanned_pdf_bytes(pages=45)})
        result = reader.plan(
            {
                "bucket": "b",
                "documents": [{"key": "docs/scan.pdf", "filename": "scan.pdf"}],
            }
        )
        assert [(t["first"], t["last"]) for t in result["tasks"]] == [
            (1, 20),
            (21, 40),
            (41, 45),
        ]
        assert result["documents"][0]["pageCount"] == 45

    def test_ignores_a_file_it_cannot_read_ahead(self, wired):
        wired({"docs/a.txt": b"plain text"})
        result = reader.plan(
            {"bucket": "b", "documents": [{"key": "docs/a.txt", "filename": "a.txt"}]}
        )
        assert result["tasks"] == []


class TestRead:
    def test_puts_the_result_in_s3_and_returns_only_where(self, wired):
        reply = '{"pages": [{"page": 1, "text": "申込者 山田", "figures": []}]}'
        fake_s3, fake_bedrock = wired({"docs/scan.pdf": scanned_pdf_bytes(1)}, reply)

        result = reader.read(
            {
                "bucket": "b",
                "task": {
                    "kind": "pages",
                    "key": "docs/scan.pdf",
                    "name": "scan.pdf",
                    "first": 1,
                    "last": 1,
                },
            }
        )

        # 状態に載るのは置き場所だけ。中身を載せると 256KB を超える
        assert set(result) == {"key", "partial"}
        assert result["partial"].startswith("digest/partials/")
        stored = json.loads(fake_s3.objects[result["partial"]].decode("utf-8"))
        assert stored["pages"][0]["text"] == "申込者 山田"
        assert fake_bedrock.calls == 1

    def test_does_not_call_the_model_when_no_page_could_be_drawn(self, wired):
        _, fake_bedrock = wired({"docs/scan.pdf": scanned_pdf_bytes(1)})
        reader.read(
            {
                "bucket": "b",
                "task": {
                    "kind": "pages",
                    "key": "docs/scan.pdf",
                    "name": "scan.pdf",
                    "first": 9,
                    "last": 9,
                },
            }
        )
        assert fake_bedrock.calls == 0


class TestStore:
    def test_puts_the_runs_back_together_in_page_order(self, wired):
        partials = {
            "p/second.json": json.dumps(
                {"pages": [{"page": 3, "text": "three"}]}
            ).encode(),
            "p/first.json": json.dumps(
                {"pages": [{"page": 1, "text": "one"}]}
            ).encode(),
        }
        fake_s3, _ = wired(partials)

        reader.store(
            {
                "bucket": "b",
                "documents": [{"key": "docs/scan.pdf", "pageCount": 3}],
                "partials": [
                    {"key": "docs/scan.pdf", "partial": "p/second.json"},
                    {"key": "docs/scan.pdf", "partial": "p/first.json"},
                ],
            }
        )

        saved = json.loads(
            fake_s3.objects["digest/docs/scan.pdf.json"].decode("utf-8")
        )
        assert [p["text"] for p in saved["pages"]] == ["one", "", "three"]

    def test_clears_the_partials_away(self, wired):
        fake_s3, _ = wired(
            {"p/a.json": json.dumps({"pages": [{"page": 1, "text": "x"}]}).encode()}
        )
        reader.store(
            {
                "bucket": "b",
                "documents": [{"key": "docs/a.pdf", "pageCount": 1}],
                "partials": [{"key": "docs/a.pdf", "partial": "p/a.json"}],
            }
        )
        assert fake_s3.deleted == ["p/a.json"]

    # 1つ読めなくても、読めた分はまとめる
    def test_keeps_going_when_one_run_cannot_be_read_back(self, wired):
        fake_s3, _ = wired(
            {"p/ok.json": json.dumps({"pages": [{"page": 2, "text": "two"}]}).encode()}
        )
        reader.store(
            {
                "bucket": "b",
                "documents": [{"key": "docs/a.pdf", "pageCount": 2}],
                "partials": [
                    {"key": "docs/a.pdf", "partial": "p/missing.json"},
                    {"key": "docs/a.pdf", "partial": "p/ok.json"},
                ],
            }
        )
        saved = json.loads(fake_s3.objects["digest/docs/a.pdf.json"].decode("utf-8"))
        assert [p["text"] for p in saved["pages"]] == ["", "two"]

    def test_does_nothing_when_there_was_nothing_to_read(self, wired):
        fake_s3, _ = wired()
        assert reader.store({"bucket": "b", "documents": [], "partials": []}) == {
            "stored": 0
        }
        assert fake_s3.objects == {}


def test_handler_refuses_an_unknown_action():
    with pytest.raises(ValueError):
        reader.handler({"action": "dance"})


def png_bytes(color="red"):
    import io

    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (40, 30), color).save(buffer, "PNG")
    return buffer.getvalue()


class TestPictures:
    # 道具で読む経路では、画像ファイルはそのままでは読めない。そこに写真が
    # 混ざっていると、中身が一切見られないまま判定される
    def test_reads_a_picture_when_the_job_goes_through_the_tools(self, wired):
        wired(
            {
                "docs/scan.pdf": scanned_pdf_bytes(pages=30),
                "docs/photo.png": png_bytes(),
            }
        )
        result = reader.plan(
            {
                "bucket": "b",
                "documents": [
                    {"key": "docs/scan.pdf", "filename": "scan.pdf"},
                    {"key": "docs/photo.png", "filename": "photo.png"},
                ],
            }
        )
        kinds = [task["kind"] for task in result["tasks"]]
        assert "picture" in kinds
        assert [t["name"] for t in result["tasks"] if t["kind"] == "picture"] == [
            "photo.png"
        ]

    # ほかの書類が1回で渡せるなら、画像もそのままモデルに届く。読む必要がない
    def test_leaves_a_picture_alone_when_nothing_else_needs_reading(self, wired):
        with open(SAMPLE_PDF, "rb") as handle:
            wired({"docs/a.pdf": handle.read(), "docs/photo.png": png_bytes()})
        result = reader.plan(
            {
                "bucket": "b",
                "documents": [
                    {"key": "docs/a.pdf", "filename": "a.pdf"},
                    {"key": "docs/photo.png", "filename": "photo.png"},
                ],
            }
        )
        assert result["tasks"] == []

    def test_stores_what_the_picture_says(self, wired):
        reply = '{"text": "受付番号 A-123", "description": "申込書の写真"}'
        fake_s3, _ = wired({"docs/photo.png": png_bytes()}, reply)

        result = reader.read(
            {
                "bucket": "b",
                "task": {
                    "kind": "picture",
                    "key": "docs/photo.png",
                    "name": "photo.png",
                },
            }
        )
        stored = json.loads(fake_s3.objects[result["partial"]].decode("utf-8"))
        assert stored["images"][0]["text"] == "受付番号 A-123"
        assert stored["images"][0]["description"] == "申込書の写真"


class TestUsingAPictureWhileReviewing:
    def test_the_tools_can_read_a_picture_that_was_read_ahead(self, tmp_path):
        from document_digest import DocumentDigest, ImageDigest
        from document_library import DocumentLibrary
        from review_documents import ReviewFile

        path = tmp_path / "photo.png"
        path.write_bytes(png_bytes())
        library = DocumentLibrary(
            [ReviewFile(path=str(path), name="photo.png")],
            digests={
                str(path): DocumentDigest(
                    images=[
                        ImageDigest(
                            name="photo.png",
                            description="申込書の写真",
                            text="受付番号 A-123",
                        )
                    ]
                )
            },
        )

        text = library.picture_text("photo.png")
        assert "受付番号 A-123" in text
        assert "申込書の写真" in text
        # 画像の枠を使わずに読める
        assert library.images_returned == 0

    def test_says_a_picture_cannot_be_read_when_it_was_not_read_ahead(self, tmp_path):
        from document_library import DocumentLibrary, DocumentToolError
        from review_documents import ReviewFile

        path = tmp_path / "photo.png"
        path.write_bytes(png_bytes())
        library = DocumentLibrary([ReviewFile(path=str(path), name="photo.png")])

        entry = library.overview()["files"][0]
        assert "not read before the review" in entry["error"]
        with pytest.raises(DocumentToolError):
            library.picture_text("photo.png")


class TestWhenTheJobUsesTheTools:
    """道具経路に入るかは、書類1件ずつでは決まらない。
    合わないと「道具で読むのに画像を読んでいない」ジョブが生まれる"""

    def test_counts_the_pages_across_the_whole_job(self):
        # 40ページが3件。どれも単体では収まるのに、合計120ページで溢れる
        facts = [{"kind": "pdf", "pages": 40, "bytes": 1000} for _ in range(3)]
        assert reader.uses_tools(facts)

    def test_leaves_a_job_that_fits(self):
        facts = [{"kind": "pdf", "pages": 30, "bytes": 1000} for _ in range(3)]
        assert not reader.uses_tools(facts)

    def test_spots_a_pdf_that_is_too_large(self):
        assert reader.uses_tools([{"kind": "pdf", "pages": 1, "bytes": 5_000_000}])

    # 記入値や注釈のある PDF は、そのまま渡す経路に載せない決まり
    def test_spots_a_pdf_with_filled_in_fields(self):
        assert reader.uses_tools(
            [{"kind": "pdf", "pages": 1, "bytes": 1000, "hidden": True}]
        )

    def test_spots_a_job_with_more_documents_than_one_request_takes(self):
        facts = [{"kind": "office"} for _ in range(6)]
        assert reader.uses_tools(facts)


def test_reads_a_picture_when_the_job_overflows_on_total_pages(wired, monkeypatch):
    """40ページ×3件＋写真。PDF はどれも読み取り不要だが、ジョブは道具経路に
    入るので、写真を読んでおかないと中身が見られない"""
    pdf = scanned_pdf_bytes(pages=40)
    # 文字が取れる扱いにして、PDF 自体は読み取り不要にする
    monkeypatch.setattr(
        reader, "survey_pdf", lambda path: [_readable_page(n) for n in range(1, 41)]
    )
    wired(
        {
            "docs/a.pdf": pdf,
            "docs/b.pdf": pdf,
            "docs/c.pdf": pdf,
            "docs/photo.png": png_bytes(),
        }
    )

    result = reader.plan(
        {
            "bucket": "b",
            "documents": [
                {"key": "docs/a.pdf", "filename": "a.pdf"},
                {"key": "docs/b.pdf", "filename": "b.pdf"},
                {"key": "docs/c.pdf", "filename": "c.pdf"},
                {"key": "docs/photo.png", "filename": "photo.png"},
            ],
        }
    )

    kinds = [task["kind"] for task in result["tasks"]]
    assert kinds == ["picture"]


def _readable_page(number):
    from document_digest import PageSurvey

    return PageSurvey(page=number, characters=2000)
