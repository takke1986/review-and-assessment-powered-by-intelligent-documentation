"""ログに文脈が付くかを見る。

審査は項目ごとに並行して走るので、ログだけ見ても「どの審査のどの項目か」が
分からないと CloudWatch で追えない。実際、注釈が読まれない不具合を追った
ときに切り分けで困った。
"""

import logging

import logger as log_module


def _capture(caplog):
    handler_logger = logging.getLogger("logger")
    handler_logger.addFilter(log_module._ContextFilter())
    return handler_logger


def test_the_context_is_added_to_every_line(caplog):
    caplog.set_level(logging.INFO)
    target = _capture(caplog)

    log_module.set_context(job="job-1", check="check-2")
    target.info("読み取りを始めた")

    assert "[job=job-1 check=check-2] 読み取りを始めた" in caplog.text
    log_module.clear_context()


def test_empty_values_are_left_out(caplog):
    """中身のない印だけが並ぶのを避ける"""
    caplog.set_level(logging.INFO)
    target = _capture(caplog)

    log_module.set_context(job="job-1", check=None, result="")
    target.info("検査")

    assert "[job=job-1] 検査" in caplog.text
    assert "check=" not in caplog.text
    log_module.clear_context()


def test_the_context_can_be_forgotten(caplog):
    """次の審査に前の項目の印が混ざらない"""
    caplog.set_level(logging.INFO)
    target = _capture(caplog)

    log_module.set_context(job="job-1")
    log_module.clear_context()
    target.info("次の審査")

    assert "job-1" not in caplog.text


def test_the_level_comes_from_the_environment(monkeypatch):
    """開発は DEBUG のまま、本番は INFO に絞れる。

    以前はここで DEBUG に固定しており、本番でも全部出ていた。
    """
    import importlib

    monkeypatch.setenv("LOG_LEVEL", "WARNING")
    reloaded = importlib.reload(log_module)

    assert reloaded.DEFAULT_LEVEL == "WARNING"

    monkeypatch.delenv("LOG_LEVEL")
    importlib.reload(log_module)
