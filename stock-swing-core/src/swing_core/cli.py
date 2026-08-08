from __future__ import annotations

import argparse
import traceback
from typing import Any

from .analyzer import analyze_item
from .data import WatchItem, normalize_code
from .dividend_metrics import enrich_results_with_dividends
from .market_cap import fetch_market_cap_map
from .earnings_calendar import next_earnings_map_from_db, sync_earnings_calendar
from .supabase_io import create_run, fetch_active_users, fetch_watchlist, finish_run, get_client, upsert_results

try:
    from .market_env import market_environment_result
except Exception:  # noqa: BLE001
    market_environment_result = None


def run_user(client, user_id: str) -> None:
    watch = fetch_watchlist(client, user_id)
    run_id = create_run(client, user_id)
    try:
        try:
            synced = sync_earnings_calendar(client)
            print(f"[{user_id}] earnings calendar synced: {synced} rows")
        except Exception as exc:  # noqa: BLE001
            print(f"[{user_id}] WARN earnings calendar sync: {exc}")
        codes = [w["code"] for w in watch]
        earnings_map = next_earnings_map_from_db(client, codes)
        market_cap_map = fetch_market_cap_map(codes)
        results: list[dict[str, Any]] = []
        for row in watch:
            item = WatchItem(code=row["code"], name=row.get("name") or "")
            try:
                ncode = normalize_code(item.code)
                result = analyze_item(
                    item,
                    earnings=earnings_map.get(ncode),
                    market_cap_yen=market_cap_map.get(ncode),
                )
                results.append({
                    "run_id": run_id,
                    "user_id": user_id,
                    **result,
                })
                print(f"[{user_id}] analyzed {item.code}")
            except Exception as exc:  # noqa: BLE001
                print(f"[{user_id}] ERROR {item.code}: {exc}")
        try:
            enrich_results_with_dividends(results)
        except Exception as exc:  # noqa: BLE001
            print(f"[{user_id}] WARN dividend metrics enrichment: {exc}")
        if market_environment_result is not None:
            try:
                results.append(market_environment_result(user_id, run_id))
                print(f"[{user_id}] market environment analyzed")
            except Exception as exc:  # noqa: BLE001
                print(f"[{user_id}] WARN market environment: {exc}")
        upsert_results(client, results)
        finish_run(client, run_id, "success")
        print(f"[{user_id}] results: {len(results)}")
    except Exception as exc:  # noqa: BLE001
        finish_run(client, run_id, "failed", traceback.format_exc())
        raise


def run_all() -> None:
    client = get_client()
    users = fetch_active_users(client)
    for u in users:
        run_user(client, u["id"])


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("run-all")
    sub.add_parser("sync-earnings-calendar")
    p_user = sub.add_parser("run-user")
    p_user.add_argument("--user-id", required=True)
    args = parser.parse_args()

    client = get_client()
    if args.cmd == "run-all":
        for u in fetch_active_users(client):
            run_user(client, u["id"])
    elif args.cmd == "run-user":
        run_user(client, args.user_id)
    elif args.cmd == "sync-earnings-calendar":
        count = sync_earnings_calendar(client)
        print(f"earnings calendar synced: {count} rows")


if __name__ == "__main__":
    main()
