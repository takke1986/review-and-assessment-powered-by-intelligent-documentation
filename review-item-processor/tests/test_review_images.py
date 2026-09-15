#!/usr/bin/env python3
"""画像を Converse の上限と形式に収めるテスト"""

import io
import os
import random
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import review_images as ri


def noisy_image(size, mode="RGB"):
    """圧縮しにくい画像（縮めないと上限に収まらない）"""
    generator = random.Random(0)
    return Image.frombytes(
        mode,
        size,
        bytes(generator.getrandbits(8) for _ in range(size[0] * size[1] * len(mode))),
    )


def test_images_that_can_be_sent_are_used_as_they_are(tmp_path):
    path = tmp_path / "photo.png"
    Image.new("RGB", (10, 10)).save(path)

    assert ri.prepare_image_file(str(path), str(tmp_path / "out")) == str(path)


def test_large_images_are_shrunk_below_the_byte_limit(tmp_path, monkeypatch):
    monkeypatch.setattr(ri, "MAX_IMAGE_BYTES", 30_000)
    path = tmp_path / "photo.png"
    noisy_image((300, 200)).save(path)

    prepared = ri.prepare_image_file(str(path), str(tmp_path))

    assert prepared == str(tmp_path / "photo.jpg")
    assert os.path.getsize(prepared) <= 30_000
    with Image.open(prepared) as image:
        assert image.format == "JPEG"
        assert image.width / image.height == 1.5


def test_images_over_the_side_limit_are_shrunk(tmp_path, monkeypatch):
    monkeypatch.setattr(ri, "MAX_IMAGE_SIDE_PIXELS", 50)
    path = tmp_path / "wide.png"
    Image.new("RGB", (200, 100)).save(path)

    with Image.open(ri.prepare_image_file(str(path), str(tmp_path / ""))) as image:
        assert image.size == (50, 25)


def test_formats_converse_does_not_take_are_converted(tmp_path):
    path = tmp_path / "scan.bmp"
    Image.new("RGB", (10, 10)).save(path)

    prepared = ri.prepare_image_file(str(path), str(tmp_path))

    with Image.open(prepared) as image:
        assert image.format == "JPEG"


def test_transparent_images_stay_png():
    image_format, data = ri.encode_image(Image.new("RGBA", (10, 10)))

    assert image_format == "png"
    assert Image.open(io.BytesIO(data)).mode == "RGBA"


def test_files_that_are_not_images_are_left_alone(tmp_path):
    path = tmp_path / "a.pdf"
    path.write_bytes(b"%PDF-1.4")

    assert ri.prepare_image_file(str(path), str(tmp_path)) == str(path)
