from __future__ import annotations

import os
from datetime import date
from typing import Any

import pandas as pd
import requests

from .data import normalize_code

URL = "https://api.jquants.com/v2/equities/earnings-calendar"


def jquants_code(code: str) -> str:
    c = normalize_code(code)
    return f"{c}0" if len(c) == 4 else c


def fetch_earnings_calendar() -> list[dict[str, Any]]:
    key = os.environ.get("JQUANTS_API_KEY", "").strip()
    if not key:
        return []
    r = requests.get(URL, headers={"x-api-key": key}, timeout=30)
    r.raise_for_status()
    payload = r.json()
    return list(payload.get("data", [])) if isinstance(payload, dict) else []


def next_earnings_map(codes: list[str]) -> dict[str, dict[str, Any]]:
    records = fetch_earnings_calendar()
    wanted = {jquants_code(c): normalize_code(c) for c in codes}
    out: dict[str, dict[str, Any]] = {}
    today = pd.Timestamp.today().date()
    for rec in records:
        code5 = str(rec.get("Code", "")).strip()
        local = wanted.get(code5)
        if not local:
            continue
        d = pd.to_datetime(rec.get("Date"), errors="coerce")
        if pd.isna(d):
            continue
        target = d.date()
        bdays = None
        if target >= today:
            bdays = int(len(pd.bdate_range(today + pd.Timedelta(days=1), target)))
        tag = "TRADE READY"
        if bdays is None:
            tag = "決算予定未取得"
        elif bdays <= 3:
            tag = "決算前除外"
        elif bdays <= 10:
            tag = "決算直前注意"
        out[local] = {
            "next_earnings_date": target.isoformat(),
            "business_days_to_next_earnings": bdays,
            "earnings_tag": tag,
            "earnings_company_name": rec.get("CoName", ""),
            "earnings_quarter": rec.get("FQ", ""),
        }
    return out
