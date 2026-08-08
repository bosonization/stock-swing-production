from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd

from .data import WatchItem, fetch_daily_prices, normalize_code
from .indicators import add_daily_indicators, add_weekly_indicators, to_weekly

# スコア条件v2: ⑦は減点条件として復活。
SCORE_POINTS = {
    "c01": 1, "c02": 2, "c03": 1, "c04": 2, "c05": 2,
    "c06": 2, "c07": -2, "c08": 2, "c09": 2, "c10": 2,
    "c11": 2, "c12": 2, "c13": 2, "c14": 0, "c15": 2,
    "c16": 2, "c17": 3, "c18": 5, "c19": 3, "c20": 3,
    "c21": 5, "c22": 5, "c23": 5, "c24": 4, "c25": 4, "c26": 4,
}
HIGH_POINT_KEYS = {k for k, v in SCORE_POINTS.items() if v >= 4}
MAX_SCORE = sum(v for v in SCORE_POINTS.values() if v > 0)

# 管理者向け: 26条件をカテゴリ別に集計する。
SCORE_GROUPS = {
    "ma": {"label": "MA", "keys": ["c01", "c02", "c03", "c04", "c05", "c06", "c07", "c15", "c24", "c25"]},
    "bb": {"label": "BB", "keys": ["c08", "c16", "c17", "c18", "c23"]},
    "macd": {"label": "MACD", "keys": ["c09", "c10", "c19", "c20"]},
    "rsi": {"label": "RSI", "keys": ["c11", "c12", "c21", "c22"]},
    "cloud": {"label": "雲", "keys": ["c13", "c14", "c26"]},
}


def _f(v: Any, nd: int = 2):
    try:
        if v is None or pd.isna(v):
            return None
        return round(float(v), nd)
    except Exception:
        return None


def _pct(a: Any, b: Any, nd: int = 2):
    try:
        if b is None or pd.isna(b) or float(b) == 0:
            return None
        return round((float(a) / float(b) - 1) * 100, nd)
    except Exception:
        return None

def _score_conditions_for_asof(raw: pd.DataFrame, *, force_score: bool = False) -> dict[str, Any]:
    """Calculate the score at the latest date of raw.

    当日だけでなく、過去日付のスコア推移を出すための共通処理。
    rawは「その時点までの株価データ」に切って渡す。

    force_score=True の場合は、管理者向け機械的過去検証用として、
    出来高・ボラ・週足雲ゲートで通常は条件判定対象外になる日も、
    26条件そのもののスコアを計算する。
    """
    try:
        if raw is None or len(raw) < 80:
            return {
                "score": None,
                "condition_count": None,
                "score_eligible": False,
                "failed_star_numbers": "",
                "conditions": {},
                "reason": "スコア判定に必要なデータ不足",
            }
        d = add_daily_indicators(raw)
        w = add_weekly_indicators(to_weekly(raw))
        if len(d) < 2 or len(w) < 2:
            return {
                "score": None,
                "condition_count": None,
                "score_eligible": False,
                "failed_star_numbers": "",
                "conditions": {},
                "reason": "日足/週足の判定に必要なデータ不足",
            }
        dl, dp = d.iloc[-1], d.iloc[-2]
        wl, wp = w.iloc[-1], w.iloc[-2]
        close = float(dl["Close"])
        weekly_close = float(wl["Close"])
        vol_tag, _ = volatility_tag(d)
        liq_tag, _ = volume_tag(d)
        liquidity_ok = liq_tag in {"出来高OK", "出来高強い"}
        volatility_ok = vol_tag == "ボラOK"
        weekly_cloud_gate = _weekly_cloud_score_gate(wl)
        weekly_cloud_ok = bool(weekly_cloud_gate.get("ok"))
        score_eligible = bool(liquidity_ok and volatility_ok and weekly_cloud_ok)
        reasons = []
        if not liquidity_ok:
            reasons.append("出来高条件未達")
        if not volatility_ok:
            reasons.append("ボラ条件未達")
        if not weekly_cloud_ok:
            reasons.append("週足雲下")
        if not score_eligible and not force_score:
            return {
                "score": None,
                "condition_count": None,
                "score_eligible": False,
                "failed_star_numbers": "",
                "conditions": {},
                "reason": " / ".join(reasons),
                "weekly_cloud_gate": weekly_cloud_gate,
            }

        calc = _score_conditions_from_frames(d, w)
        conditions = calc["conditions"]
        score = calc["score"]
        condition_count = calc["condition_count"]
        failed_star_numbers = calc["failed_star_numbers"]
        return {
            "score": int(score),
            "condition_count": int(condition_count),
            "score_eligible": True if score_eligible else False,
            "score_forced": bool(force_score and not score_eligible),
            "failed_star_numbers": failed_star_numbers,
            "conditions": conditions,
            "score_groups": _score_group_scores(conditions),
            "reason": "判定対象" if score_eligible else "管理者向け機械的過去検証のため、条件判定対象外日もスコア計算",
            "excluded_gate_reasons": reasons,
            "weekly_cloud_gate": weekly_cloud_gate,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "score": None,
            "condition_count": None,
            "score_eligible": False,
            "failed_star_numbers": "",
            "conditions": {},
            "reason": f"スコア履歴計算エラー: {exc}",
        }


def score_history_5d(raw: pd.DataFrame, days: int = 5) -> list[dict[str, Any]]:
    """Return score transition for 4 business days ago through today.

    出力順は「4営業日前 → 3営業日前 → 2営業日前 → 1営業日前 → 当日」。
    株価データの営業日ベースで最後の5本を使う。
    """
    if raw is None or raw.empty:
        return []
    work = raw.dropna(subset=["Close"]).copy()
    if work.empty:
        return []
    positions = list(range(max(0, len(work) - days), len(work)))
    out: list[dict[str, Any]] = []
    for i, pos in enumerate(positions):
        offset = len(positions) - 1 - i
        asof_raw = work.iloc[: pos + 1].copy()
        calc = _score_conditions_for_asof(asof_raw)
        idx = work.index[pos]
        label = "当日" if offset == 0 else f"{offset}営業日前"
        out.append(
            {
                "date": _index_to_iso(idx),
                "label": label,
                "offset_business_days": int(offset),
                "close": _f(work["Close"].iloc[pos]),
                "score": calc.get("score"),
                "condition_count": calc.get("condition_count"),
                "score_eligible": calc.get("score_eligible"),
                "failed_star_numbers": calc.get("failed_star_numbers"),
                "reason": calc.get("reason"),
            }
        )
    return out


def _bb_position(close: float, latest: pd.Series) -> str:
    vals = [latest.get(k, np.nan) for k in ["bb_lower2", "bb_lower1", "bb_mid", "bb_upper1", "bb_upper2"]]
    try:
        l2, l1, mid, u1, u2 = map(float, vals)
    except Exception:
        return "判定不可"
    if close >= u2:
        return "+2σ以上"
    if close >= u1:
        return "+1σ〜+2σ"
    if close >= mid:
        return "中心線〜+1σ"
    if close >= l1:
        return "-1σ〜中心線"
    if close >= l2:
        return "-2σ〜-1σ"
    return "-2σ以下"



def _index_to_iso(idx: Any) -> str | None:
    try:
        if hasattr(idx, "date"):
            return idx.date().isoformat()
        return pd.to_datetime(idx).date().isoformat()
    except Exception:
        return None


def _md(value: Any) -> str:
    try:
        if not value:
            return ""
        dt = pd.to_datetime(value)
        return f"{dt.month}月{dt.day}日"
    except Exception:
        return str(value)


def _price_text(value: Any) -> str:
    try:
        if value is None or pd.isna(value):
            return ""
        fv = float(value)
        if abs(fv) >= 1000:
            return f"{fv:,.0f}"
        return f"{fv:,.1f}".rstrip("0").rstrip(".")
    except Exception:
        return str(value)


def _range_value_tag(label: str, kind: str, value: Any, date: Any) -> str:
    if value is None:
        return ""
    md = _md(date)
    pv = _price_text(value)
    if md:
        return f"{label}レンジ{kind}:{md} {pv}"
    return f"{label}レンジ{kind}:{pv}"


def _slope_sign(v: Any) -> int:
    try:
        if v is None or pd.isna(v):
            return 0
        fv = float(v)
        if fv > 0:
            return 1
        if fv < 0:
            return -1
        return 0
    except Exception:
        return 0


def _previous_nonzero_sign(values: pd.Series, pos: int, max_lookback: int = 5) -> int:
    """Return the latest non-zero slope sign before pos.

    MA傾きが 0 を挟んでから反転するケースを拾うため、直前数本の中で
    最後に出た非ゼロ符号を使う。
    """
    start = max(0, pos - max_lookback)
    for j in range(pos - 1, start - 1, -1):
        sign = _slope_sign(values.iloc[j])
        if sign != 0:
            return sign
    return 0



def _bb_2sigma_width_ratio(df: pd.DataFrame) -> pd.Series:
    """BB±2σ幅 / 終値。

    bb_width は (upper2-lower2)/MA で保持しているが、今回のBBブレイク仕様は
    「BB2σ幅が株価の10%以内」なので、終値を分母にして別計算する。
    """
    upper2 = pd.to_numeric(df.get("bb_upper2"), errors="coerce")
    lower2 = pd.to_numeric(df.get("bb_lower2"), errors="coerce")
    close = pd.to_numeric(df.get("Close"), errors="coerce")
    return (upper2 - lower2) / close




def _safe_bool(v: Any) -> bool:
    try:
        if v is None or pd.isna(v):
            return False
        return bool(v)
    except Exception:
        return False


def _safe_num(v: Any) -> float | None:
    try:
        if v is None or pd.isna(v):
            return None
        return float(v)
    except Exception:
        return None


def _bb_squeezed_for_days(df: pd.DataFrame, days: int = 5, threshold: float = 0.10) -> bool:
    width = _bb_2sigma_width_ratio(df).dropna()
    if len(width) < days:
        return False
    return bool((width.tail(days) <= threshold).all())


def _bb_width_current_pct(df: pd.DataFrame) -> float | None:
    width = _bb_2sigma_width_ratio(df)
    if len(width) == 0 or pd.isna(width.iloc[-1]):
        return None
    return float(width.iloc[-1]) * 100


def _bb_squeeze_expand_recent(df: pd.DataFrame, threshold: float = 0.10, expand_factor: float = 1.10, keep_bars: int = 3, lookback: int = 80) -> dict[str, Any]:
    """Detect BB squeeze -> expansion using BB±2σ width divided by close.

    判定: 直近のBB2σ幅<=thresholdの基準日から、その幅のexpand_factor倍以上に
    拡大した日があり、その拡大日がkeep_bars本以内なら達成。
    """
    out = {
        "ok": False,
        "signal_date": None,
        "days_since": None,
        "base_date": None,
        "base_width_pct": None,
        "signal_width_pct": None,
        "current_width_pct": _bb_width_current_pct(df),
        "reason": "BB収斂から拡大を確認できず",
    }
    width = _bb_2sigma_width_ratio(df).dropna().tail(lookback)
    if len(width) < 3:
        out["reason"] = "BB収斂拡大判定に必要なデータ不足"
        return out
    signals: list[dict[str, Any]] = []
    vals = list(width.items())
    for i, (idx, base_width) in enumerate(vals[:-1]):
        if pd.isna(base_width) or float(base_width) > threshold:
            continue
        target = float(base_width) * expand_factor
        for j in range(i + 1, len(vals)):
            sig_idx, sig_width = vals[j]
            if pd.isna(sig_width):
                continue
            if float(sig_width) >= target:
                signals.append({
                    "base_idx": idx,
                    "signal_idx": sig_idx,
                    "base_width": float(base_width),
                    "signal_width": float(sig_width),
                    "pos": j,
                })
                break
    if not signals:
        return out
    latest = signals[-1]
    days_since = len(vals) - 1 - int(latest["pos"])
    ok = days_since <= keep_bars - 1
    out.update({
        "ok": bool(ok),
        "signal_date": _index_to_iso(latest["signal_idx"]),
        "days_since": int(days_since),
        "base_date": _index_to_iso(latest["base_idx"]),
        "base_width_pct": _f(latest["base_width"] * 100, 2),
        "signal_width_pct": _f(latest["signal_width"] * 100, 2),
        "reason": f"BB2σ幅{latest['base_width']*100:.2f}%から{latest['signal_width']*100:.2f}%へ1割以上拡大。拡大日から{days_since + 1}本目。",
    })
    if not ok:
        out["reason"] += f" 条件は{keep_bars}本以内のため未達。"
    return out


def _macd_gc_within(df: pd.DataFrame, keep_bars: int = 3) -> dict[str, Any]:
    out = {"ok": False, "signal_date": None, "days_since": None, "reason": "MACD GC未確認"}
    if len(df) < 2:
        out["reason"] = "MACD GC判定に必要なデータ不足"
        return out
    macd = pd.to_numeric(df.get("macd"), errors="coerce")
    sig = pd.to_numeric(df.get("macd_signal"), errors="coerce")
    signals: list[int] = []
    for i in range(1, len(df)):
        if pd.isna(macd.iloc[i-1]) or pd.isna(sig.iloc[i-1]) or pd.isna(macd.iloc[i]) or pd.isna(sig.iloc[i]):
            continue
        if float(macd.iloc[i-1]) <= float(sig.iloc[i-1]) and float(macd.iloc[i]) > float(sig.iloc[i]):
            signals.append(i)
    if not signals:
        return out
    pos = signals[-1]
    days_since = len(df) - 1 - pos
    out.update({"ok": bool(days_since <= keep_bars - 1), "signal_date": _index_to_iso(df.index[pos]), "days_since": int(days_since), "reason": f"MACD GCから{days_since + 1}本目"})
    return out


def _rsi_low_continuation(df: pd.DataFrame, col: str, trigger_level: float = 10, keep_level: float = 20) -> dict[str, Any]:
    out = {"ok": False, "trigger_date": None, "days_since": None, "reason": "RSI低位反転継続未確認"}
    r = pd.to_numeric(df.get(col), errors="coerce")
    if len(r) < 2 or r.dropna().empty:
        out["reason"] = "RSI判定に必要なデータ不足"
        return out
    triggers: list[int] = []
    for i in range(1, len(r)):
        if pd.isna(r.iloc[i]) or pd.isna(r.iloc[i-1]):
            continue
        slope = float(r.iloc[i]) - float(r.iloc[i-1])
        if float(r.iloc[i]) <= trigger_level and slope >= 0:
            triggers.append(i)
    if not triggers:
        return out
    pos = triggers[-1]
    tail = r.iloc[pos:]
    ok = bool(tail.notna().all() and (tail <= keep_level).all())
    days_since = len(r) - 1 - pos
    out.update({"ok": ok, "trigger_date": _index_to_iso(df.index[pos]), "days_since": int(days_since), "reason": f"RSI<={trigger_level}かつ傾き0以上の発生日から{days_since + 1}本、RSI<={keep_level}継続" if ok else f"発生日後にRSI>{keep_level}が発生"})
    return out


def _ma_converged(values: list[float | None], tolerance: float) -> bool:
    nums = [v for v in values if v is not None and not pd.isna(v) and v > 0]
    if len(nums) != len(values):
        return False
    return bool(max(nums) / min(nums) - 1 <= tolerance)


def _has_num(v: Any) -> bool:
    return v is not None and not pd.isna(v) and float(v) > 0


def _weekly_ma_order_condition(wl: pd.Series) -> dict[str, Any]:
    """④ 週足MA上昇配列。

    52週MAが未算出の場合は対象外とし、13MA>26MAだけで判定する。
    """
    sma13 = _safe_num(wl.get("sma13"))
    sma26 = _safe_num(wl.get("sma26"))
    sma52 = _safe_num(wl.get("sma52"))
    if not (_has_num(sma13) and _has_num(sma26)):
        return {"ok": False, "rule": "13週MAまたは26週MAが未算出", "excluded": []}
    if _has_num(sma52):
        return {
            "ok": bool(sma13 > sma26 > sma52),
            "rule": "13週MA > 26週MA > 52週MA",
            "excluded": [],
        }
    return {
        "ok": bool(sma13 > sma26),
        "rule": "52週MA未算出のため、13週MA > 26週MAで判定",
        "excluded": ["52週MA"],
    }


def _weekly_ma_convergence_condition(values: list[float | None], slope: float | None, tolerance: float = 0.10) -> dict[str, Any]:
    """㉕ 週足MA収斂。

    52週MAが未算出の場合は対象外とし、13MA/26MAが10%以内、かつ13MAが最上位、13MA傾き正で判定する。
    """
    names = ["13週MA", "26週MA", "52週MA"]
    valid = [(name, v) for name, v in zip(names, values) if _has_num(v)]
    excluded = [name for name, v in zip(names, values) if not _has_num(v)]
    if len(valid) < 2:
        return {"ok": False, "gap_pct": None, "rule": "週足MAの算出数が不足", "excluded": excluded}
    valid_values = [float(v) for _, v in valid]
    gap_pct = (max(valid_values) / min(valid_values) - 1) * 100 if min(valid_values) > 0 else None
    ma13 = values[0]
    ma13_is_top = _has_num(ma13) and float(ma13) == max(valid_values)
    slope_ok = slope is not None and slope > 0
    converged = gap_pct is not None and gap_pct <= tolerance * 100
    return {
        "ok": bool(converged and ma13_is_top and slope_ok),
        "gap_pct": _f(gap_pct),
        "rule": " / ".join([name for name, _ in valid]) + f" が{tolerance*100:.0f}%以内、13週MAが最上位、13週MA傾き正",
        "excluded": excluded,
    }


def _score_group_scores(conditions: dict[str, bool]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for group_key, spec in SCORE_GROUPS.items():
        keys = list(spec["keys"])
        score = sum(SCORE_POINTS.get(k, 0) for k in keys if conditions.get(k))
        max_score = sum(max(SCORE_POINTS.get(k, 0), 0) for k in keys)
        achieved = [k for k in keys if conditions.get(k) and SCORE_POINTS.get(k, 0) > 0]
        out[group_key] = {
            "label": spec["label"],
            "score": int(score),
            "max": int(max_score),
            "achieved_count": len(achieved),
            "condition_count": len(keys),
            "achieved": achieved,
        }
    return out


def _weekly_cloud_score_gate(wl: pd.Series) -> dict[str, Any]:
    """Weekly Ichimoku cloud gate for score eligibility.

    週足の雲が計算できる場合のみ判定する。
    - 週足終値 < 週足雲下限: スコア算定対象外
    - 週足終値 >= 週足雲下限: スコア算定対象
    - 雲上限/下限が未計算: スコア算定対象
    """
    close = _safe_num(wl.get("Close"))
    upper = _safe_num(wl.get("ichimoku_cloud_upper"))
    lower = _safe_num(wl.get("ichimoku_cloud_lower"))
    if close is None:
        return {
            "ok": True,
            "calculable": False,
            "position": "判定不可",
            "reason": "週足終値が取得できないため、週足雲フィルタは適用しない",
            "weekly_cloud_upper": upper,
            "weekly_cloud_lower": lower,
        }
    if upper is None or lower is None:
        return {
            "ok": True,
            "calculable": False,
            "position": "雲未算出",
            "reason": "週足の雲が未算出のため、スコア算定対象とする",
            "weekly_cloud_upper": upper,
            "weekly_cloud_lower": lower,
        }
    if close < lower:
        return {
            "ok": False,
            "calculable": True,
            "position": "雲下",
            "reason": "週足終値が週足一目雲の下限を下回るため、スコア算定対象外",
            "weekly_cloud_upper": upper,
            "weekly_cloud_lower": lower,
        }
    if close > upper:
        position = "雲上"
    else:
        position = "雲内"
    return {
        "ok": True,
        "calculable": True,
        "position": position,
        "reason": "週足終値が週足一目雲の下限以上のため、スコア算定対象とする",
        "weekly_cloud_upper": upper,
        "weekly_cloud_lower": lower,
    }


def score_category_history_10d(raw: pd.DataFrame, days: int = 10) -> list[dict[str, Any]]:
    """Return 10-business-day category score history for admin review.

    MA / BB / MACD / RSI / 雲の5分類で、各日付時点のスコアを確認する。
    """
    if raw is None or raw.empty:
        return []
    work = raw.dropna(subset=["Close"]).copy()
    if work.empty:
        return []
    positions = list(range(max(0, len(work) - days), len(work)))
    out: list[dict[str, Any]] = []
    for i, pos in enumerate(positions):
        offset = len(positions) - 1 - i
        asof_raw = work.iloc[: pos + 1].copy()
        calc = _score_conditions_for_asof(asof_raw)
        groups = _score_group_scores(calc.get("conditions") or {}) if calc.get("score_eligible") else {}
        out.append(
            {
                "date": _index_to_iso(work.index[pos]),
                "label": "当日" if offset == 0 else f"{offset}営業日前",
                "offset_business_days": int(offset),
                "close": _f(work["Close"].iloc[pos]),
                "score": calc.get("score"),
                "score_eligible": calc.get("score_eligible"),
                "reason": calc.get("reason"),
                "groups": groups,
            }
        )
    return out



def _score_trade_simulations_50d(raw: pd.DataFrame, days: int = 50) -> list[dict[str, Any]]:
    """管理者向けの簡易過去検証。

    直近50営業日のスコアを使い、シグナル翌日の始値で仮想売買した場合の差額を返す。
    これは管理者検証用の機械的な過去整理であり、売買推奨ではない。
    """
    strategies = [
        {
            "id": "s01_score_gt24",
            "label": "① スコア24点以下→24点超え→24点以下",
            "rule": "スコアが24点以下から24点を超えた日の翌営業日始値で仮想購入、スコアが24点以下となった日の翌営業日始値で仮想売却",
        },
        {
            "id": "s02_score_up5_down5",
            "label": "② +5点→-5点",
            "rule": "スコアが前日より5点以上上昇した日の翌営業日始値で仮想購入、スコアが5点以上下降した日の翌営業日始値で仮想売却",
        },
        {
            "id": "s03_up5_and_gt24_down5",
            "label": "③ +5点かつ24点超え→-5点",
            "rule": "スコアが前日より5点以上上昇かつ24点超えとなった日の翌営業日始値で仮想購入、スコアが5点以上下降した日の翌営業日始値で仮想売却",
        },
    ]
    if raw is None or raw.empty:
        return [{**st, "trades": []} for st in strategies]
    work = raw.dropna(subset=["Close"]).copy()
    if "Open" not in work.columns or len(work) < 3:
        return [{**st, "trades": []} for st in strategies]

    # 直近50営業日の初日シグナルを評価できるよう、1本前も含めて計算する。
    trade_start_pos = max(0, len(work) - days)
    score_start_pos = max(0, trade_start_pos - 1)
    score_rows: list[dict[str, Any]] = []
    for pos in range(score_start_pos, len(work)):
        asof_raw = work.iloc[: pos + 1].copy()
        # 管理者向け機械的過去検証では、直近50営業日すべてについて
        # スコアを計算する前提にする。通常の条件判定対象外ゲート
        # （出来高・ボラ・週足雲）はこの検証では無視する。
        calc = _score_conditions_for_asof(asof_raw, force_score=True)
        open_v = _safe_num(work["Open"].iloc[pos])
        close_v = _safe_num(work["Close"].iloc[pos])
        score_v = calc.get("score")
        score_rows.append(
            {
                "pos": pos,
                "date": _index_to_iso(work.index[pos]),
                "open": _f(open_v),
                "close": _f(close_v),
                "score": int(score_v) if isinstance(score_v, (int, float)) and math.isfinite(float(score_v)) else None,
            }
        )

    def is_num(v: Any) -> bool:
        return isinstance(v, (int, float)) and math.isfinite(float(v))

    evaluated_rows = [r for r in score_rows if int(r.get("pos", -1)) >= trade_start_pos]
    score_complete = len(evaluated_rows) >= min(days, len(work) - trade_start_pos) and all(is_num(r.get("score")) for r in evaluated_rows)
    score_missing_dates = [r.get("date") for r in evaluated_rows if not is_num(r.get("score"))]

    score_values = [float(r.get("score")) for r in evaluated_rows if is_num(r.get("score"))]
    score_diffs: list[float] = []
    for i in range(1, len(score_rows)):
        prev_s = score_rows[i - 1].get("score")
        curr_s = score_rows[i].get("score")
        if int(score_rows[i].get("pos", -1)) < trade_start_pos:
            continue
        if is_num(prev_s) and is_num(curr_s):
            score_diffs.append(float(curr_s) - float(prev_s))

    common_diagnostics = {
        "score_calculated_days": int(sum(1 for r in evaluated_rows if is_num(r.get("score")))),
        "score_required_days": int(min(days, len(work) - trade_start_pos)),
        "score_complete": bool(score_complete),
        "score_missing_dates": score_missing_dates[:10],
        "score_min": int(min(score_values)) if score_values else None,
        "score_max": int(max(score_values)) if score_values else None,
        "max_score_diff_up": int(max(score_diffs)) if score_diffs else None,
        "max_score_diff_down": int(min(score_diffs)) if score_diffs else None,
    }

    def _signals(strategy_id: str, prev_num: float | None, curr_num: float) -> tuple[bool, bool]:
        diff = curr_num - prev_num if prev_num is not None else None
        if strategy_id == "s01_score_gt24":
            return (prev_num is not None and prev_num <= 24 and curr_num > 24, prev_num is not None and prev_num > 24 and curr_num <= 24)
        if strategy_id == "s02_score_up5_down5":
            return (diff is not None and diff >= 5, diff is not None and diff <= -5)
        return (diff is not None and diff >= 5 and curr_num > 24, diff is not None and diff <= -5)

    def simulate(strategy_id: str) -> dict[str, Any]:
        trades: list[dict[str, Any]] = []
        position: dict[str, Any] | None = None
        buy_signal_count = 0
        sell_signal_count = 0
        # iの日のスコアで判定し、i+1日の始値で仮想売買する。
        # 診断のシグナル数も、翌営業日の始値が存在して実行可能なものだけをカウントする。
        for i in range(1, len(score_rows) - 1):
            prev_s = score_rows[i - 1].get("score")
            curr_s = score_rows[i].get("score")
            next_row = score_rows[i + 1]
            if not is_num(curr_s) or not is_num(next_row.get("open")):
                continue
            prev_num = float(prev_s) if is_num(prev_s) else None
            curr_num = float(curr_s)
            buy_signal, sell_signal = _signals(strategy_id, prev_num, curr_num)

            trade_date_pos = int(next_row.get("pos", -1))
            in_trade_window = trade_date_pos >= trade_start_pos
            if in_trade_window and buy_signal:
                buy_signal_count += 1
            if in_trade_window and sell_signal:
                sell_signal_count += 1

            if position is None and buy_signal and in_trade_window:
                position = {
                    "buy_signal_date": score_rows[i].get("date"),
                    "buy_signal_score": int(curr_num),
                    "buy_date": next_row.get("date"),
                    "buy_price": _f(next_row.get("open")),
                }
                continue
            if position is not None and sell_signal and in_trade_window:
                sell_price = _f(next_row.get("open"))
                buy_price = position.get("buy_price")
                profit = _f(float(sell_price) - float(buy_price)) if is_num(sell_price) and is_num(buy_price) else None
                trades.append(
                    {
                        **position,
                        "sell_signal_date": score_rows[i].get("date"),
                        "sell_signal_score": int(curr_num),
                        "sell_date": next_row.get("date"),
                        "sell_price": sell_price,
                        "profit": profit,
                        "status": "closed",
                    }
                )
                position = None

        if position is not None:
            trades.append({**position, "sell_signal_date": None, "sell_signal_score": None, "sell_date": None, "sell_price": None, "profit": None, "status": "open"})
        return {"trades": trades, "buy_signal_count": int(buy_signal_count), "sell_signal_count": int(sell_signal_count)}

    out: list[dict[str, Any]] = []
    for st in strategies:
        simulated = simulate(st["id"])
        out.append(
            {
                **st,
                "trades": simulated["trades"],
                "buy_signal_count": simulated["buy_signal_count"],
                "sell_signal_count": simulated["sell_signal_count"],
                "score_basis": "score",
                "score_window_days": int(days),
                **common_diagnostics,
                "score_gate_ignored_for_admin_backtest": True,
                "score_gate_ignored_note": "管理者向け機械的過去検証では、出来高・ボラ・週足雲による条件判定対象外ゲートを無視して、直近50営業日のスコアを計算します。",
            }
        )
    return out

def _ichimoku_cloud_twist_within(df: pd.DataFrame, window: int = 5) -> dict[str, Any]:
    """Detect Ichimoku cloud twist within roughly ±window business days.

    過去側: shifted span_a/span_bの直近window本で符号反転。
    未来側: base span_a/span_bの「26-window〜26+window本前」が、現在±window日に投影されるため、その範囲で符号反転。
    """
    out = {"ok": False, "twist_date": None, "days_to_twist": None, "reason": "雲のねじれ未確認"}
    if len(df) < 60:
        out["reason"] = "一目雲ねじれ判定に必要なデータ不足"
        return out
    checks: list[dict[str, Any]] = []
    # shifted/current visible cloud: past to current
    if "ichimoku_span_a" in df.columns and "ichimoku_span_b" in df.columns:
        diff = pd.to_numeric(df["ichimoku_span_a"], errors="coerce") - pd.to_numeric(df["ichimoku_span_b"], errors="coerce")
        start = max(1, len(diff) - window - 1)
        for i in range(start, len(diff)):
            if i <= 0 or pd.isna(diff.iloc[i-1]) or pd.isna(diff.iloc[i]):
                continue
            if float(diff.iloc[i-1]) == 0 or float(diff.iloc[i]) == 0 or (float(diff.iloc[i-1]) < 0 < float(diff.iloc[i])) or (float(diff.iloc[i-1]) > 0 > float(diff.iloc[i])):
                checks.append({"idx": df.index[i], "offset": len(diff) - 1 - i, "reason": "直近表示雲でねじれ"})
    # projected cloud around latest +/- window
    if "ichimoku_span_a_base" in df.columns and "ichimoku_span_b_base" in df.columns:
        base_diff = pd.to_numeric(df["ichimoku_span_a_base"], errors="coerce") - pd.to_numeric(df["ichimoku_span_b_base"], errors="coerce")
        latest_pos = len(df) - 1
        start_base = max(1, latest_pos - 26 - window)
        end_base = min(len(df) - 1, latest_pos - 26 + window)
        for i in range(start_base, end_base + 1):
            if i <= 0 or pd.isna(base_diff.iloc[i-1]) or pd.isna(base_diff.iloc[i]):
                continue
            if float(base_diff.iloc[i-1]) == 0 or float(base_diff.iloc[i]) == 0 or (float(base_diff.iloc[i-1]) < 0 < float(base_diff.iloc[i])) or (float(base_diff.iloc[i-1]) > 0 > float(base_diff.iloc[i])):
                projected_offset = (i + 26) - latest_pos
                checks.append({"idx": df.index[min(latest_pos, max(0, i + 26))], "offset": projected_offset, "reason": "先行雲投影でねじれ"})
    if not checks:
        return out
    best = sorted(checks, key=lambda x: abs(int(x["offset"])))[0]
    out.update({"ok": True, "twist_date": _index_to_iso(best["idx"]), "days_to_twist": int(best["offset"]), "reason": f"{best['reason']}。現在から{best['offset']}営業日相当"})
    return out


def _daily_close_is_10d_high(df: pd.DataFrame, days: int = 10) -> dict[str, Any]:
    """Return whether the latest daily close is the highest close in the last N business days.

    条件㉖用。日足終値ベースで、直近10営業日の最高値かどうかを判定する。
    """
    out: dict[str, Any] = {"ok": False, "window_days": int(days), "latest_close": None, "highest_close": None, "highest_date": None, "reason": "10営業日高値判定不可"}
    if df is None or df.empty or "Close" not in df.columns:
        out["reason"] = "終値データがないため、10営業日高値判定不可"
        return out
    close = pd.to_numeric(df["Close"], errors="coerce").dropna()
    if close.empty:
        out["reason"] = "有効な終値データがないため、10営業日高値判定不可"
        return out
    recent = close.tail(days)
    latest_close = float(close.iloc[-1])
    highest_close = float(recent.max())
    highest_idx = recent.idxmax()
    ok = bool(latest_close >= highest_close)
    out.update({
        "ok": ok,
        "latest_close": _f(latest_close),
        "highest_close": _f(highest_close),
        "highest_date": _index_to_iso(highest_idx),
        "reason": "直近日足終値が10営業日内の終値最高値" if ok else "直近日足終値が10営業日内の終値最高値ではない",
    })
    return out


def _score_conditions_from_frames(d: pd.DataFrame, w: pd.DataFrame) -> dict[str, Any]:
    dl, dp = d.iloc[-1], d.iloc[-2] if len(d) >= 2 else None
    wl, wp = w.iloc[-1], w.iloc[-2] if len(w) >= 2 else None
    close = float(dl["Close"])
    weekly_close = float(wl["Close"])
    daily_rsi9 = _safe_num(dl.get("rsi9"))
    prev_daily_rsi9 = _safe_num(dp.get("rsi9")) if dp is not None else None
    daily_rsi9_slope = None if daily_rsi9 is None or prev_daily_rsi9 is None else daily_rsi9 - prev_daily_rsi9
    weekly_rsi14 = _safe_num(wl.get("rsi14"))
    prev_weekly_rsi14 = _safe_num(wp.get("rsi14")) if wp is not None else None
    weekly_rsi14_slope = None if weekly_rsi14 is None or prev_weekly_rsi14 is None else weekly_rsi14 - prev_weekly_rsi14
    daily_width_pct = _bb_width_current_pct(d)
    weekly_width_pct = _bb_width_current_pct(w)
    daily_expand = _bb_squeeze_expand_recent(d, threshold=0.10, expand_factor=1.10, keep_bars=3)
    weekly_expand = _bb_squeeze_expand_recent(w, threshold=0.10, expand_factor=1.10, keep_bars=2)
    daily_macd_gc = _macd_gc_within(d, keep_bars=3)
    weekly_macd_gc = _macd_gc_within(w, keep_bars=3)
    daily_rsi_low = _rsi_low_continuation(d, "rsi9", trigger_level=10, keep_level=20)
    weekly_rsi_low = _rsi_low_continuation(w, "rsi14", trigger_level=10, keep_level=20)
    daily_sma5_slope = _safe_num(dl.get("sma5")) - _safe_num(dp.get("sma5")) if dp is not None and _safe_num(dl.get("sma5")) is not None and _safe_num(dp.get("sma5")) is not None else None
    weekly_sma13_slope = _safe_num(wl.get("sma13")) - _safe_num(wp.get("sma13")) if wp is not None and _safe_num(wl.get("sma13")) is not None and _safe_num(wp.get("sma13")) is not None else None
    daily_ma_vals = [_safe_num(dl.get("sma5")), _safe_num(dl.get("sma25")), _safe_num(dl.get("sma75"))]
    weekly_ma_vals = [_safe_num(wl.get("sma13")), _safe_num(wl.get("sma26")), _safe_num(wl.get("sma52"))]
    daily_ma_conv = _ma_converged(daily_ma_vals, 0.05) and daily_ma_vals[0] == max(daily_ma_vals) and (daily_sma5_slope is not None and daily_sma5_slope > 0)
    weekly_ma_order = _weekly_ma_order_condition(wl)
    weekly_ma_conv_info = _weekly_ma_convergence_condition(weekly_ma_vals, weekly_sma13_slope, tolerance=0.10)
    weekly_ma_conv = bool(weekly_ma_conv_info.get("ok"))
    twist = _ichimoku_cloud_twist_within(d, window=5)
    daily_10d_high = _daily_close_is_10d_high(d, days=10)
    conditions = {
        "c01": close > dl.get("sma5", np.nan),
        "c02": daily_sma5_slope is not None and daily_sma5_slope >= 0,
        "c03": dl.get("sma5", np.nan) > dl.get("sma25", np.nan),
        "c04": bool(weekly_ma_order.get("ok")),
        "c05": weekly_sma13_slope is not None and weekly_sma13_slope >= 0,
        "c06": weekly_close / wl.get("sma13", np.nan) - 1 <= 0.10,
        "c07": _safe_num(dl.get("sma200")) is not None and close < float(dl.get("sma200")),
        "c08": wp is not None and wl.get("bb_width", np.nan) >= wp.get("bb_width", np.nan),
        "c09": dl.get("macd", np.nan) > dl.get("macd_signal", np.nan),
        "c10": wl.get("macd", np.nan) > wl.get("macd_signal", np.nan),
        "c11": ((daily_rsi9 is not None and daily_rsi9 <= 10 and daily_rsi9_slope is not None and daily_rsi9_slope < 0) or (daily_rsi9 is not None and 60 <= daily_rsi9 <= 80 and daily_rsi9_slope is not None and daily_rsi9_slope > 0)),
        "c12": ((weekly_rsi14 is not None and weekly_rsi14 <= 10 and weekly_rsi14_slope is not None and weekly_rsi14_slope < 0) or (weekly_rsi14 is not None and 60 <= weekly_rsi14 <= 80 and weekly_rsi14_slope is not None and weekly_rsi14_slope > 0)),
        "c13": close > dl.get("ichimoku_cloud_upper", np.nan),
        "c14": False,
        "c15": weekly_close > wl.get("sma13", np.nan),
        "c16": _bb_squeezed_for_days(d, days=5, threshold=0.10),
        "c17": daily_width_pct is not None and daily_width_pct <= 20,
        "c18": bool(daily_expand.get("ok")),
        "c19": bool(daily_macd_gc.get("ok")),
        "c20": bool(weekly_macd_gc.get("ok")),
        "c21": bool(daily_rsi_low.get("ok")),
        "c22": bool(weekly_rsi_low.get("ok")),
        "c23": bool(weekly_expand.get("ok")),
        "c24": bool(daily_ma_conv),
        "c25": bool(weekly_ma_conv),
        "c26": bool(twist.get("ok")) and bool(daily_10d_high.get("ok")),
    }
    conditions = {k: bool(v) if not pd.isna(v) else False for k, v in conditions.items()}
    score = sum(SCORE_POINTS.get(k, 0) for k, ok in conditions.items() if ok)
    condition_count = sum(1 for k, ok in conditions.items() if ok and SCORE_POINTS.get(k, 0) > 0)
    failed_high_numbers = " / ".join(k[1:] for k in sorted(HIGH_POINT_KEYS) if not conditions.get(k))
    detail_metrics = {
        "score_version": "v2_26_conditions_202606",
        "score_max": MAX_SCORE,
        "score_points": SCORE_POINTS,
        "score_groups": _score_group_scores(conditions),
        "score_group_definitions": SCORE_GROUPS,
        "weekly_ma_order_ok": conditions["c04"],
        "weekly_ma_order_rule": weekly_ma_order.get("rule"),
        "weekly_ma_order_excluded": weekly_ma_order.get("excluded"),
        "daily_rsi9": _f(daily_rsi9),
        "prev_daily_rsi9": _f(prev_daily_rsi9),
        "daily_rsi9_slope": _f(daily_rsi9_slope),
        "prev_weekly_rsi14": _f(prev_weekly_rsi14),
        "weekly_rsi14_slope": _f(weekly_rsi14_slope),
        "daily_sma75": _f(dl.get("sma75")),
        "daily_sma200": _f(dl.get("sma200")),
        "daily_close_below_sma200_penalty": conditions["c07"],
        "daily_bb_2sigma_width_pct": _f(daily_width_pct),
        "weekly_bb_2sigma_width_pct": _f(weekly_width_pct),
        "daily_bb_squeeze5_ok": conditions["c16"],
        "daily_bb_expand_recent_ok": conditions["c18"],
        "daily_bb_expand_signal_date": daily_expand.get("signal_date"),
        "daily_bb_expand_days_since": daily_expand.get("days_since"),
        "daily_bb_expand_base_width_pct": daily_expand.get("base_width_pct"),
        "daily_bb_expand_signal_width_pct": daily_expand.get("signal_width_pct"),
        "daily_bb_expand_reason": daily_expand.get("reason"),
        "weekly_bb_expand_recent_ok": conditions["c23"],
        "weekly_bb_expand_signal_date": weekly_expand.get("signal_date"),
        "weekly_bb_expand_days_since": weekly_expand.get("days_since"),
        "weekly_bb_expand_base_width_pct": weekly_expand.get("base_width_pct"),
        "weekly_bb_expand_signal_width_pct": weekly_expand.get("signal_width_pct"),
        "weekly_bb_expand_reason": weekly_expand.get("reason"),
        "daily_macd_gc_ok": conditions["c19"],
        "daily_macd_gc_date": daily_macd_gc.get("signal_date"),
        "daily_macd_gc_days_since": daily_macd_gc.get("days_since"),
        "weekly_macd_gc_ok": conditions["c20"],
        "weekly_macd_gc_date": weekly_macd_gc.get("signal_date"),
        "weekly_macd_gc_days_since": weekly_macd_gc.get("days_since"),
        "daily_rsi_low_continue_ok": conditions["c21"],
        "daily_rsi_low_trigger_date": daily_rsi_low.get("trigger_date"),
        "daily_rsi_low_days_since": daily_rsi_low.get("days_since"),
        "daily_rsi_low_reason": daily_rsi_low.get("reason"),
        "weekly_rsi_low_continue_ok": conditions["c22"],
        "weekly_rsi_low_trigger_date": weekly_rsi_low.get("trigger_date"),
        "weekly_rsi_low_days_since": weekly_rsi_low.get("days_since"),
        "weekly_rsi_low_reason": weekly_rsi_low.get("reason"),
        "daily_ma_convergence_ok": conditions["c24"],
        "daily_ma_convergence_gap_pct": _f((max(daily_ma_vals) / min(daily_ma_vals) - 1) * 100) if all(v is not None and v > 0 for v in daily_ma_vals) else None,
        "weekly_ma_convergence_ok": conditions["c25"],
        "weekly_ma_convergence_gap_pct": weekly_ma_conv_info.get("gap_pct"),
        "weekly_ma_convergence_rule": weekly_ma_conv_info.get("rule"),
        "weekly_ma_convergence_excluded": weekly_ma_conv_info.get("excluded"),
        "daily_ichimoku_twist_ok": bool(twist.get("ok")),
        "daily_ichimoku_twist_and_10d_high_ok": conditions["c26"],
        "daily_ichimoku_twist_date": twist.get("twist_date"),
        "daily_ichimoku_twist_days_to": twist.get("days_to_twist"),
        "daily_ichimoku_twist_reason": twist.get("reason"),
        "daily_10d_high_ok": bool(daily_10d_high.get("ok")),
        "daily_10d_high_window_days": daily_10d_high.get("window_days"),
        "daily_10d_high_latest_close": daily_10d_high.get("latest_close"),
        "daily_10d_high_value": daily_10d_high.get("highest_close"),
        "daily_10d_high_date": daily_10d_high.get("highest_date"),
        "daily_10d_high_reason": daily_10d_high.get("reason"),
    }
    return {"conditions": conditions, "score": int(score), "condition_count": int(condition_count), "failed_star_numbers": failed_high_numbers, "metrics": detail_metrics}

def _bb_breakout_info(df: pd.DataFrame, squeeze_days: int = 10, threshold: float = 0.10, keep_bars: int = 3) -> dict[str, Any]:
    """Detect upside-only BBブレイク.

    仕様:
    - BB2σ幅 = (BB+2σ - BB-2σ) / 終値
    - BB2σ幅が株価の10%以内の状態が10本以上続く
    - その後、BB2σ幅が前日/前週より広がる
    - かつ、ブレイク発生日の終値がBB+1σ以上にある
      （マイナス側、つまりBB-1σ以下での拡大は対象外）
    - 発生日から3本以内は「BBブレイク」タグを表示

    一般ユーザ向けには画面側で「上放れ候補」と表示される。
    """
    width_ratio = _bb_2sigma_width_ratio(df)
    width_valid = width_ratio.dropna()
    latest_width = _f(width_ratio.iloc[-1] * 100, 2) if len(width_ratio) and pd.notna(width_ratio.iloc[-1]) else None
    out: dict[str, Any] = {
        "bb_breakout_ok": False,
        "bb_breakout_signal_date": None,
        "bb_breakout_days_since": None,
        "bb_2sigma_width_ratio": latest_width,
        "bb_2sigma_width_ratio_prev": None,
        "bb_squeeze_days_required": squeeze_days,
        "bb_squeeze_width_threshold_pct": threshold * 100,
        "bb_breakout_keep_bars": keep_bars,
        "bb_breakout_positive_touch": False,
        "bb_breakout_current_positive_touch": False,
        "bb_breakout_touch_rule": "現在の終値がBB+1σ以上",
        "bb_breakout_signal_close": None,
        "bb_breakout_signal_upper1": None,
        "bb_breakout_current_close": None,
        "bb_breakout_current_upper1": None,
        "bb_breakout_reason": "BBブレイク条件未達",
    }
    if len(width_valid) < squeeze_days + 2:
        out["bb_breakout_reason"] = "BBブレイク判定に必要なデータ不足"
        return out

    width = width_ratio
    signals: list[dict[str, Any]] = []
    rejected_downside_count = 0

    for pos in range(squeeze_days, len(width)):
        cur = width.iloc[pos]
        prev = width.iloc[pos - 1]
        if pd.isna(cur) or pd.isna(prev):
            continue
        prev_window = width.iloc[pos - squeeze_days : pos]
        if prev_window.isna().any():
            continue

        squeeze_continued = bool((prev_window <= threshold).all())
        widened = bool(float(cur) > float(prev))
        if not (squeeze_continued and widened):
            continue

        close_at_signal = df["Close"].iloc[pos]
        upper1_series = df.get("bb_upper1", pd.Series(index=df.index, dtype=float))
        lower1_series = df.get("bb_lower1", pd.Series(index=df.index, dtype=float))
        upper1_at_signal = upper1_series.iloc[pos]
        lower1_at_signal = lower1_series.iloc[pos]
        positive_touch = bool(pd.notna(close_at_signal) and pd.notna(upper1_at_signal) and float(close_at_signal) >= float(upper1_at_signal))
        negative_touch = bool(pd.notna(close_at_signal) and pd.notna(lower1_at_signal) and float(close_at_signal) <= float(lower1_at_signal))

        if not positive_touch:
            if negative_touch:
                rejected_downside_count += 1
            continue

        signals.append(
            {
                "pos": pos,
                "date": _index_to_iso(df.index[pos]),
                "width_ratio": float(cur),
                "prev_width_ratio": float(prev),
                "close": float(close_at_signal),
                "upper1": float(upper1_at_signal),
                "lower1": float(lower1_at_signal) if pd.notna(lower1_at_signal) else None,
            }
        )

    if not signals:
        if rejected_downside_count:
            out["bb_breakout_reason"] = "BB幅拡大は検出したが、株価がマイナス側だったため対象外"
        return out

    last = signals[-1]
    days_since = len(df) - 1 - int(last["pos"])

    latest = df.iloc[-1]
    current_close = latest.get("Close", np.nan)
    current_upper1 = latest.get("bb_upper1", np.nan)
    current_positive_touch = bool(
        pd.notna(current_close)
        and pd.notna(current_upper1)
        and float(current_close) >= float(current_upper1)
    )

    # 重要: 発生日から3本以内でも、現在値がプラス側に触れていない場合はBBブレイク扱いにしない。
    # これにより、下方向・マイナス側でBB幅が広がった銘柄や、発生後にプラス側から外れた銘柄を除外する。
    ok = bool(days_since <= keep_bars - 1 and current_positive_touch)
    reason = (
        f"BB2σ幅が終値の{threshold*100:.0f}%以内の状態が{squeeze_days}本以上続いた後、"
        f"BB幅が拡大し、発生日の終値がBB+1σ以上。発生日から{days_since + 1}本目。"
    )
    if not current_positive_touch:
        reason += "ただし現在値がBB+1σ未満のため、上放れ候補から除外。"
    else:
        reason += "現在値もBB+1σ以上。"

    out.update(
        {
            "bb_breakout_ok": ok,
            "bb_breakout_signal_date": last["date"],
            "bb_breakout_days_since": days_since,
            "bb_2sigma_width_ratio": _f(last["width_ratio"] * 100, 2) if days_since == 0 else out["bb_2sigma_width_ratio"],
            "bb_2sigma_width_ratio_prev": _f(last["prev_width_ratio"] * 100, 2),
            "bb_breakout_positive_touch": True,
            "bb_breakout_current_positive_touch": current_positive_touch,
            "bb_breakout_signal_close": _f(last["close"]),
            "bb_breakout_signal_upper1": _f(last["upper1"]),
            "bb_breakout_current_close": _f(current_close),
            "bb_breakout_current_upper1": _f(current_upper1),
            "bb_breakout_reason": reason,
        }
    )
    return out

def _sideways_range(
    df: pd.DataFrame,
    ma_col: str,
    window: int = 3,
    lookback: int = 260,
    slope_threshold: float = 0.001,
    reference_window: int = 63,
    reference_label: str = "前後3か月",
) -> dict[str, Any]:
    """Find sideways range from MA slope sign-change points with local volume spike.

    新仕様:
    - 横ばいレンジ変換日 = MA傾きがマイナス→プラス、またはプラス→マイナスに転換した日/週
    - 変換日±3本の平均出来高 >= 変換日前後N本の平均出来高 × 3
      日足: N=63営業日、週足: N=60週
    - 変換日前後±3本の中で、MA傾きが極大の日のHighを横ばいレンジ上限値
    - 変換日前後±3本の中で、MA傾きが極小の日のLowを横ばいレンジ下限値
    - 複数ある場合は直近lookback本の中で最新の変換日から作った上限/下限を採用
    """
    out = {
        "range_high": None,
        "range_low": None,
        "range_high_date": None,
        "range_low_date": None,
        "range_high_reason": "横ばいレンジ最大値候補なし",
        "range_low_reason": "横ばいレンジ最小値候補なし",
        "range_conversion_date": None,
        "volume_avg_all": None,
        "volume_avg_reference": None,
        "volume_reference_label": reference_label,
        "volume_multiplier_required": 3,
        "range_rule": f"MA傾き符号反転 + ±{window}本出来高が{reference_label}平均の3倍",
    }
    if ma_col not in df.columns or len(df) < (window * 2 + 30):
        return out

    work = df.copy().tail(lookback).copy()
    ma = pd.to_numeric(work[ma_col], errors="coerce")
    vol = pd.to_numeric(work["Volume"], errors="coerce")
    if ma.dropna().empty or vol.dropna().empty:
        return out

    ma_slope = ma.diff()
    candidates: list[dict[str, Any]] = []

    for pos in range(window, len(work) - window):
        idx = work.index[pos]
        current_sign = _slope_sign(ma_slope.iloc[pos])
        if current_sign == 0:
            continue
        previous_sign = _previous_nonzero_sign(ma_slope, pos, max_lookback=5)
        if previous_sign == 0 or previous_sign == current_sign:
            continue

        local = work.iloc[pos - window : pos + window + 1]
        local_slope = ma_slope.iloc[pos - window : pos + window + 1]
        if local_slope.dropna().empty:
            continue

        local_vol_avg = float(pd.to_numeric(local["Volume"], errors="coerce").mean())
        if pd.isna(local_vol_avg):
            continue

        ref_start = max(0, pos - reference_window)
        ref_end = min(len(work), pos + reference_window + 1)
        ref = work.iloc[ref_start:ref_end]
        reference_vol_avg = float(pd.to_numeric(ref["Volume"], errors="coerce").mean())
        if pd.isna(reference_vol_avg) or reference_vol_avg <= 0:
            continue
        if local_vol_avg < reference_vol_avg * 3:
            continue

        max_slope_idx = local_slope.idxmax()
        min_slope_idx = local_slope.idxmin()
        high_value = float(work.loc[max_slope_idx, "High"])
        low_value = float(work.loc[min_slope_idx, "Low"])

        direction = "マイナスからプラス" if previous_sign < 0 and current_sign > 0 else "プラスからマイナス"
        common_reason = f"MA傾きが{direction}へ転換。±{window}本平均出来高が{reference_label}平均の{local_vol_avg / reference_vol_avg:.2f}倍"
        candidates.append(
            {
                "conversion_date": _index_to_iso(idx),
                "high": high_value,
                "high_date": _index_to_iso(max_slope_idx),
                "low": low_value,
                "low_date": _index_to_iso(min_slope_idx),
                "ma": _f(ma.iloc[pos]),
                "ma_slope": _f(ma_slope.iloc[pos], 6),
                "previous_sign": previous_sign,
                "current_sign": current_sign,
                "window_volume_avg": local_vol_avg,
                "reference_volume_avg": reference_vol_avg,
                "volume_ratio": local_vol_avg / reference_vol_avg,
                "reference_label": reference_label,
                "reason": common_reason,
            }
        )

    if not candidates:
        return out

    latest = candidates[-1]
    out.update(
        {
            "range_high": _f(latest["high"]),
            "range_low": _f(latest["low"]),
            "range_high_date": latest["high_date"],
            "range_low_date": latest["low_date"],
            "range_high_reason": latest["reason"] + "。±3本内のMA傾き極大日のHighを採用。",
            "range_low_reason": latest["reason"] + "。±3本内のMA傾き極小日のLowを採用。",
            "range_conversion_date": latest["conversion_date"],
            "range_high_window_volume_avg": _f(latest["window_volume_avg"], 0),
            "range_high_reference_volume_avg": _f(latest["reference_volume_avg"], 0),
            "range_high_volume_ratio": _f(latest["volume_ratio"], 2),
            "range_low_window_volume_avg": _f(latest["window_volume_avg"], 0),
            "range_low_reference_volume_avg": _f(latest["reference_volume_avg"], 0),
            "range_low_volume_ratio": _f(latest["volume_ratio"], 2),
            "volume_avg_reference": _f(latest["reference_volume_avg"], 0),
            "volume_avg_all": _f(latest["reference_volume_avg"], 0),
        }
    )
    return out

def _sideways_eval(df: pd.DataFrame, timeframe: str) -> tuple[str, dict[str, Any]]:
    """Evaluate daily/weekly sideways range component tags.

    日足:
    - 横ばいレンジは5MAの傾き符号反転を基準に作る
    - BB横ばいレンジ: BBブレイク条件 + BB±2σが横ばいレンジ内
    - RSI横ばいレンジ: RSI<=20、RSI傾き>=0、現在値が横ばいレンジ内
    - MA横ばいレンジ: 5MAが横ばいレンジ内、5MA傾き<=0、株価<=5MA

    週足:
    - 日足の5MAを13週MA、前後3か月を前後60週に置き換える
    """
    is_daily = timeframe == "daily"
    ma_col = "sma5" if is_daily else "sma13"
    lookback = 260 if is_daily else 156
    range_label = "日足" if is_daily else "週足"
    bb_compare = 10 if is_daily else 3

    details: dict[str, Any] = {
        f"{timeframe}_sideways_ok": False,
        f"{timeframe}_sideways_tag": "",
        f"{timeframe}_sideways_reason": "判定不可",
    }
    if len(df) <= max(30, bb_compare + 1) or ma_col not in df.columns:
        details[f"{timeframe}_sideways_reason"] = "データ不足"
        return "", details

    latest = df.iloc[-1]
    prev = df.iloc[-2] if len(df) >= 2 else None
    compare = df.iloc[-1 - bb_compare] if len(df) > bb_compare else None
    close = float(latest["Close"])

    rng = _sideways_range(
        df,
        ma_col=ma_col,
        window=3,
        lookback=lookback,
        slope_threshold=0.0,
        reference_window=63 if is_daily else 60,
        reference_label="前後3か月" if is_daily else "前後60週",
    )
    range_high = rng.get("range_high")
    range_low = rng.get("range_low")

    bb_info = _bb_breakout_info(df, squeeze_days=10, threshold=0.10, keep_bars=3)
    bb_breakout_ok = bool(bb_info.get("bb_breakout_ok"))
    bb_width = _bb_2sigma_width_ratio(df).iloc[-1]
    bb_width_prev = _bb_2sigma_width_ratio(df).iloc[-1 - bb_compare] if len(df) > bb_compare else np.nan
    bb_upper2 = latest.get("bb_upper2", np.nan)
    bb_lower2 = latest.get("bb_lower2", np.nan)
    rsi_now = latest.get("rsi14", np.nan)
    rsi_prev = prev.get("rsi14", np.nan) if prev is not None else np.nan
    ma_now = latest.get(ma_col, np.nan)
    ma_prev = prev.get(ma_col, np.nan) if prev is not None else np.nan

    range_exists = bool(range_high is not None and range_low is not None)
    range_in = bool(range_exists and float(range_low) <= close <= float(range_high))
    bb_range_ok = bool(
        bb_breakout_ok
        and range_exists
        and pd.notna(bb_lower2)
        and pd.notna(bb_upper2)
        and float(range_low) <= float(bb_lower2)
        and float(bb_upper2) <= float(range_high)
    )
    rsi_ok = bool(pd.notna(rsi_now) and pd.notna(rsi_prev) and float(rsi_now) <= 20 and (float(rsi_now) - float(rsi_prev)) >= 0 and range_in)
    ma_range_ok = bool(range_exists and pd.notna(ma_now) and float(range_low) <= float(ma_now) <= float(range_high))
    ma_slope_ok = bool(pd.notna(ma_now) and pd.notna(ma_prev) and (float(ma_now) - float(ma_prev)) <= 0)
    price_below_ma = bool(pd.notna(ma_now) and close <= float(ma_now))
    ma_ok = bool(ma_range_ok and ma_slope_ok and price_below_ma)

    component_tags: list[str] = []
    if bb_range_ok:
        component_tags.append(f"{range_label}BB横ばいレンジ")
    if rsi_ok:
        component_tags.append(f"{range_label}RSI横ばいレンジ")
    if ma_ok:
        component_tags.append(f"{range_label}MA横ばいレンジ")

    unmet = []
    if not bb_range_ok:
        unmet.append("BBブレイク条件、またはBB±2σレンジ内条件が未達")
    if not rsi_ok:
        unmet.append("RSI20以下・RSI傾き0以上・現在値レンジ内のいずれかが未達")
    if not ma_ok:
        unmet.append("MAレンジ内・MA傾き0以下・株価MA以下のいずれかが未達")

    details.update(
        {
            f"{timeframe}_sideways_ok": bool(component_tags),
            f"{timeframe}_sideways_tag": " / ".join(component_tags),
            f"{timeframe}_sideways_component_tags": component_tags,
            f"{timeframe}_sideways_reason": " / ".join(unmet) if unmet else "横ばいレンジ関連条件を達成",
            f"{timeframe}_sideways_range_high": range_high,
            f"{timeframe}_sideways_range_low": range_low,
            f"{timeframe}_sideways_range_max": range_high,
            f"{timeframe}_sideways_range_min": range_low,
            f"{timeframe}_sideways_range_high_date": rng.get("range_high_date"),
            f"{timeframe}_sideways_range_low_date": rng.get("range_low_date"),
            f"{timeframe}_sideways_range_max_date": rng.get("range_high_date"),
            f"{timeframe}_sideways_range_min_date": rng.get("range_low_date"),
            f"{timeframe}_sideways_range_conversion_date": rng.get("range_conversion_date"),
            f"{timeframe}_sideways_range_high_reason": rng.get("range_high_reason"),
            f"{timeframe}_sideways_range_low_reason": rng.get("range_low_reason"),
            f"{timeframe}_sideways_range_in": range_in,
            f"{timeframe}_sideways_range_max_tag": _range_value_tag(range_label, "最大", range_high, rng.get("range_high_date")),
            f"{timeframe}_sideways_range_min_tag": _range_value_tag(range_label, "最小", range_low, rng.get("range_low_date")),
            f"{timeframe}_sideways_range_in_tag": f"{range_label}レンジ内" if range_in else "",
            f"{timeframe}_sideways_bb_range_tag": f"{range_label}BB横ばいレンジ" if bb_range_ok else "",
            f"{timeframe}_sideways_rsi_range_tag": f"{range_label}RSI横ばいレンジ" if rsi_ok else "",
            f"{timeframe}_sideways_ma_range_tag": f"{range_label}MA横ばいレンジ" if ma_ok else "",
            f"{timeframe}_sideways_volume_reference_label": rng.get("volume_reference_label"),
            f"{timeframe}_sideways_volume_avg_reference": rng.get("volume_avg_reference"),
            f"{timeframe}_sideways_range_high_window_volume_avg": rng.get("range_high_window_volume_avg"),
            f"{timeframe}_sideways_range_high_reference_volume_avg": rng.get("range_high_reference_volume_avg"),
            f"{timeframe}_sideways_range_high_volume_ratio": rng.get("range_high_volume_ratio"),
            f"{timeframe}_sideways_range_low_window_volume_avg": rng.get("range_low_window_volume_avg"),
            f"{timeframe}_sideways_range_low_reference_volume_avg": rng.get("range_low_reference_volume_avg"),
            f"{timeframe}_sideways_range_low_volume_ratio": rng.get("range_low_volume_ratio"),
            f"{timeframe}_sideways_bb_upper2": _f(bb_upper2),
            f"{timeframe}_sideways_bb_lower2": _f(bb_lower2),
            f"{timeframe}_sideways_bb_width": _f(float(bb_width) * 100, 2) if pd.notna(bb_width) else None,
            f"{timeframe}_sideways_bb_width_compare": _f(float(bb_width_prev) * 100, 2) if pd.notna(bb_width_prev) else None,
            f"{timeframe}_sideways_bb_breakout": bb_breakout_ok,
            f"{timeframe}_sideways_bb_breakout_signal_date": bb_info.get("bb_breakout_signal_date"),
            f"{timeframe}_sideways_bb_breakout_reason": bb_info.get("bb_breakout_reason"),
            f"{timeframe}_sideways_bb_breakout_positive_touch": bb_info.get("bb_breakout_positive_touch"),
            f"{timeframe}_sideways_bb_breakout_current_positive_touch": bb_info.get("bb_breakout_current_positive_touch"),
            f"{timeframe}_sideways_bb_breakout_touch_rule": bb_info.get("bb_breakout_touch_rule"),
            f"{timeframe}_sideways_rsi": _f(rsi_now),
            f"{timeframe}_sideways_rsi_slope": _f(float(rsi_now) - float(rsi_prev)) if pd.notna(rsi_now) and pd.notna(rsi_prev) else None,
            f"{timeframe}_sideways_ma": _f(ma_now),
            f"{timeframe}_sideways_ma_slope": _f(float(ma_now) - float(ma_prev)) if pd.notna(ma_now) and pd.notna(ma_prev) else None,
            f"{timeframe}_sideways_close": _f(close),
            f"{timeframe}_sideways_price_below_ma": price_below_ma,
            f"{timeframe}_sideways_ma_col": ma_col,
            f"{timeframe}_sideways_volume_avg_all": rng.get("volume_avg_all"),
        }
    )
    return " / ".join(component_tags), details

def bb_squeeze_tag(d: pd.DataFrame) -> tuple[str, dict[str, Any]]:
    """Daily BBブレイク only. 旧BB拡大中は廃止。"""
    info = _bb_breakout_info(d, squeeze_days=10, threshold=0.10, keep_bars=3)
    latest = d.iloc[-1]
    close = float(latest["Close"])
    width_ratio = _bb_2sigma_width_ratio(d)
    current_width_pct = float(width_ratio.iloc[-1]) * 100 if len(width_ratio) and pd.notna(width_ratio.iloc[-1]) else None
    metrics = {
        "daily_bb_width": _f(current_width_pct, 2),
        "daily_bb_width_unit": "BB2σ幅/終値%",
        "daily_bb_position": _bb_position(close, latest),
        "daily_bb_breakout": info.get("bb_breakout_ok"),
        "daily_bb_breakout_signal_date": info.get("bb_breakout_signal_date"),
        "daily_bb_breakout_days_since": info.get("bb_breakout_days_since"),
        "daily_bb_breakout_positive_touch": info.get("bb_breakout_positive_touch"),
        "daily_bb_breakout_current_positive_touch": info.get("bb_breakout_current_positive_touch"),
        "daily_bb_breakout_touch_rule": info.get("bb_breakout_touch_rule"),
        "daily_bb_breakout_signal_close": info.get("bb_breakout_signal_close"),
        "daily_bb_breakout_signal_upper1": info.get("bb_breakout_signal_upper1"),
        "daily_bb_breakout_current_close": info.get("bb_breakout_current_close"),
        "daily_bb_breakout_current_upper1": info.get("bb_breakout_current_upper1"),
        "daily_bb_squeeze_width_threshold_pct": info.get("bb_squeeze_width_threshold_pct"),
        "daily_bb_squeeze_days_required": info.get("bb_squeeze_days_required"),
        "reason": info.get("bb_breakout_reason"),
    }
    if info.get("bb_breakout_ok"):
        return "BBブレイク", metrics
    return "BBスクイーズ未確認", metrics

def volatility_tag(d: pd.DataFrame) -> tuple[str, dict[str, Any]]:
    recent = d.tail(126)
    if len(recent) < 60:
        return "ボラ判定不可", {"reason": "6か月値幅判定に必要なデータ不足"}
    high = float(recent["High"].max())
    low = float(recent["Low"].min())
    range_pct = (high / low - 1) * 100 if low else None
    tag = "ボラOK" if range_pct is not None and range_pct >= 30 else "ボラ不足"
    return tag, {"six_month_high": _f(high), "six_month_low": _f(low), "six_month_range_pct": _f(range_pct), "reason": "過去6か月値幅30%以上" if tag == "ボラOK" else "過去6か月値幅30%未満"}


def volume_tag(d: pd.DataFrame) -> tuple[str, dict[str, Any]]:
    if len(d) < 20:
        return "出来高判定不可", {"reason": "20日平均売買代金を計算できない"}
    close = d["Close"]
    trading_value = close * d["Volume"]
    avg20 = float(trading_value.tail(20).mean())
    if avg20 >= 100_000_000:
        tag = "出来高強い"
    elif avg20 >= 50_000_000:
        tag = "出来高OK"
    else:
        tag = "出来高不足"
    return tag, {"avg_trading_value_20d": round(avg20), "reason": "20日平均売買代金で判定"}


def risk_lines(d: pd.DataFrame) -> tuple[list[str], dict[str, Any]]:
    # PoC/βツールの位置づけに合わせ、損切り・利確・目標株価に見える値は計算・保存しない。
    return [], {}


def analyze_item(item: WatchItem, earnings: dict[str, Any] | None = None, market_cap_yen: float | None = None) -> dict[str, Any]:
    raw = fetch_daily_prices(item.code)
    d = add_daily_indicators(raw)
    w = add_weekly_indicators(to_weekly(raw))
    dl, dp = d.iloc[-1], d.iloc[-2] if len(d) >= 2 else None
    wl, wp = w.iloc[-1], w.iloc[-2] if len(w) >= 2 else None
    close = float(dl["Close"])
    weekly_close = float(wl["Close"])
    score_history = score_history_5d(raw, days=5)
    score_category_history = score_category_history_10d(raw, days=10)
    admin_trade_simulations = _score_trade_simulations_50d(raw, days=50)

    bb_tag, bb_metrics = bb_squeeze_tag(d)
    vol_tag, vol_metrics = volatility_tag(d)
    liq_tag, liq_metrics = volume_tag(d)
    risk_tags, risk_metrics = risk_lines(d)
    # 横ばいレンジ判定は廃止。計算・表示ともに行わない。
    daily_sideways_tag, daily_sideways_metrics = "", {}
    weekly_sideways_tag, weekly_sideways_metrics = "", {}

    earnings = earnings or {}
    earnings_tag = earnings.get("earnings_tag") or ""

    size_tag = "時価総額不明"
    if market_cap_yen is not None:
        size_tag = "小型株" if market_cap_yen <= 30_000_000_000 else "中型以上"

    # 新仕様: 出来高OK以上、ボラOK以上、かつ週足雲下でない銘柄だけスコアを判定する。
    # 週足の雲が未算出の場合は、雲フィルタを適用せずスコア算定対象とする。
    liquidity_ok = liq_tag in {"出来高OK", "出来高強い"}
    volatility_ok = vol_tag == "ボラOK"
    weekly_cloud_gate = _weekly_cloud_score_gate(wl)
    weekly_cloud_ok = bool(weekly_cloud_gate.get("ok"))
    score_eligible = bool(liquidity_ok and volatility_ok and weekly_cloud_ok)
    exclusion_reasons: list[str] = []
    if not liquidity_ok:
        exclusion_reasons.append("出来高条件未達")
    if not volatility_ok:
        exclusion_reasons.append("ボラ条件未達")
    if not weekly_cloud_ok:
        exclusion_reasons.append("週足雲下")

    conditions: dict[str, bool] = {}
    score: int | None = None
    condition_count: int | None = None
    failed_star_numbers = ""
    pickup = False

    # 詳細画面の表示値は、スコア判定対象外でも確認できるように常に保存する。
    metrics = {
        "score_eligible": score_eligible,
        "score_status": "判定対象" if score_eligible else "スコア判定対象外",
        "score_exclusion_reason": " / ".join(exclusion_reasons),
        "conditions": conditions,
        "close": _f(close),
        "weekly_close": _f(weekly_close),
        "score_history_5d": score_history,
        "score_history_days": 5,
        "score_category_history_10d": score_category_history,
        "score_category_history_days": 10,
        "admin_trade_simulations_50d": admin_trade_simulations,
        "admin_trade_simulations_40d": admin_trade_simulations,  # backward compatibility
        "admin_trade_simulations_days": 50,
        "admin_trade_simulations_score_basis": "score",

        # 14条件の詳細画面で使う主要テクニカル値
        "daily_sma5": _f(dl.get("sma5")),
        "prev_daily_sma5": _f(dp.get("sma5")) if dp is not None else None,
        "daily_sma5_slope": _f(dl.get("sma5", np.nan) - dp.get("sma5", np.nan)) if dp is not None else None,
        "daily_sma25": _f(dl.get("sma25")),
        "daily_sma200": _f(dl.get("sma200")),
        "daily_close_below_sma200_penalty": conditions.get("c07", False),
        "weekly_sma13": _f(wl.get("sma13")),
        "prev_weekly_sma13": _f(wp.get("sma13")) if wp is not None else None,
        "weekly_sma13_slope": _f(wl.get("sma13", np.nan) - wp.get("sma13", np.nan)) if wp is not None else None,
        "weekly_sma26": _f(wl.get("sma26")),
        "weekly_sma52": _f(wl.get("sma52")),
        "weekly_sma13_gap_pct": _f((weekly_close / wl.get("sma13", np.nan) - 1) * 100),

        "daily_bb_lower1": _f(dl.get("bb_lower1")),
        "daily_bb_upper1": _f(dl.get("bb_upper1")),
        "daily_bb_position": _bb_position(close, dl),
        "weekly_bb_upper1": _f(wl.get("bb_upper1")),
        "weekly_bb_upper2": _f(wl.get("bb_upper2")),
        "weekly_bb_width": _f(wl.get("bb_width"), 4),
        "prev_weekly_bb_width": _f(wp.get("bb_width"), 4) if wp is not None else None,

        "daily_macd": _f(dl.get("macd")),
        "daily_macd_signal": _f(dl.get("macd_signal")),
        "daily_macd_hist": _f(dl.get("macd_hist")),
        "prev_daily_macd_hist": _f(dp.get("macd_hist")) if dp is not None else None,
        "weekly_macd": _f(wl.get("macd")),
        "weekly_macd_signal": _f(wl.get("macd_signal")),

        "daily_rsi14": _f(dl.get("rsi14")),
        "weekly_rsi14": _f(wl.get("rsi14")),
        "daily_ichimoku_cloud_upper": _f(dl.get("ichimoku_cloud_upper")),
        "weekly_ichimoku_cloud_upper": _f(wl.get("ichimoku_cloud_upper")),
        "weekly_ichimoku_cloud_lower": _f(wl.get("ichimoku_cloud_lower")),
        "weekly_cloud_score_gate_ok": bool(weekly_cloud_gate.get("ok")),
        "weekly_cloud_score_gate_calculable": bool(weekly_cloud_gate.get("calculable")),
        "weekly_cloud_score_gate_position": weekly_cloud_gate.get("position"),
        "weekly_cloud_score_gate_reason": weekly_cloud_gate.get("reason"),

        **bb_metrics,
        # 横ばいレンジ判定は廃止したためmetricsにも保存しない。
        **vol_metrics,
        **liq_metrics,
        **risk_metrics,
        "market_cap_yen": market_cap_yen,
        **earnings,
    }

    # 新スコア条件の詳細値は、スコア判定対象外でも管理者詳細で確認できるよう保持する。
    try:
        calc_preview = _score_conditions_from_frames(d, w)
        metrics.update(calc_preview.get("metrics", {}))
    except Exception as exc:  # noqa: BLE001
        metrics["score_calc_error"] = str(exc)

    if score_eligible:
        calc = _score_conditions_from_frames(d, w)
        conditions = calc["conditions"]
        score = calc["score"]
        condition_count = calc["condition_count"]
        failed_star_numbers = calc["failed_star_numbers"]
        pickup = all(conditions.get(k) for k in HIGH_POINT_KEYS)
        metrics.update(calc.get("metrics", {}))
        metrics["conditions"] = conditions

    # 表示タグは絞る。売買水準・損切り/利確に見えるタグはDBにも入れない。
    tags: list[str] = []
    if earnings_tag in {"決算直前注意", "決算前除外"}:
        tags.append(earnings_tag)
    # BBブレイク/上放れ候補のダッシュボード分類は廃止したため、tagsには入れない。
    # 横ばいレンジ系タグも廃止。
    if score_eligible and size_tag == "小型株":
        tags.append(size_tag)

    return {
        "code": normalize_code(item.code),
        "name": item.name,
        "close": _f(close),
        "score": int(score) if score is not None else None,
        "condition_count": int(condition_count) if condition_count is not None else None,
        "failed_star_numbers": failed_star_numbers,
        "pickup_flag": bool(pickup),
        "tags": list(dict.fromkeys(tags)),
        "tag_reasons": {
            "bb": bb_metrics.get("reason"),
            "volatility": vol_metrics.get("reason"),
            "volume": liq_metrics.get("reason"),
        },
        "metrics": metrics,
        "kabutan_url": f"https://kabutan.jp/stock/chart?code={normalize_code(item.code)}",
    }
