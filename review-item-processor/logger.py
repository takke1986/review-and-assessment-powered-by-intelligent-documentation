"""ログの出し方をそろえる。

## なぜこの形か

審査は項目ごとに並行して走る。ログだけ見ても「どの審査のどの項目の話か」が
分からないと、CloudWatch で追えない。実際、注釈が読まれない不具合を追った
ときに、どのログがどの項目のものか分からず切り分けに時間がかかった。

そこで、**審査の入口で一度だけ文脈を覚えさせ、以降のすべてのログ行に
自動で添える**形にしている。呼ぶ側は今までどおり logger.info(...) と書けば
よく、94箇所ある呼び出しを書き換える必要がない。

## 水準

LOG_LEVEL で切り替える。開発中は DEBUG のまま、本番は INFO にできる。
以前はここで DEBUG に固定しており、本番でも全部出る状態だった。
"""

import contextvars
import logging
import os

# 審査の文脈。入口で覚えさせ、以降のログ行すべてに添える
_context: contextvars.ContextVar[dict] = contextvars.ContextVar(
    "log_context", default={}
)

DEFAULT_LEVEL = os.environ.get("LOG_LEVEL", "DEBUG").upper()


class _ContextFilter(logging.Filter):
    """覚えた文脈を、すべてのログ行の先頭に足す"""

    def filter(self, record: logging.LogRecord) -> bool:
        ctx = _context.get()
        if ctx:
            prefix = " ".join(f"{k}={v}" for k, v in ctx.items())
            record.msg = f"[{prefix}] {record.msg}"
        return True


_logger = logging.getLogger(__name__)
_logger.setLevel(DEFAULT_LEVEL)
_logger.addFilter(_ContextFilter())


def set_logger(logger_to_use) -> None:
    """外から渡された logger を使う（AgentCore の logger など）"""
    global _logger
    _logger = logger_to_use
    _logger.setLevel(DEFAULT_LEVEL)
    # 同じ filter を二重に付けない
    if not any(isinstance(f, _ContextFilter) for f in _logger.filters):
        _logger.addFilter(_ContextFilter())


def set_context(**values) -> None:
    """このあとのログ行に添える文脈を覚える。

    審査の入口で一度呼べばよい。空の値は入れない（[job= check=] のように
    中身のない印だけが並ぶのを避けるため）
    """
    _context.set({k: v for k, v in values.items() if v})


def clear_context() -> None:
    """文脈を忘れる。ひとつの呼び出しが終わったら呼ぶ"""
    _context.set({})


class LoggerProxy:
    def __getattr__(self, name):
        return getattr(_logger, name)


logger = LoggerProxy()
