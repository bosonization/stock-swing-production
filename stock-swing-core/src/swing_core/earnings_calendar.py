from __future__ import annotations

import datetime as dt
import os
from typing import Any

import pandas as pd
import requests

from .data import normalize_code

JQUANTS_EARNINGS_CALENDAR_URL = "https://api.jquants.com/v2/equities/earnings-calendar"
SOURCE = "jquants"

# 決算イベント判定の閾値。営業日ベース。
EARNINGS_EXCLUDE_BDAYS = 3
EARNINGS_CAUTION_BDAYS = 10
LOOKAHEAD_DAYS = 180


def normalize_jpx_code(raw: Any) -> tuple[str, str]:
    """Return local code and original JPX/J-Quants code.

    Examples:
      68060 -> (6806, 68060)
      212A0 -> (212A, 212A0)
      212A  -> (212A, 212A)
    """
    code5 = str(raw or "").strip().upper()
    if len(code5) == 5 and code5.endswith("0"):
        return normalize_code(code5[:4]), code5
    return normalize_code(code5), code5


def jquants_code(code: str) -> str:
    c = normalize_code(code)
    return f"{c}0" if len(c) == 4 else c


def _api_key() -> str:
    key = os.environ.get("JQUANTS_API_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "JQUANTS_API_KEY is missing. "
            "Set it in GitHub Secrets and pass it to the workflow env."
        )
    if any(ord(ch) > 127 for ch in key):
        raise RuntimeError("JQUANTS_API_KEY contains non-ASCII characters. Please re-copy the API key from J-Quants dashboard.")
    return key


def fetch_jquants_earnings_calendar() -> list[dict[str, Any]]:
    """Fetch JPX/J-Quants earnings calendar rows.

    V2 API uses API key authentication with the x-api-key header.
    The function raises clear errors instead of silently returning [] so that
    GitHub Actions logs show the root cause.
    """
    key = _api_key()
    headers = {
        "x-api-key": key,
        "Accept": "application/json",
        "User-Agent": "stock-swing-core/earnings-calendar-sync",
    }
    response = requests.get(JQUANTS_EARNINGS_CALENDAR_URL, headers=headers, timeout=45)
    if response.status_code != 200:
        text = response.text[:500]
        raise RuntimeError(f"J-Quants earnings-calendar API failed: status={response.status_code}, body={text}")
    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError(f"J-Quants earnings-calendar API returned non-dict payload: {type(payload)}")
    if "data" not in payload:
        raise RuntimeError(f"J-Quants earnings-calendar API response has no data key: keys={list(payload.keys())}")
    data = payload.get("data")
    if data is None:
        return []
    if not isinstance(data, list):
        raise RuntimeError(f"J-Quants earnings-calendar API data is not list: {type(data)}")
    return data


def _parse_date(value: Any) -> dt.date | None:
    ts = pd.to_datetime(value, errors="coerce")
    if pd.isna(ts):
        return None
    return ts.date()


def _today_jst() -> dt.date:
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date()


def _bdays_to(target: dt.date, today: dt.date | None = None) -> int | None:
    today = today or _today_jst()
    if target < today:
        return None
    if target == today:
        return 0
    return int(len(pd.bdate_range(today + pd.Timedelta(days=1), target)))


def _event_tag(target: dt.date, today: dt.date | None = None) -> tuple[str, int | None]:
    bdays = _bdays_to(target, today=today)
    if bdays is None:
        return "決算予定未取得", None
    if bdays <= EARNINGS_EXCLUDE_BDAYS:
        return "決算前除外", bdays
    if bdays <= EARNINGS_CAUTION_BDAYS:
        return "決算直前注意", bdays
    return "TRADE READY", bdays


def records_to_rows(records: list[dict[str, Any]], fetched_at: str | None = None) -> list[dict[str, Any]]:
    fetched_at = fetched_at or dt.datetime.now(dt.timezone.utc).isoformat()
    rows: list[dict[str, Any]] = []
    for rec in records:
        code, code5 = normalize_jpx_code(rec.get("Code"))
        target = _parse_date(rec.get("Date"))
        if not code or target is None:
            continue
        rows.append(
            {
                "source": SOURCE,
                "code": code,
                "code5": code5,
                "company_name": rec.get("CoName") or rec.get("CompanyName") or "",
                "announcement_date": target.isoformat(),
                "fiscal_year_end": rec.get("FY") or "",
                "fiscal_quarter": rec.get("FQ") or "",
                "section": rec.get("Section") or "",
                "sector_name": rec.get("SectorNm") or "",
                "raw": rec,
                "fetched_at": fetched_at,
                "updated_at": fetched_at,
            }
        )
    return rows


def _chunks(rows: list[Any], size: int = 500):
    for i in range(0, len(rows), size):
        yield rows[i : i + size]


def upsert_earnings_calendar(client, records: list[dict[str, Any]]) -> int:
    rows = records_to_rows(records)
    print(f"earnings calendar normalized rows: {len(rows)}")
    if not rows:
        return 0

    dates = sorted({r["announcement_date"] for r in rows})
    for d in dates:
        client.table("earnings_calendar").delete().eq("source", SOURCE).eq("announcement_date", d).execute()

    inserted = 0
    for batch in _chunks(rows):
        client.table("earnings_calendar").upsert(
            batch,
            on_conflict="source,code,announcement_date,fiscal_quarter",
        ).execute()
        inserted += len(batch)
    return inserted


def sync_earnings_calendar(client) -> int:
    records = fetch_jquants_earnings_calendar()
    print(f"J-Quants earnings-calendar fetched rows: {len(records)}")
    return upsert_earnings_calendar(client, records)


def next_earnings_map_from_db(client, codes: list[str], today: dt.date | None = None) -> dict[str, dict[str, Any]]:
    normalized = sorted({normalize_code(c) for c in codes if normalize_code(c)})
    if not normalized:
        return {}

    today = today or _today_jst()
    end = today + dt.timedelta(days=LOOKAHEAD_DAYS)
    out: dict[str, dict[str, Any]] = {}

    try:
        for batch_codes in _chunks(normalized, 100):
            res = (
                client.table("earnings_calendar")
                .select("*")
                .eq("source", SOURCE)
                .in_("code", batch_codes)
                .gte("announcement_date", today.isoformat())
                .lte("announcement_date", end.isoformat())
                .order("announcement_date")
                .execute()
            )
            for rec in list(res.data or []):
                code = normalize_code(rec.get("code"))
                if not code or code in out:
                    continue
                target = _parse_date(rec.get("announcement_date"))
                if target is None:
                    continue
                tag, bdays = _event_tag(target, today=today)
                out[code] = {
                    "next_earnings_date": target.isoformat(),
                    "business_days_to_next_earnings": bdays,
                    "earnings_tag": tag,
                    "earnings_company_name": rec.get("company_name") or "",
                    "earnings_quarter": rec.get("fiscal_quarter") or "",
                    "earnings_source": rec.get("source") or SOURCE,
                    "earnings_code5": rec.get("code5") or "",
                    "earnings_fetched_at": rec.get("fetched_at"),
                }
    except Exception as exc:  # noqa: BLE001
        print(f"WARN earnings_calendar db lookup failed: {exc}")
        return {}

    print(f"earnings map matched watchlist codes: {len(out)} / {len(normalized)}")
    return out
