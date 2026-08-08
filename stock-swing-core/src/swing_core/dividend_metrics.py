from __future__ import annotations

import datetime as dt
import os
import time
from typing import Any

import pandas as pd
import requests

from .data import normalize_code
from .earnings_calendar import jquants_code

SUMMARY_URLS = [
    "https://api.jquants.com/v2/fins/summary",
]
SOURCE = "jquants_summary"

DEFAULT_SCORE_THRESHOLD = 20
DEFAULT_MAX_AGE_DAYS = 180
DEFAULT_MAX_CHECKS = 5
DEFAULT_REQUEST_SLEEP_SEC = 1.5


class DividendRateLimitError(RuntimeError):
    pass


def _enabled() -> bool:
    return os.environ.get("ENABLE_DIVIDEND_METRICS", "").strip().lower() in {"1", "true", "yes", "on"}


def _api_key() -> str:
    key = os.environ.get("JQUANTS_API_KEY", "").strip()
    if not key:
        raise RuntimeError("JQUANTS_API_KEY is missing. Dividend metrics cannot be fetched.")
    return key


def _f(value: Any, nd: int = 2) -> float | None:
    try:
        if value is None or pd.isna(value):
            return None
        return round(float(value), nd)
    except Exception:
        return None


def _num(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        if pd.isna(value):
            return None
        return float(value)
    s = str(value).strip()
    if not s or s in {"-", "－", "—", "--", "nan", "None", "null"}:
        return None
    s = s.replace(",", "").replace("％", "").replace("%", "")
    try:
        return float(s)
    except Exception:
        return None


def _date(value: Any) -> dt.date | None:
    ts = pd.to_datetime(value, errors="coerce")
    if pd.isna(ts):
        return None
    return ts.date()


def _today_jst() -> dt.date:
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date()


def _first_num(rec: dict[str, Any], keys: list[str]) -> tuple[float | None, str | None]:
    for k in keys:
        if k in rec:
            v = _num(rec.get(k))
            if v is not None:
                return v, k
    return None, None


def _first_date(rec: dict[str, Any], keys: list[str]) -> tuple[dt.date | None, str | None]:
    for k in keys:
        if k in rec:
            d = _date(rec.get(k))
            if d is not None:
                return d, k
    return None, None


def _records_from_payload(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if not isinstance(payload, dict):
        return []
    # J-Quants v2 /fins/summary は data 配列を返す想定。
    # 互換用に summary/statements/items/results も許容する。
    for key in ["data", "summary", "statements", "items", "results"]:
        v = payload.get(key)
        if isinstance(v, list):
            return [x for x in v if isinstance(x, dict)]
    return []


def fetch_statement_records(code: str) -> list[dict[str, Any]]:
    key = _api_key()
    headers = {
        "x-api-key": key,
        "Accept": "application/json",
        "User-Agent": "stock-swing-core/dividend-metrics",
    }
    ncode = normalize_code(code)
    # J-Quantsの普通株は基本5桁コード。旧実装では5桁/4桁の2回叩いていたが、
    # Free/低いプランではすぐ429になるため、原則5桁だけにする。
    candidate = jquants_code(ncode) or ncode

    errors: list[str] = []
    for url in SUMMARY_URLS:
        try:
            res = requests.get(url, headers=headers, params={"code": candidate}, timeout=45)
            if res.status_code == 200:
                records = _records_from_payload(res.json())
                if records:
                    return records
                errors.append(f"{url} code={candidate}: empty")
            elif res.status_code == 429:
                raise DividendRateLimitError(f"J-Quants rate limit exceeded for dividend summary: {res.text[:180]}")
            else:
                errors.append(f"{url} code={candidate}: status={res.status_code}, body={res.text[:180]}")
        except DividendRateLimitError:
            raise
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{url} code={candidate}: {exc}")
    print(f"WARN dividend summary fetch failed/empty for {ncode}: {' / '.join(errors[:3])}")
    return []


DIVIDEND_KEYS = [
    # J-Quants v2 /fins/summary assumed/official-style fields
    "ForecastDividendPerShareAnnual",
    "ForecastDividendPerShare",
    "ForecastDividendPerShareFiscalYearEnd",
    "NextYearForecastDividendPerShareAnnual",
    "ForecastDividendPerShareYearEnd",
    "ResultDividendPerShareAnnual",
    "DividendPerShareAnnual",
    "AnnualDividendPerShare",
    "ForecastAnnualDividendPerShare",
    "ForecastDividend",
    "ForecastDPS",
    "DPSForecast",
    "forecast_dividend_per_share_annual",
    "forecast_dividend_per_share",
    "forecast_dps",
]


EPS_KEYS = [
    "ForecastEarningsPerShare",
    "NextYearForecastEarningsPerShare",
    "ForecastEPS",
    "EarningsPerShare",
    "ForecastEPS",
    "EPSForecast",
    "ForecastBasicEarningsPerShare",
    "forecast_earnings_per_share",
    "forecast_eps",
    "eps_forecast",
]


DISCLOSURE_DATE_KEYS = [
    "DisclosedDate",
    "DisclosureDate",
    "Date",
    "LocalCodeDisclosureDate",
    "DisclosureDate",
    "disclosed_date",
    "disclosure_date",
]



def latest_dividend_metrics(code: str, close: float | None, max_age_days: int = DEFAULT_MAX_AGE_DAYS) -> dict[str, Any]:
    base: dict[str, Any] = {
        "dividend_enabled": True,
        "dividend_checked": True,
        "dividend_visible": False,
        "dividend_source": SOURCE,
        "dividend_hide_reason": "未取得",
    }
    if close is None or close <= 0:
        base["dividend_hide_reason"] = "株価が取得できない"
        return base

    records = fetch_statement_records(code)
    if not records:
        base["dividend_hide_reason"] = "J-Quants財務サマリーが取得できない"
        return base

    # 新しい開示日順に見る。予想配当が取れる最新レコードを採用する。
    decorated = []
    for rec in records:
        d, _ = _first_date(rec, DISCLOSURE_DATE_KEYS)
        decorated.append((d or dt.date.min, rec))
    decorated.sort(key=lambda x: x[0], reverse=True)

    selected: dict[str, Any] | None = None
    selected_date: dt.date | None = None
    dividend = None
    dividend_key = None
    eps = None
    eps_key = None

    for disclosure_date, rec in decorated:
        div, div_key = _first_num(rec, DIVIDEND_KEYS)
        if div is None:
            continue
        ep, ep_key = _first_num(rec, EPS_KEYS)
        selected = rec
        selected_date = None if disclosure_date == dt.date.min else disclosure_date
        dividend = div
        dividend_key = div_key
        eps = ep
        eps_key = ep_key
        break

    if selected is None or dividend is None:
        base["dividend_hide_reason"] = "今期予想配当が取得できない"
        return base

    today = _today_jst()
    age_days = (today - selected_date).days if selected_date is not None else None
    dividend_yield_pct = dividend / close * 100 if close else None
    payout_ratio_pct = dividend / eps * 100 if eps is not None and eps > 0 else None

    hide_reason = None
    visible = True
    if selected_date is None or age_days is None:
        visible = False
        hide_reason = "開示日が取得できない"
    elif age_days > max_age_days:
        visible = False
        hide_reason = f"開示日が古い（{age_days}日 > {max_age_days}日）"
    elif dividend < 0 or dividend_yield_pct is None or dividend_yield_pct < 0 or dividend_yield_pct > 20:
        visible = False
        hide_reason = "配当利回りが異常値"
    elif payout_ratio_pct is not None and (payout_ratio_pct < 0 or payout_ratio_pct > 200):
        visible = False
        hide_reason = "配当性向が異常値"

    if eps is None or eps <= 0:
        payout_formula = None
        payout_ratio_pct = None
    else:
        payout_formula = f"{_f(dividend, 4)} / {_f(eps, 4)} * 100"

    fiscal_year = selected.get("CurrentFiscalYearEndDate") or selected.get("FiscalYear") or selected.get("CurrentPeriodEndDate") or ""
    disclosure_date_str = selected_date.isoformat() if selected_date is not None else None

    base.update(
        {
            "dividend_visible": bool(visible),
            "dividend_source": SOURCE,
            "dividend_disclosure_date": disclosure_date_str,
            "dividend_data_age_days": age_days,
            "dividend_fiscal_year": fiscal_year,
            "dividend_forecast_per_share": _f(dividend, 4),
            "dividend_forecast_per_share_key": dividend_key,
            "dividend_forecast_eps": _f(eps, 4) if eps is not None else None,
            "dividend_forecast_eps_key": eps_key,
            "dividend_yield_pct": _f(dividend_yield_pct, 2),
            "dividend_payout_ratio_pct": _f(payout_ratio_pct, 2) if payout_ratio_pct is not None else None,
            "dividend_yield_formula": f"{_f(dividend, 4)} / {_f(close, 4)} * 100",
            "dividend_payout_formula": payout_formula,
            "dividend_hide_reason": hide_reason,
            "dividend_raw_keys": sorted(list(selected.keys()))[:80],
        }
    )
    return base


def enrich_results_with_dividends(results: list[dict[str, Any]]) -> int:
    """Fetch and attach dividend metrics to high-score results only.

    ENABLE_DIVIDEND_METRICS=true のときだけ動く。
    J-Quantsのレート制限を避けるため、score上位から最大DIVIDEND_MAX_CHECKS件だけ確認する。
    データが古い/欠損/異常値の場合はmetricsに理由を残し、一般画面では非表示にする。
    """
    if not _enabled():
        print("dividend metrics disabled. Set ENABLE_DIVIDEND_METRICS=true to enable.")
        return 0

    threshold = int(os.environ.get("DIVIDEND_SCORE_THRESHOLD", str(DEFAULT_SCORE_THRESHOLD)) or DEFAULT_SCORE_THRESHOLD)
    max_age_days = int(os.environ.get("DIVIDEND_MAX_AGE_DAYS", str(DEFAULT_MAX_AGE_DAYS)) or DEFAULT_MAX_AGE_DAYS)
    max_checks = int(os.environ.get("DIVIDEND_MAX_CHECKS", str(DEFAULT_MAX_CHECKS)) or DEFAULT_MAX_CHECKS)
    sleep_sec = float(os.environ.get("DIVIDEND_REQUEST_SLEEP_SEC", str(DEFAULT_REQUEST_SLEEP_SEC)) or DEFAULT_REQUEST_SLEEP_SEC)

    candidates = []
    for row in results:
        code = normalize_code(row.get("code"))
        score = row.get("score")
        if not code or not isinstance(score, int) or score < threshold:
            continue
        candidates.append(row)
    candidates.sort(key=lambda r: int(r.get("score") or 0), reverse=True)
    candidates = candidates[:max_checks]

    print(f"dividend metrics target: threshold={threshold}, max_checks={max_checks}, candidates={len(candidates)}, sleep={sleep_sec}s")

    count = 0
    checked = 0
    for row in candidates:
        code = normalize_code(row.get("code"))
        close = _num(row.get("close"))
        checked += 1
        try:
            metrics = latest_dividend_metrics(code, close, max_age_days=max_age_days)
            row.setdefault("metrics", {})
            row["metrics"].update(metrics)
            if metrics.get("dividend_visible"):
                count += 1
            print(f"dividend metrics {code}: visible={metrics.get('dividend_visible')} yield={metrics.get('dividend_yield_pct')} payout={metrics.get('dividend_payout_ratio_pct')} reason={metrics.get('dividend_hide_reason')}")
        except DividendRateLimitError as exc:
            row.setdefault("metrics", {})
            row["metrics"].update(
                {
                    "dividend_enabled": True,
                    "dividend_checked": True,
                    "dividend_visible": False,
                    "dividend_source": SOURCE,
                    "dividend_hide_reason": f"J-Quantsレート制限のため取得停止: {exc}",
                }
            )
            print(f"WARN dividend metrics rate limited at {code}. Stop remaining dividend checks: {exc}")
            break
        except Exception as exc:  # noqa: BLE001
            row.setdefault("metrics", {})
            row["metrics"].update(
                {
                    "dividend_enabled": True,
                    "dividend_checked": True,
                    "dividend_visible": False,
                    "dividend_source": SOURCE,
                    "dividend_hide_reason": f"取得エラー: {exc}",
                }
            )
            print(f"WARN dividend metrics failed for {code}: {exc}")
        time.sleep(sleep_sec)
    print(f"dividend metrics checked: {checked}, visible: {count}")
    return count
