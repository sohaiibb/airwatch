"""
AirWatch Backend — FastAPI
Polls EnggEnv, AQICN, OpenWeatherMap → stores in Supabase → WebSocket push
"""
import os, asyncio, threading
from datetime import datetime, timedelta, timezone, date as date_type
from contextlib import asynccontextmanager
from typing import List, Optional

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from supabase import create_client
from alerts import AlertEngine

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
DATABASE_URL = os.getenv("DATABASE_URL", "")   # optional: for auto-migration
AQICN_TOKEN  = os.getenv("AQICN_TOKEN", "")
OWM_KEY      = os.getenv("OWM_API_KEY", "")

sb = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL else None
alert_engine = AlertEngine(sb) if sb else None

# ─────────────────────────────────────────────────────────────────────────────
# Alert table migration — runs at startup if DATABASE_URL is set
# ─────────────────────────────────────────────────────────────────────────────

ALERT_MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS alert_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id       UUID        NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  pollutant        TEXT        NOT NULL,
  period           TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'warning',
  measured_value   NUMERIC,
  threshold        NUMERIC     NOT NULL,
  warning_pct      INTEGER     DEFAULT 80,
  started_at       TIMESTAMPTZ DEFAULT NOW(),
  last_notified_at TIMESTAMPTZ,
  cleared_at       TIMESTAMPTZ,
  peak_value       NUMERIC,
  peak_at          TIMESTAMPTZ,
  hour_count       INTEGER     DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS alert_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID REFERENCES alert_events(id) ON DELETE SET NULL,
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  details    JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS alert_subscribers (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id       UUID    REFERENCES stations(id) ON DELETE CASCADE,
  email            TEXT    NOT NULL,
  name             TEXT,
  whatsapp_number  TEXT,
  email_enabled    BOOLEAN DEFAULT TRUE,
  whatsapp_enabled BOOLEAN DEFAULT FALSE,
  role             TEXT    DEFAULT 'client',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS system_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO system_settings (key, value)
VALUES ('email_config', '{"provider": null, "configured": false}')
ON CONFLICT (key) DO NOTHING;
INSERT INTO alert_rules (station_id, pollutant, period, threshold, warning_pct, enabled, is_custom)
VALUES
  (NULL,'pm25','24-hour',35,80,TRUE,FALSE),(NULL,'pm10','24-hour',340,80,TRUE,FALSE),
  (NULL,'so2','1-hour',441,80,TRUE,FALSE),(NULL,'so2','24-hour',217,80,TRUE,FALSE),
  (NULL,'no2','1-hour',200,80,TRUE,FALSE),(NULL,'o3','8-hour',157,80,TRUE,FALSE),
  (NULL,'co','1-hour',40000,80,TRUE,FALSE),(NULL,'co','8-hour',10000,80,TRUE,FALSE)
ON CONFLICT DO NOTHING;
"""

def run_alert_migration():
    """Auto-create missing alert tables if DATABASE_URL is configured."""
    if not DATABASE_URL:
        return
    try:
        import psycopg2
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute(ALERT_MIGRATION_SQL)
        cur.close()
        conn.close()
        print("[Migrate] ✓ Alert tables verified/created via DATABASE_URL")
    except Exception as e:
        print(f"[Migrate] WARNING: Could not auto-migrate alert tables: {e}")

def check_alert_db_health() -> dict:
    """Check whether alert tables exist. Returns status dict."""
    if not sb:
        return {"healthy": False, "reason": "Supabase not connected"}
    missing = []
    for tbl in ["alert_events", "alert_log", "alert_rules", "alert_subscribers"]:
        try:
            sb.table(tbl).select("id").limit(1).execute()
        except Exception:
            missing.append(tbl)
    if missing:
        return {
            "healthy": False,
            "missing_tables": missing,
            "fix": "Run database/alerts_schema.sql in the Supabase SQL editor, "
                   "or set DATABASE_URL env var for auto-migration.",
        }
    return {"healthy": True, "tables": ["alert_events", "alert_log", "alert_rules", "alert_subscribers"]}

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

# EnggEnv API returns timestamps in AST (Arabia Standard Time, UTC+3).
# Subtract 3h to store as UTC so the browser (UTC+3) restores the correct local time.
_AST_OFFSET = timedelta(hours=3)

def enggenv_ts_to_utc(ts_str: str) -> str:
    """Convert an EnggEnv AST timestamp to UTC (subtract 3h) for storage."""
    try:
        dt_ast = datetime.strptime(ts_str.strip(), "%Y-%m-%d %H:%M:%S")
        return (dt_ast - _AST_OFFSET).strftime("%Y-%m-%d %H:%M:%S")
    except (ValueError, AttributeError):
        return ts_str

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

    # EnggEnv returns AST — subtract 3h to store as UTC
    raw_ts = raw.get("timestamp", datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"))
    ts = enggenv_ts_to_utc(raw_ts)

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
        raw_ts = data.get("timestamp") or datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        return {
            "station_id":     station["id"],
            "timestamp":      enggenv_ts_to_utc(raw_ts),
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
        # AQICN iaqi.*.v values are AQI sub-index numbers (0-500), NOT µg/m³.
        # Only use AQI + met data; exclude individual pollutant concentrations
        # to prevent contaminating EnggEnv µg/m³ readings with sub-index values.
        return {
            "station_id":     station["id"],
            "timestamp":      datetime.utcnow().isoformat(),
            "aqi":            dd.get("aqi"),
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


async def _startup_background():
    """Run non-critical startup tasks after the server is already accepting requests."""
    # Auto-migrate alert tables (fast DDL; no-op if DATABASE_URL not set)
    run_alert_migration()
    # Log DB health — purely informational, doesn't block startup
    health = check_alert_db_health()
    if not health["healthy"]:
        print("\n" + "="*60)
        print("[ALERT ENGINE] ⚠️  DATABASE TABLES MISSING")
        print(f"  Missing: {health.get('missing_tables', [])}")
        print(f"  Fix: Run database/alerts_schema.sql in the Supabase SQL editor")
        print("="*60 + "\n")
    else:
        print("[ALERT ENGINE] ✓ All alert tables present")
    # First poll + alert check
    await poll_all()
    if alert_engine:
        await asyncio.to_thread(alert_engine.run)


@asynccontextmanager
async def lifespan(app):
    pi = int(os.getenv("POLL_INTERVAL", "300"))
    # Schedule recurring jobs
    scheduler.add_job(poll_all, "interval", seconds=pi)
    if alert_engine:
        scheduler.add_job(alert_engine.run, "interval", seconds=300, id="alert_check")
    scheduler.start()
    # Fire startup tasks in background — server is already healthy by this point
    asyncio.create_task(_startup_background())
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

@app.get("/api/alerts/db-health")
def alerts_db_health():
    """Check whether alert tables exist and alert engine is functional."""
    return check_alert_db_health()

@app.post("/api/poll")
async def trigger_poll():
    await poll_all()
    return {"status": "ok"}

@app.post("/api/migrate/fix-timestamps")
async def fix_timestamps():
    """One-time endpoint: subtract 3h from all enggenv readings. Call once, then ignore."""
    if not sb:
        raise HTTPException(503, "No Supabase")
    try:
        result = sb.table("system_settings").select("value").eq("key", "utc_to_ast_done").execute()
        if result.data:
            return {"status": "already_done"}
    except Exception:
        pass

    total = 0
    offset = 0
    while True:
        batch = sb.table("readings").select("id, timestamp").eq("source", "enggenv").order("timestamp").range(offset, offset + 499).execute()
        if not batch.data:
            break
        for row in batch.data:
            try:
                old_ts = row["timestamp"]
                if "T" in old_ts:
                    dt = datetime.fromisoformat(old_ts.replace("Z", "+00:00").replace("+00:00", ""))
                else:
                    dt = datetime.strptime(old_ts, "%Y-%m-%d %H:%M:%S")
                new_ts = (dt - timedelta(hours=3)).strftime("%Y-%m-%d %H:%M:%S")
                sb.table("readings").update({"timestamp": new_ts}).eq("id", row["id"]).execute()
                total += 1
            except Exception:
                pass
        offset += 500

    sb.table("system_settings").upsert(
        {"key": "utc_to_ast_done", "value": {"done": True, "count": total}},
        on_conflict="key"
    ).execute()
    return {"status": "done", "fixed": total}

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
# Alerts API
# ─────────────────────────────────────────────────────────────────────────────

class PushSubscription(BaseModel):
    endpoint: str
    p256dh: str
    auth: str
    user_id: Optional[str] = None

class RuleUpdate(BaseModel):
    enabled: Optional[bool] = None
    warning_pct: Optional[int] = None
    threshold: Optional[float] = None

class RuleCreate(BaseModel):
    station_id: Optional[str] = None
    pollutant: str
    period: str
    threshold: float
    warning_pct: int = 80

class SubscriberCreate(BaseModel):
    station_id: Optional[str] = None
    email: str
    name: Optional[str] = None
    email_enabled: bool = True
    role: str = "client"

class EmailSettings(BaseModel):
    provider: Optional[str] = None
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_pass: Optional[str] = None
    from_email: Optional[str] = None
    resend_api_key: Optional[str] = None

def require_sb():
    if not sb: raise HTTPException(503, "Database not connected")

@app.get("/api/alerts/active")
def get_active_alerts(station_id: Optional[str] = None):
    require_sb()
    q = sb.table("alert_events").select("*, stations(name)").neq("status", "cleared").order("updated_at", desc=True)
    if station_id: q = q.eq("station_id", station_id)
    return q.execute().data or []

@app.get("/api/alerts/history")
def get_alert_history(station_id: Optional[str] = None, limit: int = 50, offset: int = 0):
    require_sb()
    q = (sb.table("alert_log")
         .select("*, stations(name)")
         .order("created_at", desc=True)
         .limit(limit)
         .offset(offset))
    if station_id: q = q.eq("station_id", station_id)
    return q.execute().data or []

@app.get("/api/alerts/rules")
def get_alert_rules(station_id: Optional[str] = None):
    require_sb()
    # Global rules
    global_r = sb.table("alert_rules").select("*").is_("station_id", "null").execute().data or []
    if station_id:
        station_r = sb.table("alert_rules").select("*").eq("station_id", station_id).execute().data or []
        overrides = {(r["pollutant"], r["period"]): r for r in station_r}
        merged = {}
        for r in global_r:
            k = (r["pollutant"], r["period"])
            merged[k] = overrides.get(k, r)
        return list(merged.values()) + [r for r in station_r if r.get("is_custom")]
    return global_r

@app.put("/api/alerts/rules/{rule_id}")
def update_alert_rule(rule_id: str, body: RuleUpdate):
    require_sb()
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if not updates: raise HTTPException(400, "No fields to update")
    sb.table("alert_rules").update(updates).eq("id", rule_id).execute()
    return {"ok": True}

@app.post("/api/alerts/rules")
def create_alert_rule(body: RuleCreate):
    require_sb()
    row = body.dict()
    res = sb.table("alert_rules").insert({**row, "is_custom": True}).execute()
    return res.data[0] if res.data else {}

@app.delete("/api/alerts/rules/{rule_id}")
def delete_alert_rule(rule_id: str):
    require_sb()
    sb.table("alert_rules").delete().eq("id", rule_id).execute()
    return {"ok": True}

@app.get("/api/alerts/subscribers")
def get_alert_subscribers(station_id: Optional[str] = None):
    require_sb()
    q = sb.table("alert_subscribers").select("*, stations(name)").order("created_at")
    if station_id: q = q.eq("station_id", station_id)
    return q.execute().data or []

@app.post("/api/alerts/subscribers")
def create_subscriber(body: SubscriberCreate):
    require_sb()
    res = sb.table("alert_subscribers").insert(body.dict()).execute()
    return res.data[0] if res.data else {}

@app.delete("/api/alerts/subscribers/{sub_id}")
def delete_subscriber(sub_id: str):
    require_sb()
    sb.table("alert_subscribers").delete().eq("id", sub_id).execute()
    return {"ok": True}

@app.post("/api/alerts/test")
def send_test_alert(station_id: str):
    require_sb()
    station = sb.table("stations").select("id, name").eq("id", station_id).single().execute().data
    if not station: raise HTTPException(404, "Station not found")
    if not alert_engine: raise HTTPException(503, "Alert engine not initialized")
    alert_engine.send_notification(
        station_name=station["name"], station_id=station_id,
        event_id=None, subject=f"🧪 AirWatch Test Alert — {station['name']}",
        alerts_batch=[{"pollutant": "pm25", "period": "24-hour",
                       "measured": 28.5, "threshold": 35,
                       "status": "test", "tier": "test"}],
        tier="test",
    )
    return {"ok": True, "message": f"Test notification queued for {station['name']}"}

@app.get("/api/alerts/settings")
def get_email_settings():
    require_sb()
    res = sb.table("system_settings").select("value").eq("key", "email_config").single().execute()
    return res.data["value"] if res.data else {}

@app.put("/api/alerts/settings")
async def update_email_settings(body: dict):
    require_sb()
    from fastapi import Request
    current = (sb.table("system_settings").select("value").eq("key", "email_config")
               .single().execute().data or {}).get("value", {})
    # Mask password in storage — store as-is for now (configure SMTP properly later)
    merged = {**current, **body, "configured": bool(body.get("provider"))}
    sb.table("system_settings").upsert({"key": "email_config", "value": merged}).execute()
    return {"ok": True}

@app.post("/api/alerts/run")
def trigger_alert_check():
    """Manually trigger an alert check (admin use)."""
    if not alert_engine: raise HTTPException(503, "Alert engine not initialized")
    import threading
    threading.Thread(target=alert_engine.run, daemon=True).start()
    return {"ok": True, "message": "Alert check started"}

# ─────────────────────────────────────────────────────────────────────────────
# Generic Settings API
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/settings")
def get_all_settings():
    require_sb()
    rows = sb.table("system_settings").select("key,value").execute()
    return {r["key"]: r["value"] for r in (rows.data or [])}

@app.get("/api/settings/{key}")
def get_setting(key: str):
    require_sb()
    res = sb.table("system_settings").select("value").eq("key", key).single().execute()
    return res.data["value"] if res.data else {}

@app.put("/api/settings/{key}")
async def put_setting(key: str, body: dict):
    require_sb()
    sb.table("system_settings").upsert({"key": key, "value": body}).execute()
    return {"ok": True}

# ── Push Subscriptions ────────────────────────────────────────────────────────

@app.post("/api/push/subscribe")
def push_subscribe(body: PushSubscription):
    require_sb()
    data = body.dict()
    # Upsert by endpoint
    sb.table("push_subscriptions").upsert(data, on_conflict="endpoint").execute()
    return {"ok": True}

@app.delete("/api/push/subscribe")
def push_unsubscribe(endpoint: str):
    require_sb()
    sb.table("push_subscriptions").delete().eq("endpoint", endpoint).execute()
    return {"ok": True}

@app.get("/api/push/vapid-public-key")
def push_vapid_key():
    key = os.getenv("VAPID_PUBLIC_KEY", "")
    return {"key": key}

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

# ─────────────────────────────────────────────────────────────────────────────
# Client Management API
# ─────────────────────────────────────────────────────────────────────────────
import secrets, string

def _gen_temp_password(length: int = 16) -> str:
    chars = string.ascii_letters + string.digits + "!@#$%"
    return ''.join(secrets.choice(chars) for _ in range(length))

def _default_permissions() -> list:
    """Return default permission rows for a new client org."""
    return [
        {
            "permission_type": "page_access",
            "permission_value": {"dashboard": True, "charts": True, "data": True, "reports": True,
                                  "compliance": False, "wind_rose": False, "alerts": True},
        },
        {
            "permission_type": "visible_parameters",
            "permission_value": {"pm25": True, "pm10": True, "so2": True, "no2": True, "o3": True,
                                  "co": True, "temp": True, "rh": True, "ws": True, "wd": True},
        },
        {
            "permission_type": "report_access",
            "permission_value": {"preview": True, "pdf": True, "csv": False, "excel": False,
                                  "max_days": 30, "averaging": ["1-hour", "24-hour"]},
        },
        {
            "permission_type": "data_access",
            "permission_value": {"raw": False, "1min": False, "hourly": True, "daily": True,
                                  "csv": False, "excel": False, "max_days": 30},
        },
        {
            "permission_type": "dashboard_access",
            "permission_value": {"aqi": True, "map": True, "health": True, "ncec": False, "sparklines": True},
        },
    ]

# ── Organizations ─────────────────────────────────────────────────────────────

@app.get("/api/organizations")
def list_organizations():
    require_sb()
    orgs = sb.table("organizations").select("*").neq("slug", "hfcl").order("name").execute().data or []
    for org in orgs:
        stations_count = len(sb.table("station_assignments").select("id").eq("organization_id", org["id"]).execute().data or [])
        users_count = len(sb.table("profiles").select("id").eq("org_id", org["id"]).execute().data or [])
        org["stations_count"] = stations_count
        org["users_count"] = users_count
    return orgs

@app.post("/api/organizations")
async def create_organization(body: dict):
    require_sb()
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(400, "Organization name is required")
    slug = name.lower().replace(" ", "-").replace("_", "-")[:50]
    row = {
        "name": name,
        "slug": slug,
        "contact_name": body.get("contact_name"),
        "contact_email": body.get("contact_email"),
        "contact_phone": body.get("contact_phone"),
        "address": body.get("address"),
        "is_active": True,
    }
    res = sb.table("organizations").insert(row).execute()
    org = res.data[0] if res.data else {}
    # Insert default permissions (org-level, station_id=null)
    if org.get("id"):
        for perm in _default_permissions():
            sb.table("client_permissions").upsert({
                "organization_id": org["id"],
                "station_id": None,
                **perm,
            }).execute()
    return org

@app.put("/api/organizations/{org_id}")
async def update_organization(org_id: str, body: dict):
    require_sb()
    allowed = {"name", "contact_name", "contact_email", "contact_phone", "address", "is_active"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(400, "No valid fields to update")
    sb.table("organizations").update(updates).eq("id", org_id).execute()
    return {"ok": True}

@app.delete("/api/organizations/{org_id}")
def delete_organization(org_id: str):
    require_sb()
    # Cascade: station_assignments, client_permissions, profiles are FK-cascaded
    # Delete auth users first
    profiles = sb.table("profiles").select("id").eq("org_id", org_id).execute().data or []
    for p in profiles:
        try:
            sb.auth.admin.delete_user(p["id"])
        except Exception:
            pass
    sb.table("organizations").delete().eq("id", org_id).execute()
    return {"ok": True}

# ── Station Assignments ────────────────────────────────────────────────────────

@app.get("/api/organizations/{org_id}/stations")
def get_org_stations(org_id: str):
    require_sb()
    rows = (sb.table("station_assignments")
            .select("*, stations(id, name, device_id, status, is_active, latitude, longitude)")
            .eq("organization_id", org_id)
            .execute().data or [])
    return [{"assignment_id": r["id"], **r["stations"]} for r in rows if r.get("stations")]

@app.post("/api/organizations/{org_id}/stations")
async def assign_station(org_id: str, body: dict):
    require_sb()
    station_id = body.get("station_id")
    if not station_id:
        raise HTTPException(400, "station_id required")
    sb.table("station_assignments").upsert({"organization_id": org_id, "station_id": station_id}).execute()
    return {"ok": True}

@app.delete("/api/organizations/{org_id}/stations/{station_id}")
def unassign_station(org_id: str, station_id: str):
    require_sb()
    sb.table("station_assignments").delete().eq("organization_id", org_id).eq("station_id", station_id).execute()
    return {"ok": True}

# ── Users (Profiles) ──────────────────────────────────────────────────────────

@app.get("/api/organizations/{org_id}/users")
def get_org_users(org_id: str):
    require_sb()
    return sb.table("profiles").select("*").eq("org_id", org_id).order("created_at").execute().data or []

@app.post("/api/organizations/{org_id}/users")
async def invite_user(org_id: str, body: dict):
    require_sb()
    email = (body.get("email") or "").strip()
    name  = (body.get("full_name") or "").strip()
    role  = body.get("role", "viewer")
    if not email:
        raise HTTPException(400, "email is required")
    temp_pass = _gen_temp_password()
    try:
        res = sb.auth.admin.create_user({
            "email": email,
            "password": temp_pass,
            "email_confirm": True,
            "user_metadata": {"full_name": name},
        })
        user_id = res.user.id
    except Exception as e:
        raise HTTPException(400, f"Failed to create auth user: {e}")
    sb.table("profiles").upsert({
        "id": user_id,
        "org_id": org_id,
        "full_name": name,
        "email": email,
        "role": role,
        "is_active": True,
    }).execute()
    # Trigger password reset so user sets their own password
    reset_url = None
    try:
        link = sb.auth.admin.generate_link({
            "type": "recovery",
            "email": email,
            "options": {"redirect_to": os.getenv("FRONTEND_URL", "")},
        })
        reset_url = getattr(getattr(link, "properties", None), "action_link", None)
    except Exception:
        pass
    return {"user_id": user_id, "email": email, "reset_url": reset_url, "temp_password": temp_pass}

@app.put("/api/organizations/{org_id}/users/{user_id}")
async def update_org_user(org_id: str, user_id: str, body: dict):
    require_sb()
    allowed = {"role", "is_active", "full_name", "phone"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if updates:
        sb.table("profiles").update(updates).eq("id", user_id).eq("org_id", org_id).execute()
    return {"ok": True}

@app.delete("/api/organizations/{org_id}/users/{user_id}")
def deactivate_user(org_id: str, user_id: str):
    require_sb()
    sb.table("profiles").update({"is_active": False}).eq("id", user_id).eq("org_id", org_id).execute()
    return {"ok": True}

# ── Permissions ───────────────────────────────────────────────────────────────

@app.get("/api/organizations/{org_id}/permissions")
def get_org_permissions(org_id: str, station_id: Optional[str] = None):
    require_sb()
    q = sb.table("client_permissions").select("*").eq("organization_id", org_id)
    if station_id:
        q = q.eq("station_id", station_id)
    return q.execute().data or []

@app.put("/api/organizations/{org_id}/permissions")
async def update_org_permissions(org_id: str, body: dict):
    """
    body: { station_id: str|null, permission_type: str, permission_value: dict }
    """
    require_sb()
    rows = body if isinstance(body, list) else [body]
    for row in rows:
        sb.table("client_permissions").upsert({
            "organization_id": org_id,
            "station_id": row.get("station_id"),
            "permission_type": row["permission_type"],
            "permission_value": row["permission_value"],
        }).execute()
    return {"ok": True}
