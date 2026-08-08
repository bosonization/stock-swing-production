from __future__ import annotations

import os
from typing import Any

from supabase import create_client


def get_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    return create_client(url, key)


def fetch_active_users(client) -> list[dict[str, Any]]:
    res = client.table("app_users").select("*").eq("status", "active").execute()
    return list(res.data or [])


def fetch_watchlist(client, user_id: str) -> list[dict[str, Any]]:
    res = client.table("watchlists").select("code,name,memo").eq("user_id", user_id).eq("is_active", True).order("code").execute()
    return list(res.data or [])


def create_run(client, user_id: str) -> str:
    res = client.table("analysis_runs").insert({"user_id": user_id, "status": "running"}).execute()
    return res.data[0]["id"]


def finish_run(client, run_id: str, status: str = "success", error_message: str | None = None) -> None:
    payload: dict[str, Any] = {"status": status, "finished_at": "now()"}
    if error_message:
        payload["error_message"] = error_message
    # Supabase doesn't interpret now() string as SQL; keep a client-side timestamp by DB default not possible here.
    import datetime as _dt
    payload["finished_at"] = _dt.datetime.now(_dt.timezone.utc).isoformat()
    client.table("analysis_runs").update(payload).eq("id", run_id).execute()


def upsert_results(client, rows: list[dict[str, Any]]) -> None:
    if rows:
        client.table("analysis_results").insert(rows).execute()
