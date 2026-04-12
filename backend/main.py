"""
AirWatch Backend — FastAPI
Polls EnggEnv, AQICN, OpenWeatherMap → stores in Supabase → WebSocket push
"""
import os, asyncio
from datetime import datetime, timedelta, date as date_type
from contextlib import asynccontextmanager
from typing import List, Optional

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from supabase import create_client

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
AQICN_TOKEN  = os.getenv("AQICN_TOKEN", "")
OWM_KEY      = os.getenv("OWM_API_KEY", "")

sb = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL else None

# ─────────────────────────────────────────────────────────────────────────────
# AQI calculation (US EPA PM2.5 breakpoints)
# ─────────────────────────────────────────────────────────────────────────────

def calc_aqi(pm25):
    if pm25 is None: return None
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
# EnggEnv field mapping (API key → Supabase column)
# Used by both live polling and backfill
# ─────────────────────────────────────────────────────────────────────────────

ENGGENV_FIELD_MAP = {
    "PM2.5":         "pm25",
    "PM10":          "pm10",
    "Temperature":   "temperature",
    "Humidity":      "humidity",
    "so2":           "so2",
    "no2":           "no2",
    "CO":            "co",
    "o3":            "o3",
    "ws":            "wind_speed",
    "Wind Direction":"wind_direction",
}

def parse_enggenv_record(raw: dict, station_id: str, field_mapping: dict = None) -> dict:
    """
    Convert a raw EnggEnv API record to a Supabase readings row.
    field_mapping (from station config) overrides defaults when provided.
    """
    m = field_mapping or {}

    def gf(api_key: str, db_col: str):
        # Allow station-level field_mapping to remap the api_key
        actual_key = m.get(db_col, m.get(api_key, api_key))
        v = raw.get(actual_key)
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    # Timestamp: "2025-12-03 19:34:23" → keep as-is for consistency with live polling
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

    if rec.get("pm25") is not None:
        rec["aqi"] = calc_aqi(rec["pm25"])

    return rec

# ─────────────────────────────────────────────────────────────────────────────
# Date-range chunking helper (no external deps)
# ─────────────────────────────────────────────────────────────────────────────

def date_chunks(from_date: date_type, to_date: date_type, chunk_days: int = 30):
    """Yield (from_str, to_str) in YYYY-MM-DD format, chunk_days at a time."""
    current = from_date
    while current <= to_date:
        end = min(current + timedelta(days=chunk_days - 1), to_date)
        yield current.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")
        current = end + timedelta(days=1)

# ─────────────────────────────────────────────────────────────────────────────
# Live polling functions
# ─────────────────────────────────────────────────────────────────────────────

async def poll_enggenv(client, station):
    url = station.get("api_base_url")
    did = station.get("device_id")
    if not url or not did: return None
    try:
        r = await client.get(f"{url}?action=getLatestData&device={did}", timeout=15)
        raw = r.json()
        if not raw.get("success"): return None
        data = raw.get("data", [None])[0]
        if not data: return None
        m = station.get("field_mapping", {})
        def gf(k):
            v = data.get(m.get(k, k))
            try: return float(v) if v is not None else None
            except (TypeError, ValueError): return None
        return {
            "station_id":     station["id"],
            "timestamp":      data.get("timestamp", datetime.utcnow().isoformat()),
            "pm25":           gf("PM2.5"),
            "pm10":           gf("pm10"),
            "so2":            gf("so2"),
            "no2":            gf("no2"),
            "o3":             gf("o3"),
            "co":             gf("co"),
            "temperature":    gf("temperature"),
            "humidity":       gf("humidity"),
            "pressure":       gf("pressure"),
            "wind_speed":     gf("wind_speed"),
            "wind_direction": gf("wind_direction"),
            "raw_data":       data,
            "source":         "enggenv",
        }
    except Exception as e:
        print(f"[EnggEnv] {station.get('name')}: {e}")
        return None

async def poll_aqicn(client, station):
    if not AQICN_TOKEN: return None
    try:
        r = await client.get(
            f"https://api.waqi.info/feed/geo:{station['latitude']};{station['longitude']}/?token={AQICN_TOKEN}",
            timeout=15,
        )
        d = r.json()
        if d.get("status") != "ok": return None
        dd = d["data"]; iaqi = dd.get("iaqi", {})
        return {
            "station_id":     station["id"],
            "timestamp":      datetime.utcnow().isoformat(),
            "aqi":            dd.get("aqi"),
            "pm25":           iaqi.get("pm25", {}).get("v"),
            "pm10":           iaqi.get("pm10", {}).get("v"),
            "no2":            iaqi.get("no2",  {}).get("v"),
            "o3":             iaqi.get("o3",   {}).get("v"),
            "so2":            iaqi.get("so2",  {}).get("v"),
            "co":             iaqi.get("co",   {}).get("v"),
            "temperature":    iaqi.get("t",    {}).get("v"),
            "humidity":       iaqi.get("h",    {}).get("v"),
            "wind_speed":     iaqi.get("w",    {}).get("v"),
            "source":         "aqicn",
        }
    except Exception as e:
        print(f"[AQICN] {station.get('name')}: {e}")
        return None

# ─────────────────────────────────────────────────────────────────────────────
# WebSocket manager
# ─────────────────────────────────────────────────────────────────────────────

class WSManager:
    def __init__(self): self.active = []
    async def connect(self, ws): await ws.accept(); self.active.append(ws)
    def disconnect(self, ws):
        if ws in self.active: self.active.remove(ws)
    async def broadcast(self, data):
        dead = []
        for ws in self.active:
            try: await ws.send_json(data)
            except: dead.append(ws)
        for ws in dead: self.active.remove(ws)

mgr = WSManager()

# ─────────────────────────────────────────────────────────────────────────────
# Poll loop
# ─────────────────────────────────────────────────────────────────────────────

async def poll_all():
    if not sb: return
    stations = sb.table("stations").select("*").eq("is_active", True).execute().data or []
    print(f"[Poll] {len(stations)} stations at {datetime.utcnow().isoformat()}")
    async with httpx.AsyncClient() as client:
        for s in stations:
            reading = None
            if s.get("api_base_url") and s.get("data_protocol") == "rest":
                reading = await poll_enggenv(client, s)
            if not reading:
                reading = await poll_aqicn(client, s)
            if not reading: continue
            if reading.get("aqi") is None and reading.get("pm25") is not None:
                reading["aqi"] = calc_aqi(reading["pm25"])
            try:
                sb.table("readings").upsert(reading, on_conflict="station_id,timestamp").execute()
                sb.table("stations").update({
                    "status": "online",
                    "last_data_at": reading["timestamp"],
                }).eq("id", s["id"]).execute()
                print(f"[Poll] ✓ {s['name']}: AQI={reading.get('aqi')}")
            except Exception as e:
                print(f"[Poll] DB error: {e}")
    await mgr.broadcast({"type": "update", "timestamp": datetime.utcnow().isoformat()})

scheduler = AsyncIOScheduler()

@asynccontextmanager
async def lifespan(app):
    pi = int(os.getenv("POLL_INTERVAL", "300"))
    asyncio.create_task(poll_all())
    scheduler.add_job(poll_all, "interval", seconds=pi)
    scheduler.start()
    yield
    scheduler.shutdown()

# ─────────────────────────────────────────────────────────────────────────────
# App
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(title="AirWatch API", version="2.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_URL", "http://localhost:5173"), "http://localhost:5173"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

@app.get("/")
def root(): return {"name": "AirWatch API", "version": "2.1.0"}

@app.get("/health")
def health(): return {"status": "healthy", "supabase": bool(sb), "aqicn": bool(AQICN_TOKEN)}

@app.post("/api/poll")
async def trigger_poll():
    await poll_all()
    return {"status": "ok"}

@app.websocket("/ws")
async def ws_ep(ws: WebSocket):
    await mgr.connect(ws)
    try:
        while True:
            d = await ws.receive_text()
            if d == "ping": await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        mgr.disconnect(ws)

# ─────────────────────────────────────────────────────────────────────────────
# Backfill endpoint
# ─────────────────────────────────────────────────────────────────────────────

class BackfillRequest(BaseModel):
    from_date: str          # YYYY-MM-DD
    to_date: Optional[str] = None  # YYYY-MM-DD — defaults to today
    chunk_days: int = 30    # days per API call (30 is safe; API returns full range)


@app.post("/api/backfill/{station_id}")
async def backfill_station(station_id: str, req: BackfillRequest):
    """
    Fetch historical data from the EnggEnv API and store it in Supabase.

    The EnggEnv API returns ALL records in a date range in a single response
    (the limit param is ignored when from/to are given), so we chunk by
    chunk_days to keep each request manageable.

    Returns a summary of records imported per chunk.
    """
    if not sb:
        raise HTTPException(status_code=503, detail="Database not connected")

    # ── Fetch station config ──────────────────────────────────────────────────
    result = sb.table("stations").select("*").eq("id", station_id).single().execute()
    station = result.data
    if not station:
        raise HTTPException(status_code=404, detail=f"Station {station_id} not found")

    api_url   = station.get("api_base_url")
    device_id = station.get("device_id")
    if not api_url or not device_id:
        raise HTTPException(
            status_code=400,
            detail="Station has no API configuration (api_base_url or device_id missing)",
        )

    field_mapping = station.get("field_mapping") or {}

    # ── Parse date range ──────────────────────────────────────────────────────
    try:
        from_dt = datetime.strptime(req.from_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="from_date must be YYYY-MM-DD")

    to_str = req.to_date or datetime.utcnow().strftime("%Y-%m-%d")
    try:
        to_dt = datetime.strptime(to_str, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="to_date must be YYYY-MM-DD")

    if from_dt > to_dt:
        raise HTTPException(status_code=400, detail="from_date must be before to_date")

    # ── Fetch & store, chunk by chunk ─────────────────────────────────────────
    total_imported = 0
    total_errors   = 0
    chunks: List[dict] = []

    UPSERT_BATCH = 500  # rows per Supabase upsert call

    async with httpx.AsyncClient() as client:
        for chunk_from, chunk_to in date_chunks(from_dt, to_dt, req.chunk_days):
            chunk_summary = {"chunk": f"{chunk_from} → {chunk_to}"}
            try:
                url = (
                    f"{api_url}?action=getDeviceData"
                    f"&device={device_id}"
                    f"&from={chunk_from}"
                    f"&to={chunk_to}"
                )
                print(f"[Backfill] Fetching {url}")
                resp = await client.get(url, timeout=120)
                resp.raise_for_status()
                body = resp.json()

                if not body.get("success"):
                    chunk_summary["status"]  = "api_error"
                    chunk_summary["message"] = body.get("message", "API returned success=false")
                    chunks.append(chunk_summary)
                    continue

                raw_records = body.get("data", [])
                chunk_summary["api_count"] = len(raw_records)

                if not raw_records:
                    chunk_summary["status"]   = "ok"
                    chunk_summary["imported"] = 0
                    chunks.append(chunk_summary)
                    continue

                # Map API records → Supabase rows
                rows = [parse_enggenv_record(r, station_id, field_mapping) for r in raw_records]

                # Upsert in batches
                imported_this_chunk = 0
                errors_this_chunk   = 0
                for i in range(0, len(rows), UPSERT_BATCH):
                    batch = rows[i : i + UPSERT_BATCH]
                    try:
                        sb.table("readings").upsert(
                            batch, on_conflict="station_id,timestamp"
                        ).execute()
                        imported_this_chunk += len(batch)
                    except Exception as e:
                        print(f"[Backfill] Upsert error (batch {i}): {e}")
                        errors_this_chunk += len(batch)

                total_imported    += imported_this_chunk
                total_errors      += errors_this_chunk
                chunk_summary["status"]   = "ok"
                chunk_summary["imported"] = imported_this_chunk
                chunk_summary["errors"]   = errors_this_chunk
                print(
                    f"[Backfill] {chunk_from}→{chunk_to}: "
                    f"{imported_this_chunk} imported, {errors_this_chunk} errors"
                )

            except httpx.HTTPError as e:
                print(f"[Backfill] HTTP error for {chunk_from}→{chunk_to}: {e}")
                chunk_summary["status"]  = "http_error"
                chunk_summary["message"] = str(e)
                total_errors += 1

            except Exception as e:
                print(f"[Backfill] Unexpected error for {chunk_from}→{chunk_to}: {e}")
                chunk_summary["status"]  = "error"
                chunk_summary["message"] = str(e)
                total_errors += 1

            chunks.append(chunk_summary)

    # Update station last_data_at
    if total_imported > 0:
        try:
            sb.table("stations").update({
                "last_data_at": datetime.utcnow().isoformat(),
            }).eq("id", station_id).execute()
        except Exception as e:
            print(f"[Backfill] Could not update station last_data_at: {e}")

    return {
        "station_id":   station_id,
        "station_name": station.get("name"),
        "from_date":    req.from_date,
        "to_date":      to_str,
        "imported":     total_imported,
        "errors":       total_errors,
        "chunks":       chunks,
    }
