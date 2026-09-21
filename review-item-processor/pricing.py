"""1回の審査にいくら掛かったかを数える。

## なぜ別に切り出したか

費用の計算が `inputTokens` と `outputTokens` しか見ていなかった。

このシステムは、同じ書類をチェック項目の数だけモデルに送る。プロンプト
キャッシュはそこによく効いていて、実際に有効になっている。ところが
Bedrock は**キャッシュした分を inputTokens に入れず、別の欄で返す**。

    1回目: inputTokens=14,  cacheWrite=3244, cacheRead=0
    2回目: inputTokens=18,  cacheWrite=0,    cacheRead=3244

つまり、書類を読んだ分の費用が**まるごと計上されていなかった**。画面に
出ていたのは、ほぼ出力トークンの額だけ。10項目の審査で $0.1743 と
表示されていたが、その内訳は出力がほぼすべてだった。

費用の画面は「どこにいくら掛かっているかを見て、やり方を変える」ために
作ったもの。実際より小さく、しかも書類の大きさでズレ方が変わる数字は、
判断の材料にならない。

## 単価

AWS の資料より、標準の入力トークンに対して
- キャッシュへの書き込み: 25% 高い（1.25倍）
- キャッシュからの読み出し: 90% 安い（0.1倍）

1時間保持の書き込みは2倍だが、ここでは使っていない（既定の5分）。
モデルごとに単価を上書きできるようにしてあるので、価格表が変わったら
registry 側で指定する。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional

# 標準の入力トークンに対する倍率
CACHE_WRITE_MULTIPLIER = 1.25
CACHE_READ_MULTIPLIER = 0.1


@dataclass(frozen=True)
class TokenCounts:
    """1回の呼び出しで使ったトークン。Bedrock が返す4種類"""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0

    @property
    def total_input(self) -> int:
        """モデルが読んだ入力の総量。キャッシュの分も含む。

        費用ではなく「どれだけ読ませたか」を見るための数字。
        inputTokens だけを見ると、キャッシュが効くほど小さく見えてしまう
        """
        return self.input_tokens + self.cache_read_tokens + self.cache_write_tokens


@dataclass(frozen=True)
class Cost:
    input_cost: float = 0.0
    output_cost: float = 0.0
    cache_read_cost: float = 0.0
    cache_write_cost: float = 0.0

    @property
    def total(self) -> float:
        return (
            self.input_cost
            + self.output_cost
            + self.cache_read_cost
            + self.cache_write_cost
        )


def counts_from_usage(usage: Optional[Mapping[str, Any]]) -> TokenCounts:
    """Bedrock（Strands 経由）の使用量から、4種類のトークンを取り出す。

    欄が無いモデルや、キャッシュが効かなかった呼び出しでは 0 になる。
    数でないものが入っていたら 0 として扱う。ここで落ちると、審査は
    終わっているのに費用の計算だけで結果を落とすことになる
    """
    if not usage:
        return TokenCounts()

    def number(key: str) -> int:
        value = usage.get(key, 0)
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            return 0

    return TokenCounts(
        input_tokens=number("inputTokens"),
        output_tokens=number("outputTokens"),
        cache_read_tokens=number("cacheReadInputTokens"),
        cache_write_tokens=number("cacheWriteInputTokens"),
    )


def cost_of(
    counts: TokenCounts,
    *,
    input_per_1k: float,
    output_per_1k: float,
    cache_write_per_1k: Optional[float] = None,
    cache_read_per_1k: Optional[float] = None,
) -> Cost:
    """トークン数から費用を出す。キャッシュの分も数える"""
    write_rate = (
        input_per_1k * CACHE_WRITE_MULTIPLIER
        if cache_write_per_1k is None
        else cache_write_per_1k
    )
    read_rate = (
        input_per_1k * CACHE_READ_MULTIPLIER
        if cache_read_per_1k is None
        else cache_read_per_1k
    )
    return Cost(
        input_cost=counts.input_tokens / 1000 * input_per_1k,
        output_cost=counts.output_tokens / 1000 * output_per_1k,
        cache_write_cost=counts.cache_write_tokens / 1000 * write_rate,
        cache_read_cost=counts.cache_read_tokens / 1000 * read_rate,
    )


def saved_by_cache(counts: TokenCounts, *, input_per_1k: float) -> float:
    """キャッシュで浮いた額。

    キャッシュが無ければ、読み出した分も書き込んだ分も標準の入力単価で
    払っていた。その差額を出す。書き込みは標準より高いので、書き込んだ
    ばかりの回では負になりうる。丸めずにそのまま返し、見せ方は呼び出し側に
    任せる（審査1件のうちに読み出しで取り返すため）
    """
    would_have_paid = counts.total_input / 1000 * input_per_1k
    actually_paid = cost_of(
        counts, input_per_1k=input_per_1k, output_per_1k=0.0
    ).total
    return would_have_paid - actually_paid
