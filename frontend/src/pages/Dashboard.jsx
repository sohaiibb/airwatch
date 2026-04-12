import { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMap } from 'react-leaflet';
import { Wind, AlertTriangle, CheckCircle, TrendingUp, TrendingDown } from 'lucide-react';
import { BarChart, Bar, Cell, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { getStations, getLatestReadings, getDemoStations, getDemoReadings, getDemoHistory } from '../lib/supabase';
import { glass, glassInner, getAqiLevel, POLLUTANTS, formatTime } from '../lib/utils';

// ─── Beaufort / compass helpers ───
const BEAUFORT = [[0.2,'Calm'],[1.5,'Light Air'],[3.3,'Light Breeze'],[5.4,'Gentle Breeze'],[7.9,'Moderate Breeze'],[10.7,'Fresh Breeze'],[Infinity,'Strong']];
function beaufort(v) { for (const [max, lbl] of BEAUFORT) if ((v||0) <= max) return lbl; return 'Strong'; }
function degToCard(d) { if (d==null) return '—'; const dirs=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']; return dirs[Math.round(((d%360)+360)%360/22.5)%16]; }

function getAqiBarColor(aqi) {
  if (!aqi) return 'var(--border)';
  if (aqi <= 50) return '#16A34A';
  if (aqi <= 100) return '#CA8A04';
  if (aqi <= 150) return '#EA580C';
  if (aqi <= 200) return '#DC2626';
  return '#7C3AED';
}

// Updates map view when selected station changes
function MapCenterUpdater({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center[0] && center[1]) map.setView(center, 11, { animate: true, duration: 0.8 });
  }, [center[0], center[1]]);
  return null;
}

// AQI ring SVG gauge
function AQIRing({ aqi, color, size = 90 }) {
  const r = (size - 10) / 2, cx = size / 2, cy = size / 2;
  const c = 2 * Math.PI * r;
  const dash = Math.min((aqi || 0) / 300, 1) * c;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(120,113,108,0.15)" strokeWidth={6} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={6}
          strokeDasharray={`${dash} ${c}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 1s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>{aqi || '—'}</span>
        <span style={{ fontSize: 8, color: 'var(--text-faint)', marginTop: 1 }}>US AQI</span>
      </div>
    </div>
  );
}

// Wind compass SVG
function WindCompassSVG({ direction, size = 80 }) {
  const cx = size / 2, cy = size / 2, r = (size - 8) / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
      {Array.from({ length: 8 }, (_, i) => {
        const a = i * 45 * Math.PI / 180, len = i % 2 === 0 ? 6 : 3;
        return <line key={i}
          x1={cx + Math.sin(a) * (r - len)} y1={cy - Math.cos(a) * (r - len)}
          x2={cx + Math.sin(a) * r} y2={cy - Math.cos(a) * r}
          stroke="rgba(255,255,255,0.4)" strokeWidth={i % 2 === 0 ? 1.5 : 0.8} />;
      })}
      {[['N',0],['E',90],['S',180],['W',270]].map(([l, d]) => {
        const a = d * Math.PI / 180, lr = r - 11;
        return <text key={l} x={cx + Math.sin(a)*lr} y={cy - Math.cos(a)*lr}
          textAnchor="middle" dominantBaseline="middle"
          fontSize={8} fontWeight="700" fill="rgba(255,255,255,0.7)" fontFamily="var(--font)">{l}</text>;
      })}
      <g style={{ transform: `rotate(${direction || 0}deg)`, transformOrigin: `${cx}px ${cy}px`, transition: 'transform 0.8s cubic-bezier(0.34,1.56,0.64,1)' }}>
        <polygon points={`${cx},${cy-r+14} ${cx-3},${cy+8} ${cx+3},${cy+8}`} fill="#0d9488" fillOpacity={0.95} />
        <polygon points={`${cx},${cy+r-14} ${cx-2},${cy-8} ${cx+2},${cy-8}`} fill="rgba(255,255,255,0.25)" />
      </g>
      <circle cx={cx} cy={cy} r={3} fill="rgba(255,255,255,0.8)" />
    </svg>
  );
}

// PollutantCard — 6 of these in Row 2
function PollutantCard({ pollutant, value, sparkPoints, isMobile }) {
  const { key, name, color, unit, threshold } = pollutant;
  const exceeded = value != null && value > threshold;
  const pct = value != null ? Math.round((value / threshold) * 100) : null;
  const vals = sparkPoints.map(d => d[key]).filter(v => v != null && !isNaN(v));
  const half = Math.floor(vals.length / 2);
  const trendUp = vals.length >= 4 ? vals[vals.length - 1] > vals[half] : null;
  const trendPct = vals.length >= 4 ? Math.abs(((vals[vals.length-1] - vals[half]) / (vals[half] || 1)) * 100).toFixed(0) : null;
  const last10 = sparkPoints.slice(-10).map((d, i) => ({ i, v: d[key] || 0 }));
  return (
    <div style={{
      ...glass({ padding: '11px 12px', borderRadius: 16 }),
      borderTop: exceeded ? 'none' : `2px solid ${color}`,
      borderLeft: exceeded ? '3px solid #DC2626' : undefined,
      position: 'relative',
    }}>
      {exceeded && (
        <div style={{ position: 'absolute', top: 7, right: 7, width: 15, height: 15, borderRadius: '50%', background: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 9, fontWeight: 900, color: '#fff', lineHeight: 1 }}>!</span>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 3 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{name}</span>
        {trendUp !== null && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 9, fontWeight: 700, color: trendUp ? '#DC2626' : '#16A34A' }}>
            {trendUp ? <TrendingUp size={9} /> : <TrendingDown size={9} />}{trendPct}%
          </span>
        )}
      </div>
      <p style={{ fontFamily: 'var(--mono)', fontSize: isMobile ? 20 : 22, fontWeight: 700, color: exceeded ? '#DC2626' : 'var(--text)', margin: 0, lineHeight: 1.1 }}>
        {value != null ? Number(value).toFixed(1) : '—'}
      </p>
      <p style={{ fontSize: 9, color: 'var(--text-faint)', margin: '0 0 5px', fontFamily: 'var(--mono)' }}>{unit}</p>
      <div style={{ height: 28, marginBottom: 5 }}>
        <ResponsiveContainer width="100%" height={28}>
          <BarChart data={last10} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barCategoryGap={1}>
            <Bar dataKey="v" fill={exceeded ? '#DC262660' : `${color}80`} radius={[1, 1, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ background: 'rgba(0,0,0,0.07)', borderRadius: 3, height: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(pct || 0, 100)}%`, height: '100%', background: exceeded ? '#DC2626' : `${color}CC`, borderRadius: 3, transition: 'width 0.8s ease' }} />
      </div>
      <p style={{ fontSize: 9, color: exceeded ? '#DC2626' : 'var(--text-muted)', margin: '3px 0 0', fontFamily: 'var(--mono)' }}>
        / {threshold >= 1000 ? threshold.toLocaleString() : threshold} · {pct != null ? `${pct}%` : '—'}
      </p>
    </div>
  );
}

// ═══ Dashboard Page ═══
export default function Dashboard({ profile, dark }) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', h); return () => window.removeEventListener('resize', h);
  }, []);

  // ── Keep all existing state ──
  const [stations, setStations] = useState([]);
  const [readings, setReadings] = useState({});
  const [selIdx, setSelIdx] = useState(0);
  const [sparkData, setSparkData] = useState({});
  const [isDemo, setIsDemo] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [trendRange, setTrendRange] = useState('24h');
  const stationsRef = useRef([]);
  const wsRef = useRef(null);

  async function refreshReadings(stationList) {
    const r = await getLatestReadings(stationList.map(s => s.id));
    setReadings(r);
    setLastUpdated(new Date());
    // Debug: log what the Dashboard received vs what timestamps are in the data
    stationList.forEach(s => {
      const reading = r[s.id];
      if (reading) {
        console.log(`[Dashboard] ${s.name} — timestamp: ${reading.timestamp}, pm25: ${reading.pm25}, pm10: ${reading.pm10}, aqi: ${reading.aqi}`);
      } else {
        console.warn(`[Dashboard] ${s.name} — no reading found`);
      }
    });
  }

  useEffect(() => {
    async function load() {
      try {
        const st = await getStations();
        if (st.length > 0) {
          setStations(st);
          stationsRef.current = st;
          await refreshReadings(st);
          setIsDemo(false);
        } else throw new Error('No stations');
      } catch {
        const demo = getDemoStations();
        setStations(demo);
        stationsRef.current = demo;
        setReadings(getDemoReadings());
        setLastUpdated(new Date());
        setIsDemo(true);
      }
    }
    load();
  }, []);

  // WebSocket: reconnect to backend and refresh readings on each poll cycle
  useEffect(() => {
    const backendUrl = import.meta.env.VITE_BACKEND_URL;
    if (!backendUrl || isDemo) return;
    const wsUrl = backendUrl.replace(/^https/, 'wss').replace(/^http/, 'ws') + '/ws';
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'update' && stationsRef.current.length) {
            refreshReadings(stationsRef.current);
          }
        } catch {}
      };
      ws.onclose = () => { if (!cancelled) setTimeout(connect, 5000); };
    }
    connect();
    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
  }, [isDemo]);

  // Fallback polling: refresh every 60 seconds even if no WebSocket
  useEffect(() => {
    if (isDemo || !stationsRef.current.length) return;
    const interval = setInterval(() => {
      if (stationsRef.current.length) refreshReadings(stationsRef.current);
    }, 60000);
    return () => clearInterval(interval);
  }, [isDemo]);

  // Load sparkline data for selected station (168h, all pollutant keys)
  useEffect(() => {
    if (!stations.length) return;
    const sid = stations[selIdx]?.id;
    if (!sid || sparkData[sid]) return;
    const hist = getDemoHistory(sid, 168);
    setSparkData(prev => ({
      ...prev,
      [sid]: hist.map(r => ({
        time: formatTime(r.timestamp),
        aqi: r.aqi,
        ...POLLUTANTS.reduce((acc, p) => ({ ...acc, [p.key]: r[p.key] }), {}),
      })),
    }));
  }, [selIdx, stations]);

  // ── Derived values ──
  const station = stations[selIdx] || {};
  const r = readings[station.id] || {};
  const aqi = r.aqi ?? 0;
  const lvl = getAqiLevel(aqi);
  const spark = sparkData[station.id] || [];

  const exceedanceCount = POLLUTANTS.filter(p => r[p.key] != null && r[p.key] > p.threshold).length;

  const dominantPollutant = useMemo(() => {
    const best = POLLUTANTS.reduce((acc, p) => {
      const ratio = r[p.key] != null ? r[p.key] / p.threshold : 0;
      return ratio > acc.ratio ? { name: p.name, ratio } : acc;
    }, { name: 'PM2.5', ratio: 0 });
    return best.name;
  }, [r]);

  const dataCapture = spark.length > 0 ? Math.round(spark.filter(d => d.pm25 != null).length / spark.length * 100) : 0;

  const trendData = useMemo(() => {
    const hours = { '6h': 6, '24h': 24, '7d': 168 }[trendRange] || 24;
    return spark.slice(-hours).map(d => ({ time: d.time, aqi: d.aqi || 0 }));
  }, [spark, trendRange]);

  const healthAdvice = aqi <= 50 ? [
    { title: 'Outdoor Activity', desc: 'Safe for all groups. Ideal for exercise.', color: '#16A34A' },
    { title: 'Sensitive Groups', desc: 'No precautions needed.', color: '#16A34A' },
    { title: 'Dust Levels', desc: 'Low dust levels. No protective equipment needed.', color: '#16A34A' },
  ] : aqi <= 100 ? [
    { title: 'Outdoor Activity', desc: 'Acceptable for most. Sensitive groups may be affected.', color: '#CA8A04' },
    { title: 'Sensitive Groups', desc: 'Consider reducing prolonged outdoor exertion.', color: '#F59E0B' },
    { title: 'Dust Levels', desc: 'Moderate. Consider dust mask for prolonged exposure.', color: '#CA8A04' },
  ] : [
    { title: 'Outdoor Activity', desc: 'Limit outdoor activities. Avoid prolonged exertion.', color: '#DC2626' },
    { title: 'Sensitive Groups', desc: 'Stay indoors. Keep windows and doors closed.', color: '#DC2626' },
    { title: 'Dust Levels', desc: 'Elevated. Wear N95 mask if going outdoors.', color: '#EA580C' },
  ];

  // ── JSX ──
  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>

      {/* Demo banner */}
      {isDemo && (
        <div style={{ ...glassInner({ padding: '7px 14px', borderRadius: 10, marginBottom: 14, background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.25)' }), display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={13} color="#CA8A04" />
          <span style={{ fontSize: 11, color: '#CA8A04', fontWeight: 600 }}>Demo Mode — Connect Supabase to see live station data</span>
        </div>
      )}

      {/* ROW 1 — HERO STRIP */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '160px 1fr 110px', gap: 12, marginBottom: 14 }}>

        {/* Col 1 — Mini Map */}
        <div
          className="aw-mini-map-wrap"
          style={{
            '--aqi-glow': lvl.color,
            height: isMobile ? 150 : undefined,
            minHeight: isMobile ? undefined : 200,
            borderRadius: 16,
            overflow: 'hidden',
            border: `1.5px solid ${lvl.color}60`,
            position: 'relative',
            animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.05s both',
          }}
        >
          {station.latitude && station.longitude ? (
            <MapContainer
              center={[station.latitude, station.longitude]}
              zoom={11}
              style={{ width: '100%', height: isMobile ? 150 : '100%', minHeight: 200 }}
              zoomControl={false}
              attributionControl={false}
              dragging={false}
              touchZoom={false}
              doubleClickZoom={false}
              scrollWheelZoom={false}
              keyboard={false}
            >
              <TileLayer url={dark ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"} />
              <MapCenterUpdater center={[station.latitude, station.longitude]} />
              {stations.map((s, i) => {
                const sr = readings[s.id] || {};
                const sl = getAqiLevel(sr.aqi || 0);
                return (
                  <CircleMarker key={s.id} center={[s.latitude, s.longitude]}
                    radius={i === selIdx ? 10 : 6}
                    pathOptions={{ fillColor: sl.color, fillOpacity: i === selIdx ? 0.9 : 0.5, color: '#fff', weight: i === selIdx ? 2 : 1 }}
                    eventHandlers={{ click: () => setSelIdx(i) }}
                  />
                );
              })}
            </MapContainer>
          ) : (
            <div style={{ width: '100%', height: isMobile ? 150 : 200, background: 'rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>No location data</span>
            </div>
          )}
          {/* Station name overlay */}
          <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 1000, pointerEvents: 'none' }}>
            <div style={{ background: 'rgba(0,0,0,0.55)', borderRadius: 6, padding: '3px 7px', backdropFilter: 'blur(8px)' }}>
              <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>{station.name || '—'}</span>
            </div>
          </div>
          {/* Coordinates overlay */}
          {station.latitude && (
            <div style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 1000, pointerEvents: 'none' }}>
              <div style={{ background: 'rgba(0,0,0,0.4)', borderRadius: 5, padding: '2px 5px', backdropFilter: 'blur(8px)' }}>
                <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 8, fontFamily: 'var(--mono)' }}>
                  {Number(station.latitude).toFixed(3)}°N {Number(station.longitude).toFixed(3)}°E
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Col 2 — AQI + Station info */}
        <div style={{ ...glass({ padding: '16px 20px', borderRadius: 18 }), display: 'flex', flexDirection: 'column', gap: 10, animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.1s both' }}>

          {/* Station selector + LIVE badge */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#16A34A', flexShrink: 0, animation: 'live-pulse 2s ease-in-out infinite' }} />
              <select value={selIdx} onChange={e => setSelIdx(Number(e.target.value))} style={{
                fontWeight: 700, fontSize: 14, color: 'var(--text)', background: 'transparent',
                border: 'none', outline: 'none', fontFamily: 'var(--font)', cursor: 'pointer', maxWidth: 240,
              }}>
                {stations.map((s, i) => <option key={s.id} value={i}>{s.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: '#16A34A', background: 'rgba(22,163,74,0.12)', border: '1px solid rgba(22,163,74,0.3)', padding: '2px 7px', borderRadius: 8 }}>LIVE</span>
              {isDemo && <span style={{ fontSize: 9, fontWeight: 700, color: '#CA8A04', background: 'rgba(202,138,4,0.1)', border: '1px solid rgba(202,138,4,0.3)', padding: '2px 7px', borderRadius: 8 }}>DEMO</span>}
            </div>
          </div>

          {/* AQI ring + info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <AQIRing aqi={aqi} color={lvl.color} size={90} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: lvl.color }}>{lvl.label}</span>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 8, background: `${lvl.color}15`, border: `1px solid ${lvl.color}25` }}>
                  <CheckCircle size={10} color={lvl.color} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: lvl.color }}>
                    {exceedanceCount === 0 ? 'All Compliant' : `${exceedanceCount} Exceeded`}
                  </span>
                </div>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 8px', lineHeight: 1.4 }}>
                {dominantPollutant} is the dominant pollutant
              </p>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 9, color: exceedanceCount > 0 ? '#DC2626' : '#16A34A', background: exceedanceCount > 0 ? 'rgba(220,38,38,0.1)' : 'rgba(22,163,74,0.1)', padding: '2px 7px', borderRadius: 6, fontWeight: 700 }}>
                  {exceedanceCount} exceedances
                </span>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', background: 'var(--glass-inner-bg)', padding: '2px 7px', borderRadius: 6 }}>
                  {dataCapture}% capture
                </span>
                {r.timestamp && (
                  <span style={{ fontSize: 9, color: 'var(--text-faint)', background: 'var(--glass-inner-bg)', padding: '2px 7px', borderRadius: 6, fontFamily: 'var(--mono)' }}>
                    {new Date(r.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* AQI description */}
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            {lvl.desc}
          </p>

          {/* Wind info — only visible on mobile (compass hidden on mobile) */}
          {isMobile && (
            <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
              <Wind size={12} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{r.wind_direction != null ? `${Math.round(r.wind_direction)}° ${degToCard(r.wind_direction)}` : '—'} · {r.wind_speed != null ? `${Number(r.wind_speed).toFixed(1)} m/s` : '—'} {beaufort(r.wind_speed)}</span>
            </div>
          )}
        </div>

        {/* Col 3 — Wind Compass (desktop only) */}
        {!isMobile && (
          <div style={{ ...glass({ padding: '16px 14px', borderRadius: 18 }), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.15s both' }}>
            <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Wind</p>
            <WindCompassSVG direction={r.wind_direction} size={80} />
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text)', margin: 0 }}>
                {r.wind_direction != null ? `${Math.round(r.wind_direction)}°` : '—'}{' '}
                <span style={{ color: '#0d9488' }}>{degToCard(r.wind_direction)}</span>
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                {r.wind_speed != null ? `${Number(r.wind_speed).toFixed(1)} m/s` : '—'}
              </p>
              <p style={{ fontSize: 10, color: 'var(--text-faint)', margin: 0 }}>{beaufort(r.wind_speed)}</p>
            </div>
          </div>
        )}
      </div>

      {/* ROW 2 — 6 POLLUTANT CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(6, 1fr)', gap: 10, marginBottom: 14 }}>
        {POLLUTANTS.map(p => (
          <PollutantCard key={p.key} pollutant={p} value={r[p.key]} sparkPoints={spark} isMobile={isMobile} />
        ))}
      </div>

      {/* ROW 3 — BOTTOM STRIP */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '220px 1fr 220px', gap: 12 }}>

        {/* Col 1 — Weather 2x2 */}
        <div style={{ ...glass({ padding: '14px 16px', borderRadius: 18 }), animation: 'glassIn 0.6s cubic-bezier(.16,1,.3,1) 0.35s both' }}>
          <h3 style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>Weather</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              { label: 'Temperature', value: r.temperature != null ? Number(r.temperature).toFixed(1) : null, unit: '°C' },
              { label: 'Humidity', value: r.humidity != null ? Math.round(r.humidity) : null, unit: '%' },
              { label: 'Wind Speed', value: r.wind_speed != null ? Number(r.wind_speed).toFixed(1) : null, unit: 'm/s' },
              { label: 'Pressure', value: r.pressure != null ? Math.round(r.pressure) : null, unit: 'hPa' },
            ].map((tile, i) => (
              <div key={i} style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '10px 12px' }}>
                <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 4px' }}>{tile.label}</p>
                <p style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: '0 0 1px', lineHeight: 1 }}>{tile.value ?? '—'}</p>
                <p style={{ fontSize: 9, color: 'var(--text-faint)', margin: 0 }}>{tile.unit}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Col 2 — AQI Trend */}
        <div style={{ ...glass({ padding: '14px 18px', borderRadius: 18 }), animation: 'glassIn 0.6s cubic-bezier(.16,1,.3,1) 0.4s both' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>AQI Trend</h3>
            <div style={{ ...glassInner({ padding: '2px 3px', borderRadius: 8 }), display: 'flex', gap: 2 }}>
              {['6h', '24h', '7d'].map(t => (
                <button key={t} onClick={() => setTrendRange(t)} style={{
                  padding: '3px 9px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  fontSize: 10, fontWeight: trendRange === t ? 700 : 400,
                  background: trendRange === t ? '#0d9488' : 'transparent',
                  color: trendRange === t ? '#fff' : 'var(--text-muted)',
                  fontFamily: 'var(--mono)', transition: 'all 0.15s',
                }}>{t}</button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={110}>
            <BarChart data={trendData} margin={{ top: 2, right: 4, bottom: 0, left: -28 }}>
              <XAxis dataKey="time" tick={{ fill: 'var(--text-faint)', fontSize: 8, fontFamily: 'var(--mono)' }} axisLine={false} tickLine={false} interval={Math.max(1, Math.floor(trendData.length / 6))} />
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0];
                return (
                  <div style={{ ...glass({ padding: '5px 9px', borderRadius: 8 }), fontSize: 11 }}>
                    <span style={{ color: getAqiBarColor(d.value), fontWeight: 700, fontFamily: 'var(--mono)' }}>AQI {d.value}</span>
                  </div>
                );
              }} />
              <Bar dataKey="aqi" radius={[2, 2, 0, 0]}>
                {trendData.map((d, i) => <Cell key={i} fill={getAqiBarColor(d.aqi)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Col 3 — Health Advisory */}
        <div style={{ ...glass({ padding: '14px 16px', borderRadius: 18 }), animation: 'glassIn 0.6s cubic-bezier(.16,1,.3,1) 0.45s both' }}>
          <h3 style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>Health Advisory</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {healthAdvice.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 0, background: 'var(--bg-secondary)', borderRadius: 10, padding: '9px 12px', borderLeft: `3px solid ${item.color}` }}>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', margin: '0 0 2px' }}>{item.title}</p>
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
