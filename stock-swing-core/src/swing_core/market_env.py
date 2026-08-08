from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
import yfinance as yf


MARKET_SYMBOLS: dict[str, dict[str, Any]] = {
    # 市場環境メーター本体。composite計算に使う。
    "nikkei": {
        "label": "日経平均",
        "ticker": "^N225",
        "tickers": ["^N225"],
        "weight": 0.45,
        "group": "spot",
    },
    "growth250": {
        "label": "グロース250参考",
        "ticker": "2516.T",
        "tickers": ["2516.T", "2042.T"],
        "weight": 0.55,
        "group": "spot",
    },

    # 先物指数。表示専用。weight=0のため市場環境メーターのcompositeには反映しない。
    # yfinance/Yahoo Financeで継続取得できるものを優先し、取れないものはfallback候補を順番に試す。
    "nikkei_future": {
        "label": "日経先物",
        "ticker": "NIY=F",
        "tickers": ["NIY=F", "NKD=F"],
        "weight": 0.0,
        "group": "futures_jp",
        "note": "NIY=Fを優先。取得不可時はNKD=Fを代替。",
    },
    "dow_future": {
        "label": "ダウ先物",
        "ticker": "YM=F",
        "tickers": ["YM=F"],
        "weight": 0.0,
        "group": "futures_us",
    },
    "sp500_future": {
        "label": "S&P500先物",
        "ticker": "ES=F",
        "tickers": ["ES=F"],
        "weight": 0.0,
        "group": "futures_us",
    },
    "nasdaq_future": {
        "label": "NASDAQ先物",
        "ticker": "NQ=F",
        "tickers": ["NQ=F"],
        "weight": 0.0,
        "group": "futures_us",
    },
}

MARKET_ENV_CODE = "__MARKET_ENV__"


def _f(value: Any, digits: int = 2) -> float | None:
    try:
        if value is None or pd.isna(value):
            return None
        return round(float(value), digits)
    except Exception:
        return None


def _rsi(close: pd.Series, n: int = 14) -> pd.Series:
    delta = close.diff()
    up = delta.clip(lower=0)
    down = -delta.clip(upper=0)
    rs = up.rolling(n, min_periods=n).mean() / down.rolling(n, min_periods=n).mean()
    return 100 - (100 / (1 + rs))


def _ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def _macd(close: pd.Series) -> tuple[pd.Series, pd.Series, pd.Series]:
    macd = _ema(close, 12) - _ema(close, 26)
    signal = _ema(macd, 9)
    return macd, signal, macd - signal


def _stochastic(df: pd.DataFrame, k_period: int = 14, d_period: int = 3, smooth: int = 3) -> tuple[pd.Series, pd.Series]:
    low_min = df["Low"].rolling(k_period, min_periods=k_period).min()
    high_max = df["High"].rolling(k_period, min_periods=k_period).max()
    denom = (high_max - low_min).replace(0, np.nan)
    fast_k = (df["Close"] - low_min) / denom * 100
    slow_k = fast_k.rolling(smooth, min_periods=smooth).mean()
    slow_d = slow_k.rolling(d_period, min_periods=d_period).mean()
    return slow_k, slow_d


def _cross_label(k: float | None, d: float | None, pk: float | None, pd_: float | None) -> str:
    if k is None or d is None or pk is None or pd_ is None:
        return "判定不可"
    if pk <= pd_ and k > d:
        return "%Kが%Dを上抜け"
    if pk >= pd_ and k < d:
        return "%Kが%Dを下抜け"
    if k > d:
        return "%Kが%Dより上"
    if k < d:
        return "%Kが%Dより下"
    return "%Kと%Dが同水準"


def _download_symbol(ticker: str) -> pd.DataFrame:
    df = yf.download(ticker, period="12mo", interval="1d", auto_adjust=False, progress=False, threads=False)
    if df is None or df.empty:
        return pd.DataFrame()
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [c[0] for c in df.columns]
    needed = [c for c in ["Open", "High", "Low", "Close", "Volume"] if c in df.columns]
    return df[needed].copy().dropna(subset=["Close"])


def _download_first_available(tickers: list[str]) -> tuple[str | None, pd.DataFrame, list[str]]:
    errors: list[str] = []
    for ticker in tickers:
        try:
            df = _download_symbol(ticker)
            if df is not None and not df.empty and len(df) >= 35:
                return ticker, df, errors
            errors.append(f"{ticker}: data not found")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{ticker}: {exc}")
    return None, pd.DataFrame(), errors


def _index_tone(item: dict[str, Any]) -> tuple[str, float, list[str]]:
    points = 0.0
    reasons: list[str] = []
    if item.get("ma5_gt_ma25"):
        points += 1.0
        reasons.append("短期線が中期線より上")
    else:
        reasons.append("短期線が中期線以下")
    if item.get("close_gt_ma25"):
        points += 1.0
        reasons.append("終値が中期線より上")
    else:
        reasons.append("終値が中期線以下")
    if item.get("macd_gt_signal"):
        points += 1.0
        reasons.append("モメンタム良好")
    else:
        reasons.append("モメンタム弱め")
    if item.get("stoch_k_gt_d"):
        points += 1.0
        reasons.append("短期クロス良好")
    else:
        reasons.append("短期クロス弱め")

    cross = item.get("stoch_cross") or ""
    if "上抜け" in cross:
        points += 0.5
    elif "下抜け" in cross:
        points -= 0.5

    rsi = item.get("rsi14")
    if isinstance(rsi, (int, float)):
        if rsi >= 75:
            points -= 0.75
            reasons.append("過熱感あり")
        elif rsi <= 30:
            points += 0.25
            reasons.append("売られすぎ圏")
        elif 45 <= rsi <= 65:
            points += 0.5
            reasons.append("中立圏")

    if points >= 3.6:
        return "強気", points, reasons
    if points >= 2.8:
        return "やや強気", points, reasons
    if points >= 2.0:
        return "中立", points, reasons
    if points >= 1.1:
        return "やや慎重", points, reasons
    return "慎重", points, reasons


def analyze_market_symbol(key: str, spec: dict[str, Any]) -> dict[str, Any]:
    label = spec["label"]
    selected_ticker, df, errors = _download_first_available(list(spec.get("tickers") or [spec["ticker"]]))
    ticker_for_display = selected_ticker or spec["ticker"]
    if df.empty or len(df) < 35:
        return {
            "key": key,
            "label": label,
            "ticker": ticker_for_display,
            "weight": spec.get("weight", 0),
            "group": spec.get("group", "spot"),
            "status": "取得不可",
            "error": " / ".join(errors) or "price data not found",
        }

    close = pd.to_numeric(df["Close"], errors="coerce")
    high = pd.to_numeric(df.get("High", df["Close"]), errors="coerce")
    low = pd.to_numeric(df.get("Low", df["Close"]), errors="coerce")
    work = pd.DataFrame({"Close": close, "High": high, "Low": low}).dropna()
    work["ma5"] = work["Close"].rolling(5, min_periods=5).mean()
    work["ma25"] = work["Close"].rolling(25, min_periods=25).mean()
    work["rsi14"] = _rsi(work["Close"], 14)
    work["macd"], work["macd_signal"], work["macd_hist"] = _macd(work["Close"])
    work["slow_k"], work["slow_d"] = _stochastic(work)

    latest = work.iloc[-1]
    prev = work.iloc[-2]
    latest_date = work.index[-1]
    close_now = float(latest["Close"])
    close_prev = float(prev["Close"])
    diff = close_now - close_prev
    diff_pct = diff / close_prev * 100 if close_prev else None

    item: dict[str, Any] = {
        "key": key,
        "label": label,
        "ticker": ticker_for_display,
        "weight": spec.get("weight", 0),
        "group": spec.get("group", "spot"),
        "source_note": spec.get("note"),
        "date": latest_date.date().isoformat() if hasattr(latest_date, "date") else str(latest_date),
        "close": _f(close_now, 2),
        "prev_close": _f(close_prev, 2),
        "diff": _f(diff, 2),
        "diff_pct": _f(diff_pct, 2),
        "ma5": _f(latest.get("ma5"), 2),
        "ma25": _f(latest.get("ma25"), 2),
        "ma5_gt_ma25": bool(latest.get("ma5") > latest.get("ma25")) if pd.notna(latest.get("ma5")) and pd.notna(latest.get("ma25")) else False,
        "close_gt_ma25": bool(close_now > latest.get("ma25")) if pd.notna(latest.get("ma25")) else False,
        "rsi14": _f(latest.get("rsi14"), 2),
        "macd": _f(latest.get("macd"), 2),
        "macd_signal": _f(latest.get("macd_signal"), 2),
        "macd_hist": _f(latest.get("macd_hist"), 2),
        "macd_gt_signal": bool(latest.get("macd") > latest.get("macd_signal")) if pd.notna(latest.get("macd")) and pd.notna(latest.get("macd_signal")) else False,
        "slow_k": _f(latest.get("slow_k"), 2),
        "slow_d": _f(latest.get("slow_d"), 2),
        "stoch_k_gt_d": bool(latest.get("slow_k") > latest.get("slow_d")) if pd.notna(latest.get("slow_k")) and pd.notna(latest.get("slow_d")) else False,
        "stoch_cross": _cross_label(_f(latest.get("slow_k"), 4), _f(latest.get("slow_d"), 4), _f(prev.get("slow_k"), 4), _f(prev.get("slow_d"), 4)),
    }
    tone, points, reasons = _index_tone(item)
    item["tone"] = tone
    item["points"] = _f(points, 2)
    item["reasons"] = reasons
    return item


def market_environment() -> dict[str, Any]:
    indices = [analyze_market_symbol(key, spec) for key, spec in MARKET_SYMBOLS.items()]
    # weight=0の先物表示はcomposite算定から除外する。
    valid = [x for x in indices if x.get("close") is not None and float(x.get("weight") or 0) > 0]
    weight_total = sum(float(x.get("weight") or 0) for x in valid) or 1.0
    composite = sum(float(x.get("points") or 0) * float(x.get("weight") or 0) for x in valid) / weight_total

    if composite >= 3.6:
        label, stars = "強気", "★★★★★"
        comment = "指数環境は良好です。候補を広げすぎず、注目候補を中心に確認します。"
    elif composite >= 2.8:
        label, stars = "やや強気", "★★★★☆"
        comment = "指数環境はやや良好です。個別銘柄のイベントと株価位置を確認します。"
    elif composite >= 2.0:
        label, stars = "中立", "★★★☆☆"
        comment = "指数環境は中立です。銘柄ごとの状態を選別して確認します。"
    elif composite >= 1.1:
        label, stars = "やや慎重", "★★☆☆☆"
        comment = "指数環境はやや弱めです。候補数を絞り、イベントリスクを確認します。"
    else:
        label, stars = "慎重", "★☆☆☆☆"
        comment = "指数環境は弱めです。無理に対象を広げず、確認候補を絞ります。"

    return {
        "label": label,
        "stars": stars,
        "comment": comment,
        "source": "yfinance",
        "note": "日経平均(^N225)、グロース250参考(2516.T)、日経先物(NIY=F/NKD=F)、米国先物(YM=F/ES=F/NQ=F)をyfinanceで取得。先物は表示専用で市場環境メーターの総合判定には反映しない。",
        "indices": indices,
        "composite": _f(composite, 2),
        "weights": {key: spec.get("weight") for key, spec in MARKET_SYMBOLS.items()},
    }


def market_environment_result(user_id: str, run_id: str) -> dict[str, Any]:
    env = market_environment()
    return {
        "run_id": run_id,
        "user_id": user_id,
        "code": MARKET_ENV_CODE,
        "name": "市況環境",
        "close": None,
        "score": None,
        "condition_count": None,
        "failed_star_numbers": "",
        "pickup_flag": False,
        "tags": ["MARKET_ENV"],
        "tag_reasons": {},
        "metrics": {"market_environment": env},
        "kabutan_url": None,
    }
