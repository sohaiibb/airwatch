"""
AirWatch Backend — FastAPI
Polls EnggEnv, AQICN, OpenWeatherMap → stores in Supabase → WebSocket push
"""
import os, asyncio
from datetime import datetime
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from supabase import create_client

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
AQICN_TOKEN = os.getenv("AQICN_TOKEN", "")
OWM_KEY = os.getenv("OWM_API_KEY", "")

sb = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL else None

async def poll_enggenv(client, station):
    url = station.get("api_base_url")
    did = station.get("device_id")
    if not url or not did: return None
    try:
        r = await client.get(f"{url}/getLatestData/{did}", timeout=15)
        raw = r.json()
        data = raw[0] if isinstance(raw, list) else raw
        if not data: return None
        m = station.get("field_mapping", {})
        gf = lambda k: (lambda v: float(v) if v is not None else None)(data.get(m.get(k, k)))
        return {"station_id": station["id"], "timestamp": data.get("timestamp", datetime.utcnow().isoformat()),
                "pm25": gf("pm25"), "pm10": gf("pm10"), "so2": gf("so2"), "no2": gf("no2"),
                "o3": gf("o3"), "co": gf("co"), "temperature": gf("temperature"),
                "humidity": gf("humidity"), "pressure": gf("pressure"),
                "wind_speed": gf("wind_speed"), "wind_direction": gf("wind_direction"),
                "raw_data": data, "source": "enggenv"}
    except Exception as e:
        print(f"[EnggEnv] {station.get('name')}: {e}")
        return None

async def poll_aqicn(client, station):
    if not AQICN_TOKEN: return None
    try:
        r = await client.get(f"https://api.waqi.info/feed/geo:{station['latitude']};{station['longitude']}/?token={AQICN_TOKEN}", timeout=15)
        d = r.json()
        if d.get("status") != "ok": return None
        dd = d["data"]; iaqi = dd.get("iaqi", {})
        return {"station_id": station["id"], "timestamp": datetime.utcnow().isoformat(),
                "aqi": dd.get("aqi"), "pm25": iaqi.get("pm25",{}).get("v"), "pm10": iaqi.get("pm10",{}).get("v"),
                "no2": iaqi.get("no2",{}).get("v"), "o3": iaqi.get("o3",{}).get("v"),
                "so2": iaqi.get("so2",{}).get("v"), "co": iaqi.get("co",{}).get("v"),
                "temperature": iaqi.get("t",{}).get("v"), "humidity": iaqi.get("h",{}).get("v"),
                "wind_speed": iaqi.get("w",{}).get("v"), "source": "aqicn"}
    except Exception as e:
        print(f"[AQICN] {station.get('name')}: {e}")
        return None

def calc_aqi(pm25):
    if pm25 is None: return None
    bps = [(0,12,0,50),(12.1,35.4,51,100),(35.5,55.4,101,150),(55.5,150.4,151,200),(150.5,250.4,201,300),(250.5,350.4,301,400),(350.5,500.4,401,500)]
    for bl,bh,al,ah in bps:
        if bl <= pm25 <= bh: return round(((ah-al)/(bh-bl))*(pm25-bl)+al)
    return min(round(pm25*2), 500)

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
                sb.table("stations").update({"status":"online","last_data_at":reading["timestamp"]}).eq("id",s["id"]).execute()
                print(f"[Poll] ✓ {s['name']}: AQI={reading.get('aqi')}")
            except Exception as e: print(f"[Poll] DB error: {e}")
    await mgr.broadcast({"type":"update","timestamp":datetime.utcnow().isoformat()})

scheduler = AsyncIOScheduler()

@asynccontextmanager
async def lifespan(app):
    pi = int(os.getenv("POLL_INTERVAL","300"))
    asyncio.create_task(poll_all())
    scheduler.add_job(poll_all,"interval",seconds=pi)
    scheduler.start()
    yield
    scheduler.shutdown()

app = FastAPI(title="AirWatch API", version="2.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[os.getenv("FRONTEND_URL","http://localhost:5173"),"http://localhost:5173"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.get("/")
def root(): return {"name":"AirWatch API","version":"2.1.0"}

@app.get("/health")
def health(): return {"status":"healthy","supabase":bool(sb),"aqicn":bool(AQICN_TOKEN)}

@app.post("/api/poll")
async def trigger_poll():
    await poll_all()
    return {"status":"ok"}

@app.websocket("/ws")
async def ws_ep(ws: WebSocket):
    await mgr.connect(ws)
    try:
        while True:
            d = await ws.receive_text()
            if d == "ping": await ws.send_json({"type":"pong"})
    except WebSocketDisconnect: mgr.disconnect(ws)
