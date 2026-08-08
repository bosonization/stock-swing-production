from __future__ import annotations

import time
from abc import ABC, abstractmethod
from typing import Any

import pandas as pd

from .data import _flatten_yfinance_columns, to_yfinance_symbol


class PriceDataProvider(ABC):
    @abstractmethod
    def fetch_daily_prices(self, code: str, period: str = "3y", interval: str = "1d", retries: int = 2) -> pd.DataFrame:
        raise NotImplementedError


class YFinanceProvider(PriceDataProvider):
    def fetch_daily_prices(self, code: str, period: str = "3y", interval: str = "1d", retries: int = 2) -> pd.DataFrame:
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
                    df.attrs["provider"] = "yfinance"
                    df.attrs["yf_symbol"] = symbol
                    df.attrs["yf_period_used"] = p
                    return df
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    if attempt < retries:
                        time.sleep(attempt)
        raise RuntimeError(f"failed to fetch {symbol}: {last_error}") from last_error


class JQuantsProvider(PriceDataProvider):
    def fetch_daily_prices(self, code: str, period: str = "3y", interval: str = "1d", retries: int = 2) -> pd.DataFrame:
        raise NotImplementedError("J-Quants price provider is reserved for paid/beta migration. Set PRICE_DATA_PROVIDER=yfinance for current PoC.")
