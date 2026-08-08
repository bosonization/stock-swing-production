from __future__ import annotations

import numpy as np
import pandas as pd


def sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n, min_periods=n).mean()


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    delta = close.diff()
    up = delta.clip(lower=0)
    down = -delta.clip(upper=0)
    rs = up.rolling(n).mean() / down.rolling(n).mean()
    return 100 - (100 / (1 + rs))


def macd(close: pd.Series) -> tuple[pd.Series, pd.Series, pd.Series]:
    m = ema(close, 12) - ema(close, 26)
    sig = ema(m, 9)
    return m, sig, m - sig


def bollinger(close: pd.Series, n: int = 20) -> dict[str, pd.Series]:
    mid = sma(close, n)
    sd = close.rolling(n, min_periods=n).std()
    return {
        "bb_mid": mid,
        "bb_upper1": mid + sd,
        "bb_lower1": mid - sd,
        "bb_upper2": mid + 2 * sd,
        "bb_lower2": mid - 2 * sd,
        "bb_width": (4 * sd) / mid,
    }


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    high = df["High"]
    low = df["Low"]
    close = df["Close"]
    tr = pd.concat([(high - low), (high - close.shift()).abs(), (low - close.shift()).abs()], axis=1).max(axis=1)
    return tr.rolling(n, min_periods=n).mean()


def add_daily_indicators(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    c = out["Close"]
    for n in [5, 20, 25, 75, 200]:
        out[f"sma{n}"] = sma(c, n)
    out["rsi9"] = rsi(c, 9)
    out["rsi14"] = rsi(c, 14)
    out["macd"], out["macd_signal"], out["macd_hist"] = macd(c)
    out["atr14"] = atr(out, 14)
    for k, v in bollinger(c, 20).items():
        out[k] = v

    # Ichimoku approximate cloud using shifted spans; enough for screening MVP.
    tenkan = (out["High"].rolling(9).max() + out["Low"].rolling(9).min()) / 2
    kijun = (out["High"].rolling(26).max() + out["Low"].rolling(26).min()) / 2
    span_a_base = (tenkan + kijun) / 2
    span_b_base = (out["High"].rolling(52).max() + out["Low"].rolling(52).min()) / 2
    span_a = span_a_base.shift(26)
    span_b = span_b_base.shift(26)
    out["ichimoku_span_a"] = span_a
    out["ichimoku_span_b"] = span_b
    out["ichimoku_span_a_base"] = span_a_base
    out["ichimoku_span_b_base"] = span_b_base
    out["ichimoku_cloud_upper"] = pd.concat([span_a, span_b], axis=1).max(axis=1)
    out["ichimoku_cloud_lower"] = pd.concat([span_a, span_b], axis=1).min(axis=1)
    return out


def to_weekly(df: pd.DataFrame) -> pd.DataFrame:
    return df.resample("W-FRI").agg({"Open": "first", "High": "max", "Low": "min", "Close": "last", "Volume": "sum"}).dropna(subset=["Close"])


def add_weekly_indicators(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    c = out["Close"]
    for n in [13, 20, 26, 52]:
        out[f"sma{n}"] = sma(c, n)
    out["rsi14"] = rsi(c, 14)
    out["macd"], out["macd_signal"], out["macd_hist"] = macd(c)
    for k, v in bollinger(c, 20).items():
        out[k] = v
    tenkan = (out["High"].rolling(9).max() + out["Low"].rolling(9).min()) / 2
    kijun = (out["High"].rolling(26).max() + out["Low"].rolling(26).min()) / 2
    span_a = ((tenkan + kijun) / 2).shift(26)
    span_b = ((out["High"].rolling(52).max() + out["Low"].rolling(52).min()) / 2).shift(26)
    out["ichimoku_cloud_upper"] = pd.concat([span_a, span_b], axis=1).max(axis=1)
    out["ichimoku_cloud_lower"] = pd.concat([span_a, span_b], axis=1).min(axis=1)
    return out
