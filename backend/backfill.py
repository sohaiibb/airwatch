#!/usr/bin/env python3
"""
AirWatch Historical Data Backfill Script
=========================================
Fetches historical readings from the EnggEnv API and stores them in Supabase.

Usage
-----
  # Backfill from Sep 2025 to today (auto-detects earliest available data)
  python3 backfill.py --device ENE04771 --from 2025-09-01

  # Backfill a specific range
  python3 backfill.py --device ENE04771 --from 2025-09-01 --to 2025-12-31

  # Backfill using station UUID (instead of device ID)
  python3 backfill.py --station-id <uuid> --from 2025-09-01

  # Dry run: show what would be fetched without writing to Supabase
  python3 backfill.py --device ENE04771 --from 2025-09-01 --dry-run

  # Custom chunk size (days per API request — default 30)
  python3 backfill.py --device ENE04771 --from 2025-09-01 --chunk-days 7

Environment variables required (or set in .env file)
------------------------------------------------------
  SUPABASE_URL=https://xxx.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=eyJ...
"""

import os
import sys
import argparse
import json
from datetime import datetime, timedelta, date as date_type

import httpx
from dotenv import load_dotenv

# Load .env if present
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

try:
    from supabase import create_client
except ImportError:
    print("ERROR: supabase-py not installed. Run: pip install supabase")
    sys.exit(1)

# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────

SUPABASE_URL  = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY  = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
ENGGENV_BASE  = "https://apis.enggenv.com/api/v1/uz/data"

UPSERT_BATCH  = 500   # rows per Supabase upsert call

# ─────────────────────────────────────────────────────────────────────────────
# AQI (US EPA PM2.5 breakpoints)
# ─────────────────────────────────────────────────────────────────────────────

def calc_aqi(pm25):
    if pm25 is None:
        return None
    bps = [
        (0, 12, 0, 50), (12.1, 35.4, 51, 100), (35.5, 55.4, 101, 150),
        (55.5, 150.4, 151, 200), (150.5, 250.4, 201, 300),
        (250.5, 350.4, 301, 400), (350.5, 500.4, 401, 500),
    ]
    for bl, bh, al, ah in bps:
        if bl <= pm25 <= bh:
            return round(((ah - al) / (bh - bl)) * (pm25 - bl) + al)
    return min(round(pm25 * 2), 500)

# ─────────────────────────────────────────────────────────────────────────────
# Record mapping
# ─────────────────────────────────────────────────────────────────────────────

def parse_record(raw: dict, station_id: str, field_mapping: dict = None) -> dict:
    """Convert a raw EnggEnv API record to a Supabase readings row."""
    m = field_mapping or {}

    def gf(api_key: str, db_col: str):
        actual_key = m.get(db_col, m.get(api_key, api_key))
        v = raw.get(actual_key)
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    ts = raw.get("timestamp", datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"))

    rec = {
        "station_id":     station_id,
        "timestamp":      ts,
        "pm25":           gf("PM2.5",          "pm25"),
        "pm10":           gf("PM10",           "pm10"),
        "so2":            gf("so2",            "so2"),
        "no2":            gf("no2",            "no2"),
        "o3":             gf("o3",             "o3"),
        "co":             gf("CO",             "co"),
        "temperature":    gf("Temperature",    "temperature"),
        "humidity":       gf("Humidity",       "humidity"),
        "wind_speed":     gf("ws",             "wind_speed"),
        "wind_direction": gf("Wind Direction", "wind_direction"),
        "source":         "enggenv",
    }

    pm25_val = rec.get("pm25")
    if pm25_val is not None:
        rec["aqi"] = calc_aqi(pm25_val)

    return rec

# ─────────────────────────────────────────────────────────────────────────────
# Date chunking
# ─────────────────────────────────────────────────────────────────────────────

def date_chunks(from_date: date_type, to_date: date_type, chunk_days: int = 30):
    current = from_date
    while current <= to_date:
        end = min(current + timedelta(days=chunk_days - 1), to_date)
        yield current.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")
        current = end + timedelta(days=1)

# ─────────────────────────────────────────────────────────────────────────────
# API fetch
# ─────────────────────────────────────────────────────────────────────────────

def fetch_chunk(http: httpx.Client, device_id: str, from_str: str, to_str: str, api_url: str = None) -> list:
    """Fetch all records from the EnggEnv API for a given date range."""
    base = api_url or ENGGENV_BASE
    url  = f"{base}?action=getDeviceData&device={device_id}&from={from_str}&to={to_str}"
    resp = http.get(url, timeout=120)
    resp.raise_for_status()
    body = resp.json()
    if not body.get("success"):
        raise ValueError(f"API returned success=false: {body.get('message', '')}")
    return body.get("data", [])

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Backfill AirWatch with historical data from the EnggEnv API"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--device",     help="EnggEnv device ID, e.g. ENE04771")
    group.add_argument("--station-id", help="Supabase station UUID")

    parser.add_argument(
        "--from", dest="from_date", required=True,
        metavar="YYYY-MM-DD", help="Start date for backfill",
    )
    parser.add_argument(
        "--to", dest="to_date",
        metavar="YYYY-MM-DD",
        default=datetime.utcnow().strftime("%Y-%m-%d"),
        help="End date (default: today)",
    )
    parser.add_argument(
        "--chunk-days", type=int, default=30,
        help="Days per API request (default 30). Use 7 for 1-min granularity.",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Show how many records would be imported without writing to Supabase",
    )
    parser.add_argument(
        "--api-url",
        default=ENGGENV_BASE,
        help=f"EnggEnv API base URL (default: {ENGGENV_BASE})",
    )

    args = parser.parse_args()

    # ── Validate dates ────────────────────────────────────────────────────────
    try:
        from_dt = datetime.strptime(args.from_date, "%Y-%m-%d").date()
    except ValueError:
        print(f"ERROR: --from must be YYYY-MM-DD, got '{args.from_date}'")
        sys.exit(1)

    try:
        to_dt = datetime.strptime(args.to_date, "%Y-%m-%d").date()
    except ValueError:
        print(f"ERROR: --to must be YYYY-MM-DD, got '{args.to_date}'")
        sys.exit(1)

    if from_dt > to_dt:
        print("ERROR: --from must be before --to")
        sys.exit(1)

    # ── Connect to Supabase ───────────────────────────────────────────────────
    if not args.dry_run:
        if not SUPABASE_URL or not SUPABASE_KEY:
            print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
            print("       Set them in .env or as environment variables")
            sys.exit(1)
        sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    else:
        sb = None
        print("DRY RUN — no data will be written to Supabase\n")

    # ── Resolve station ───────────────────────────────────────────────────────
    station      = None
    station_id   = None
    device_id    = args.device
    field_mapping = {}

    if args.station_id:
        if sb:
            res = sb.table("stations").select("*").eq("id", args.station_id).single().execute()
            station = res.data
            if not station:
                print(f"ERROR: Station {args.station_id} not found in Supabase")
                sys.exit(1)
            station_id    = station["id"]
            device_id     = station.get("device_id") or device_id
            field_mapping = station.get("field_mapping") or {}
            api_base      = station.get("api_base_url") or args.api_url
            print(f"Station: {station.get('name')} (device: {device_id})")
        else:
            station_id = args.station_id
            api_base   = args.api_url

    elif args.device:
        device_id = args.device
        api_base  = args.api_url
        if sb:
            # Try to find station by device_id
            res = sb.table("stations").select("*").eq("device_id", device_id).execute()
            stations = res.data or []
            if len(stations) == 1:
                station       = stations[0]
                station_id    = station["id"]
                field_mapping = station.get("field_mapping") or {}
                api_base      = station.get("api_base_url") or args.api_url
                print(f"Station: {station.get('name')} ({station_id})")
            elif len(stations) > 1:
                print(f"Multiple stations with device_id={device_id}:")
                for s in stations:
                    print(f"  {s['id']}  {s.get('name')}")
                print("Use --station-id to specify which one.")
                sys.exit(1)
            else:
                print(f"WARNING: No station found with device_id={device_id}")
                print("         Records will be stored with station_id=NULL — is this OK?")
                confirm = input("Continue? [y/N] ").strip().lower()
                if confirm != "y":
                    sys.exit(0)
                station_id = None
        else:
            station_id = None  # dry run

    if not device_id:
        print("ERROR: Could not determine device_id. Pass --device ENE04771 explicitly.")
        sys.exit(1)

    # ── Summary ───────────────────────────────────────────────────────────────
    total_chunks = sum(1 for _ in date_chunks(from_dt, to_dt, args.chunk_days))
    print(f"\nBackfill plan:")
    print(f"  Device:      {device_id}")
    print(f"  Station ID:  {station_id or '(none — dry run only)'}")
    print(f"  Date range:  {from_dt} → {to_dt}")
    print(f"  Chunk size:  {args.chunk_days} days")
    print(f"  API chunks:  {total_chunks}")
    print(f"  API base:    {api_base}")
    print()

    # ── Fetch & store ─────────────────────────────────────────────────────────
    total_fetched  = 0
    total_imported = 0
    total_errors   = 0

    with httpx.Client() as http:
        for i, (chunk_from, chunk_to) in enumerate(date_chunks(from_dt, to_dt, args.chunk_days), 1):
            print(f"[{i:3}/{total_chunks}] {chunk_from} → {chunk_to}", end="", flush=True)

            try:
                records = fetch_chunk(http, device_id, chunk_from, chunk_to, api_base)
                total_fetched += len(records)
                print(f"  fetched {len(records)}", end="", flush=True)

                if not records or args.dry_run:
                    print()
                    continue

                # Map records
                rows = [parse_record(r, station_id, field_mapping) for r in records]

                # Upsert in batches
                chunk_imported = 0
                chunk_errors   = 0
                for j in range(0, len(rows), UPSERT_BATCH):
                    batch = rows[j : j + UPSERT_BATCH]
                    try:
                        sb.table("readings").upsert(
                            batch, on_conflict="station_id,timestamp"
                        ).execute()
                        chunk_imported += len(batch)
                    except Exception as e:
                        print(f"\n  UPSERT ERROR (batch {j}): {e}", end="")
                        chunk_errors += len(batch)

                total_imported += chunk_imported
                total_errors   += chunk_errors
                print(f"  → stored {chunk_imported}", end="")
                if chunk_errors:
                    print(f"  ({chunk_errors} errors)", end="")
                print()

            except httpx.HTTPError as e:
                print(f"  HTTP ERROR: {e}")
                total_errors += 1
            except Exception as e:
                print(f"  ERROR: {e}")
                total_errors += 1

    # ── Update station last_data_at ───────────────────────────────────────────
    if sb and station_id and total_imported > 0:
        try:
            sb.table("stations").update({
                "last_data_at": datetime.utcnow().isoformat(),
            }).eq("id", station_id).execute()
        except Exception as e:
            print(f"\nWARNING: Could not update station last_data_at: {e}")

    # ── Final summary ─────────────────────────────────────────────────────────
    print()
    print("=" * 50)
    print(f"  Total fetched from API : {total_fetched:,}")
    if args.dry_run:
        print(f"  DRY RUN — nothing written")
    else:
        print(f"  Imported to Supabase   : {total_imported:,}")
        print(f"  Errors                 : {total_errors:,}")
    print("=" * 50)

    if total_errors > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
