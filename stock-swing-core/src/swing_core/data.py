from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Any

import pandas as pd


@dataclass(frozen=True)
class WatchItem:
    code: str
    name: str = ""


def normalize_code(raw: object) -> str:
    if raw is None or pd.isna(raw):
        raise ValueError("empty code")
    s = str(raw).strip().upper()
    if s.endswith(".T"):
        s = s[:-2]
    if re.match(r"^\d+\.0$", s):
        s = s[:-2]
    s = s.replace(" ", "").replace("-", "")

    m_alpha = re.match(r"^(?P<num>\d{3,4})(?P<suffix>[A-Z])$", s)
    if m_alpha:
        num = m_alpha.group("num")
        suffix = m_alpha.group("suffix")
        if len(num) == 4 and num.startswith("0"):
            num = num[1:]
        if len(num) != 3:
            raise ValueError(f"invalid alphanumeric Japanese ticker code: {raw!r}")
        return f"{num}{suffix}"

    if re.match(r"^\d{4}$", s):
        return s
    if re.match(r"^\d{3}$", s):
        return s.zfill(4)
    raise ValueError(f"invalid Japanese ticker code: {raw!r}")


def to_yfinance_symbol(code: str) -> str:
    return f"{normalize_code(code)}.T"


def _flatten_yfinance_columns(df: pd.DataFrame) -> pd.DataFrame:
    if isinstance(df.columns, pd.MultiIndex):
        if {"Open", "High", "Low", "Close", "Volume"}.intersection(set(df.columns.get_level_values(0))):
            df.columns = df.columns.get_level_values(0)
        else:
            df.columns = df.columns.get_level_values(-1)
    return df


def fetch_daily_prices(code: str, period: str = "3y", interval: str = "1d", retries: int = 2) -> pd.DataFrame:
    try:
        import yfinance as yf
    except ImportError as exc:
        raise RuntimeError("yfinance is not installed") from exc

    symbol = to_yfinance_symbol(code)
    periods: list[str] = []
    for p in [period, "3y", "2y", "1y", "6mo", "3mo", "1mo"]:
        if p not in periods:
            periods.append(p)

    last_error: Exception | None = None
    for p in periods:
        for attempt in range(1, retries + 1):
            try:
                df = yf.download(symbol, period=p, interval=interval, auto_adjust=True, progress=False, threads=False)
                df = _flatten_yfinance_columns(df)
                if df is None or df.empty:
                    raise ValueError(f"no data returned for {symbol} period={p}")
                df = df.copy()
                df.index = pd.to_datetime(df.index)
                df = df.sort_index()
                for col in ["Open", "High", "Low", "Close", "Volume"]:
                    if col not in df.columns:
                        raise ValueError(f"missing column {col} for {symbol}")
                    df[col] = pd.to_numeric(df[col], errors="coerce")
                df = df[["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
                if df.empty:
                    raise ValueError(f"empty close data for {symbol}")
                df.attrs["yf_symbol"] = symbol
                df.attrs["yf_period_used"] = p
                return df
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                if attempt < retries:
                    time.sleep(attempt)
    raise RuntimeError(f"failed to fetch {symbol}: {last_error}") from last_error
