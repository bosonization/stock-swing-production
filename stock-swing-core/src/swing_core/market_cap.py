from __future__ import annotations

from typing import Any

import yfinance as yf

from .data import normalize_code


def yahoo_ticker(code: str) -> str:
    c = normalize_code(code)
    if c.endswith('.T') or c.startswith('^'):
        return c
    return f"{c}.T"


def fetch_market_cap_yen(code: str) -> float | None:
    """Fetch market capitalization in JPY from yfinance.

    yfinance can be temporarily unavailable or missing data for newly listed stocks.
    In those cases this function returns None and analysis continues.
    """
    ticker = yahoo_ticker(code)
    try:
        t = yf.Ticker(ticker)
        fast_info = getattr(t, 'fast_info', None)
        if fast_info is not None:
            try:
                cap = fast_info.get('market_cap')
            except Exception:  # noqa: BLE001
                cap = getattr(fast_info, 'market_cap', None)
            if cap:
                return float(cap)
        # fallback. This may be slower, so only use when fast_info has no market_cap.
        info: dict[str, Any] = getattr(t, 'info', {}) or {}
        cap = info.get('marketCap') or info.get('market_cap')
        if cap:
            return float(cap)
    except Exception as exc:  # noqa: BLE001
        print(f"WARN market cap fetch failed for {code} ({ticker}): {exc}")
    return None


def fetch_market_cap_map(codes: list[str]) -> dict[str, float]:
    out: dict[str, float] = {}
    for code in codes:
        ncode = normalize_code(code)
        if not ncode or ncode in out:
            continue
        cap = fetch_market_cap_yen(ncode)
        if cap is not None:
            out[ncode] = cap
    print(f"market cap fetched: {len(out)} / {len({normalize_code(c) for c in codes if normalize_code(c)})}")
    return out
