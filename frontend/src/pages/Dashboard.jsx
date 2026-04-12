import { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMap } from 'react-leaflet';
import { AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import { AreaChart, Area, LineChart, Line, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { getStations, getLatestReadings, getDemoStations, getDemoReadings, getDemoHistory } from '../lib/supabase';
import { getAqiLevel, POLLUTANTS, formatTime } from '../lib/utils';

// Solid card (no glass morphism)
const card = (x = {}) => ({
  background: 'var(--bg-card-solid)',
  border: '1px solid var(--border-solid)',
  borderRadius: 16,
  ...x,
});

// ─── Helpers ───
const BEAUFORT = [[0.2,'Calm'],[1.5,'Light Air'],[3.3,'Light Breeze'],[5.4,'Gentle Breeze'],[7.9,'Moderate Breeze'],[10.7,'Fresh Breeze'],[Infinity,'Strong']];
function beaufort(v) { for (const [max, lbl] of BEAUFORT) if ((v||0) <= max) return lbl; return 'Strong'; }
function degToCard(d) { if (d==null) return '—'; const dirs=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']; return dirs[Math.round(((d%360)+360)%360/22.5)%16]; }

const POLLUTANT_ORDER = ['so2', 'no2', 'o3', 'co', 'pm10', 'pm25'];

function MapCenterUpdater({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center[0] && center[1]) map.setView(center, 11, { animate: true, duration: 0.8 });
  }, [center[0], center[1]]);
  return null;
}

// SVG semi-circle AQI gauge
function SemiGauge({ aqi, color, size = 220 }) {
  const cx = size / 2;
  const r = size / 2 - 14;
  const cy = r + 14;
  const svgH = cy + 4;
  const circumference = Math.PI * r;
  const fill = Math.min((aqi || 0) / 500, 1) * circumference;
  const d = `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0`;
  return (
    <div style={{ position: 'relative', width: size, height: svgH + 72, margin: '0 auto' }}>
      <svg width={size} height={svgH} style={{ display: 'block' }}>
        <path d={d} fill="none" stroke="rgba(120,113,108,0.18)" strokeWidth={14} strokeLinecap="round" />
        <path d={d} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round"
          strokeDasharray={`${fill} ${circumference}`} style={{ transition: 'stroke-dasharray 1s ease' }} />
      </svg>
      <div style={{ textAlign: 'center', position: 'absolute', bottom: 0, left: 0, right: 0 }}>
        <div style={{ fontSize: 54, fontWeight: 800, color, fontFamily: 'var(--mono)', lineHeight: 1 }}>{aqi || '—'}</div>
        <div style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 3 }}>US AQI</div>
      </div>
    </div>
  );
}

// Horizontal AQI gradient scale bar with triangle marker
function AQIScaleBar({ aqi }) {
  const markerPct = Math.min((aqi || 0) / 500, 1) * 100;
  const markerColor = aqi ? getAqiLevel(aqi).color : '#78716C';
  return (
    <div style={{ width: '100%' }}>
      <div style={{ height: 8, borderRadius: 4, background: 'linear-gradient(to right,#16A34A 0%,#16A34A 10%,#CA8A04 20%,#EA580C 30%,#DC2626 40%,#7C3AED 60%,#991B1B 100%)', position: 'relative' }}>
        <div style={{ position: 'absolute', top: '100%', left: `${markerPct}%`, transform: 'translateX(-50%) translateY(3px)', width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: `7px solid ${markerColor}`, transition: 'left 1s ease' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--mono)', marginTop: 14 }}>
        {['0','50','100','150','200','300','500'].map(l => <span key={l}>{l}</span>)}
      </div>
    </div>
  );
}

// Mini wind compass for weather card (light/dark adaptive)
function WindCompassMini({ direction, size = 80 }) {
  const cx = size / 2, cy = size / 2, r = (size - 4) / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="var(--bg-secondary)" stroke="var(--border-solid)" strokeWidth={1} />
      {[0,45,90,135,180,225,270,315].map((deg, i) => {
        const a = deg * Math.PI / 180, len = i % 2 === 0 ? 6 : 3;
        return <line key={deg}
          x1={cx + Math.sin(a) * (r - len)} y1={cy - Math.cos(a) * (r - len)}
          x2={cx + Math.sin(a) * r} y2={cy - Math.cos(a) * r}
          stroke="var(--text-faint)" strokeWidth={i % 2 === 0 ? 1.5 : 0.8} />;
      })}
      {[['N',0],['E',90],['S',180],['W',270]].map(([l, deg]) => {
        const a = deg * Math.PI / 180, lr = r - 11;
        return <text key={l} x={cx + Math.sin(a)*lr} y={cy - Math.cos(a)*lr}
          textAnchor="middle" dominantBaseline="middle" fontSize={8} fontWeight="700"
          fill="var(--text-muted)" fontFamily="var(--font)">{l}</text>;
      })}
      <g style={{ transform: `rotate(${direction || 0}deg)`, transformOrigin: `${cx}px ${cy}px`, transition: 'transform 0.8s cubic-bezier(0.34,1.56,0.64,1)' }}>
        <polygon points={`${cx},${cy-r+14} ${cx-3},${cy+8} ${cx+3},${cy+8}`} fill="#0d9488" fillOpacity={0.9} />
        <polygon points={`${cx},${cy+r-14} ${cx-2},${cy-8} ${cx+2},${cy-8}`} fill="var(--text-faint)" />
      </g>
      <circle cx={cx} cy={cy} r={3} fill="var(--text-muted)" />
    </svg>
  );
}

// Pollutant card — area sparkline, Good/Exceedance badge, NCEC progress bar
function PollutantCard({ pollutant, value, sparkPoints }) {
  const { key, name, color, unit, threshold } = pollutant;
  const exceeded = value != null && value > threshold;
  const pct = value != null ? Math.round((value / threshold) * 100) : null;
  const sparkData = sparkPoints.slice(-24).map((d, i) => ({ i, v: d[key] || 0 }));
  const vals = sparkPoints.map(d => d[key]).filter(v => v != null && !isNaN(v));
  const half = Math.floor(vals.length / 2);
  const trendUp = vals.length >= 4 ? vals[vals.length - 1] > vals[half] : null;
  const trendPct = vals.length >= 4 ? Math.abs(((vals[vals.length-1] - vals[half]) / (vals[half] || 1)) * 100).toFixed(0) : null;
  const arcColor = exceeded ? '#DC2626' : color;

  return (
    <div style={card({ padding: '14px 14px 12px' })}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{name}</span>
          <p style={{ fontSize: 9, color: 'var(--text-faint)', margin: 0, fontFamily: 'var(--mono)' }}>{unit}</p>
        </div>
        <div style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: exceeded ? 'rgba(220,38,38,0.1)' : 'rgba(22,163,74,0.1)', color: exceeded ? '#DC2626' : '#16A34A', border: `1px solid ${exceeded ? 'rgba(220,38,38,0.2)' : 'rgba(22,163,74,0.2)'}` }}>
          {exceeded ? 'Exceedance' : 'Good'}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 26, fontWeight: 800, color: arcColor, lineHeight: 1 }}>
          {value != null ? Number(value).toFixed(1) : '—'}
        </span>
        {trendUp !== null && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 10, fontWeight: 700, color: trendUp ? '#DC2626' : '#16A34A', marginBottom: 3 }}>
            {trendUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}{trendPct}%
          </span>
        )}
      </div>
      <div style={{ height: 36, marginBottom: 8 }}>
        <ResponsiveContainer width="100%" height={36}>
          <AreaChart data={sparkData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`sg-${key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={arcColor} stopOpacity={0.25} />
                <stop offset="95%" stopColor={arcColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="v" stroke={arcColor} strokeWidth={1.5}
              fill={`url(#sg-${key})`} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div style={{ background: 'var(--bg-secondary)', borderRadius: 3, height: 4, overflow: 'hidden', marginBottom: 4 }}>
        <div style={{ width: `${Math.min(pct || 0, 100)}%`, height: '100%', background: arcColor, borderRadius: 3, transition: 'width 0.8s ease' }} />
      </div>
      <p style={{ fontSize: 9, color: 'var(--text-faint)', margin: 0, fontFamily: 'var(--mono)' }}>
        NCEC: {threshold >= 1000 ? threshold.toLocaleString() : threshold} · {pct != null ? `${pct}%` : '—'}
      </p>
    </div>
  );
}

// Weather/met card with Low/High range and progress bar
function WeatherCard({ label, value, unit, color, low, high, format, minVal, maxVal, compass, windDir, windSpd, fullWidth }) {
  const displayPct = (value != null && maxVal != null && maxVal > minVal)
    ? Math.min(Math.max((value - minVal) / (maxVal - minVal), 0), 1) * 100
    : null;

  return (
    <div style={card({ padding: '14px 16px', ...(fullWidth ? { gridColumn: '1 / -1' } : {}) })}>
      <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }}>{label}</p>
      {compass ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <WindCompassMini direction={windDir} size={72} />
          <div>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: 0, lineHeight: 1 }}>
              {windDir != null ? Math.round(windDir) : '—'}°
            </p>
            <p style={{ fontSize: 14, fontWeight: 700, color, margin: '3px 0 1px' }}>{degToCard(windDir)}</p>
            <p style={{ fontSize: 10, color: 'var(--text-faint)', margin: 0 }}>{beaufort(windSpd)}</p>
          </div>
        </div>
      ) : (
        <>
          <p style={{ fontFamily: 'var(--mono)', fontSize: 26, fontWeight: 800, color: 'var(--text)', margin: '0 0 6px', lineHeight: 1 }}>
            {value != null ? format(value) : '—'}<span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-faint)', marginLeft: 3 }}>{unit}</span>
          </p>
          <div style={{ display: 'flex', gap: 10, marginBottom: 8, fontSize: 10 }}>
            <span style={{ color: 'var(--text-faint)' }}>Low <strong style={{ color: 'var(--text-muted)' }}>{low != null ? format(low) : '—'}</strong></span>
            <span style={{ color: 'var(--text-faint)' }}>High <strong style={{ color: 'var(--text-muted)' }}>{high != null ? format(high) : '—'}</strong></span>
          </div>
          {displayPct != null && (
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 3, height: 4, overflow: 'hidden' }}>
              <div style={{ width: `${displayPct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.8s ease' }} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══ Dashboard Page ═══
export default function Dashboard({ profile, dark }) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  const [stations, setStations] = useState([]);
  const [readings, setReadings] = useState({});
  const [selIdx, setSelIdx] = useState(0);
  const [sparkData, setSparkData] = useState({});
  const [isDemo, setIsDemo] = useState(false);
  const stationsRef = useRef([]);
  const wsRef = useRef(null);

  async function refreshReadings(stationList) {
    const r = await getLatestReadings(stationList.map(s => s.id));
    setReadings(r);
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
        setIsDemo(true);
      }
    }
    load();
  }, []);

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
        try { const msg = JSON.parse(e.data); if (msg.type === 'update' && stationsRef.current.length) refreshReadings(stationsRef.current); } catch {}
      };
      ws.onclose = () => { if (!cancelled) setTimeout(connect, 5000); };
    }
    connect();
    return () => { cancelled = true; wsRef.current?.close(); };
  }, [isDemo]);

  useEffect(() => {
    if (isDemo || !stationsRef.current.length) return;
    const interval = setInterval(() => { if (stationsRef.current.length) refreshReadings(stationsRef.current); }, 60000);
    return () => clearInterval(interval);
  }, [isDemo]);

  useEffect(() => {
    if (!stations.length) return;
    const sid = stations[selIdx]?.id;
    if (!sid || sparkData[sid]) return;
    const hist = getDemoHistory(sid, 168);
    setSparkData(prev => ({
      ...prev,
      [sid]: hist.map(h => ({
        time: formatTime(h.timestamp),
        aqi: h.aqi,
        temperature: h.temperature,
        humidity: h.humidity,
        wind_speed: h.wind_speed,
        wind_direction: h.wind_direction,
        pressure: h.pressure,
        ...POLLUTANTS.reduce((acc, p) => ({ ...acc, [p.key]: h[p.key] }), {}),
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
    return POLLUTANTS.reduce((acc, p) => {
      const ratio = r[p.key] != null ? r[p.key] / p.threshold : 0;
      return ratio > acc.ratio ? { name: p.name, ratio } : acc;
    }, { name: 'PM2.5', ratio: 0 }).name;
  }, [r]);

  const dataCapture = spark.length > 0
    ? Math.round(spark.filter(d => d.pm25 != null).length / spark.length * 100)
    : 0;

  const avgAqi = spark.length
    ? Math.round(spark.reduce((s, d) => s + (d.aqi || 0), 0) / spark.length)
    : null;

  const trendData24h = useMemo(() => spark.slice(-24).map(d => ({ time: d.time, aqi: d.aqi || 0 })), [spark]);

  const trendImproving = useMemo(() => {
    if (trendData24h.length < 4) return null;
    const half = Math.floor(trendData24h.length / 2);
    const a1 = trendData24h.slice(0, half).reduce((s, d) => s + d.aqi, 0) / half;
    const a2 = trendData24h.slice(half).reduce((s, d) => s + d.aqi, 0) / (trendData24h.length - half);
    return a2 < a1;
  }, [trendData24h]);

  const weatherRanges = useMemo(() => {
    const out = {};
    ['wind_speed', 'temperature', 'humidity', 'pressure'].forEach(k => {
      const vals = spark.map(d => d[k]).filter(v => v != null && !isNaN(v));
      if (vals.length) out[k] = { min: Math.min(...vals), max: Math.max(...vals) };
    });
    return out;
  }, [spark]);

  const orderedPollutants = POLLUTANT_ORDER.map(k => POLLUTANTS.find(p => p.key === k)).filter(Boolean);

  // ── JSX ──
  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>

      {/* Demo banner */}
      {isDemo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', marginBottom: 14, background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)', borderRadius: 10 }}>
          <AlertTriangle size={13} color="#CA8A04" />
          <span style={{ fontSize: 11, color: '#CA8A04', fontWeight: 600 }}>Demo Mode — Connect Supabase to see live station data</span>
        </div>
      )}

      {/* ROW 1 — Hero: info panel + dark map */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 14, flexDirection: isMobile ? 'column' : 'row', alignItems: 'stretch' }}>

        {/* LEFT — AQI info panel */}
        <div style={card({ padding: '20px 22px', flex: 1, minWidth: 0 })}>

          {/* Station selector + badges */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A34A', flexShrink: 0, animation: 'live-pulse 2s ease-in-out infinite' }} />
              <select value={selIdx} onChange={e => setSelIdx(Number(e.target.value))} style={{
                fontWeight: 700, fontSize: 15, color: 'var(--text)', background: 'transparent',
                border: 'none', outline: 'none', fontFamily: 'var(--font)', cursor: 'pointer', maxWidth: isMobile ? 200 : 300,
              }}>
                {stations.map((s, i) => <option key={s.id} value={i}>{s.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: '#16A34A', background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.3)', padding: '2px 8px', borderRadius: 8, letterSpacing: '0.08em' }}>LIVE</span>
              {isDemo && <span style={{ fontSize: 9, fontWeight: 700, color: '#CA8A04', background: 'rgba(202,138,4,0.1)', border: '1px solid rgba(202,138,4,0.3)', padding: '2px 8px', borderRadius: 8 }}>DEMO</span>}
            </div>
          </div>

          {/* Semi-circle AQI gauge */}
          <SemiGauge aqi={aqi} color={lvl.color} size={isMobile ? 180 : 220} />

          {/* AQI status badge + dominant pollutant */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 16px', flexWrap: 'wrap' }}>
            <div style={{ background: `${lvl.color}18`, border: `1px solid ${lvl.color}35`, borderRadius: 20, padding: '4px 14px' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: lvl.color }}>{lvl.label}</span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{dominantPollutant} is dominant</span>
          </div>

          {/* Horizontal AQI scale bar */}
          <div style={{ marginBottom: 18 }}>
            <AQIScaleBar aqi={aqi} />
          </div>

          {/* 3 stat boxes */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
            {[
              { label: 'Exceedances', value: exceedanceCount, sub: 'of 6 params', color: exceedanceCount > 0 ? '#DC2626' : '#16A34A' },
              { label: 'Data Capture', value: `${dataCapture}%`, sub: '7-day avg', color: 'var(--text)' },
              { label: 'Avg AQI', value: avgAqi ?? '—', sub: '24h avg', color: 'var(--text)' },
            ].map((stat, i) => (
              <div key={i} style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                <p style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px' }}>{stat.label}</p>
                <p style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 800, color: stat.color, margin: 0, lineHeight: 1 }}>{stat.value}</p>
                <p style={{ fontSize: 9, color: 'var(--text-faint)', margin: '2px 0 0' }}>{stat.sub}</p>
              </div>
            ))}
          </div>

          {/* 24h AQI trend line chart */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>24H AQI Trend</span>
              {trendImproving !== null && (
                <span style={{ fontSize: 10, fontWeight: 700, color: trendImproving ? '#16A34A' : '#DC2626' }}>
                  {trendImproving ? '↗ Improving' : '↘ Worsening'}
                </span>
              )}
            </div>
            <ResponsiveContainer width="100%" height={80}>
              <LineChart data={trendData24h} margin={{ top: 2, right: 4, bottom: 0, left: -28 }}>
                <XAxis dataKey="time" tick={{ fill: 'var(--text-faint)', fontSize: 8, fontFamily: 'var(--mono)' }} axisLine={false} tickLine={false} interval={Math.max(1, Math.floor(trendData24h.length / 5))} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const val = payload[0].value;
                  return (
                    <div style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-solid)', borderRadius: 8, padding: '5px 10px', fontSize: 11 }}>
                      <span style={{ color: getAqiLevel(val).color, fontWeight: 700, fontFamily: 'var(--mono)' }}>AQI {val}</span>
                    </div>
                  );
                }} />
                <Line type="monotone" dataKey="aqi" stroke={lvl.color} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Bottom station bar */}
          <div style={{ borderTop: '1px solid var(--border-solid)', marginTop: 12, paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>
              {station.latitude ? `${Number(station.latitude).toFixed(3)}°N ${Number(station.longitude).toFixed(3)}°E` : '—'}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
              Updated {r.timestamp ? new Date(r.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}
            </span>
          </div>
        </div>

        {/* RIGHT — Dark satellite map */}
        <div style={{
          width: isMobile ? '100%' : 280, minHeight: isMobile ? 200 : undefined,
          flexShrink: 0, borderRadius: 16, overflow: 'hidden',
          border: '1px solid #1e293b', position: 'relative',
        }}>
          {station.latitude && station.longitude ? (
            <MapContainer
              center={[station.latitude, station.longitude]}
              zoom={11}
              style={{ width: '100%', height: isMobile ? 200 : '100%', minHeight: isMobile ? 200 : 520 }}
              zoomControl={false} attributionControl={false}
              dragging={false} touchZoom={false} doubleClickZoom={false} scrollWheelZoom={false} keyboard={false}
            >
              <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
              <MapCenterUpdater center={[station.latitude, station.longitude]} />
              {stations.map((s, i) => {
                const sr = readings[s.id] || {};
                const sl = getAqiLevel(sr.aqi || 0);
                return (
                  <CircleMarker key={s.id} center={[s.latitude, s.longitude]}
                    radius={i === selIdx ? 10 : 6}
                    pathOptions={{ fillColor: i === selIdx ? '#16A34A' : sl.color, fillOpacity: 0.9, color: '#fff', weight: i === selIdx ? 2.5 : 1.5 }}
                    eventHandlers={{ click: () => setSelIdx(i) }}
                  />
                );
              })}
            </MapContainer>
          ) : (
            <div style={{ width: '100%', height: isMobile ? 200 : 520, background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>No location data</span>
            </div>
          )}
          {/* Station label overlay */}
          <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 1000, pointerEvents: 'none' }}>
            <div style={{ background: 'rgba(0,0,0,0.65)', borderRadius: 8, padding: '4px 10px', backdropFilter: 'blur(8px)' }}>
              <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>{station.name || '—'}</span>
            </div>
          </div>
          {/* AQI overlay badge */}
          <div style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 1000, pointerEvents: 'none' }}>
            <div style={{ background: `${lvl.color}ee`, borderRadius: 8, padding: '4px 10px' }}>
              <span style={{ color: '#fff', fontSize: 11, fontWeight: 800, fontFamily: 'var(--mono)' }}>AQI {aqi}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ROW 2 — 6 Pollutant cards: SO₂ NO₂ O₃ CO PM₁₀ PM₂.₅ */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(6, 1fr)', gap: 10, marginBottom: 14 }}>
        {orderedPollutants.map(p => (
          <PollutantCard key={p.key} pollutant={p} value={r[p.key]} sparkPoints={spark} />
        ))}
      </div>

      {/* ROW 3 — 5 Weather / Met cards */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: 10 }}>
        <WeatherCard
          label="Wind Speed" value={r.wind_speed} unit="m/s" color="#0d9488"
          low={weatherRanges.wind_speed?.min} high={weatherRanges.wind_speed?.max}
          format={v => Number(v).toFixed(1)} minVal={0} maxVal={15}
        />
        <WeatherCard
          label="Wind Direction" compass
          windDir={r.wind_direction} windSpd={r.wind_speed} color="#8B5CF6"
        />
        <WeatherCard
          label="Temperature" value={r.temperature} unit="°C" color="#EA580C"
          low={weatherRanges.temperature?.min} high={weatherRanges.temperature?.max}
          format={v => Number(v).toFixed(1)} minVal={20} maxVal={55}
        />
        <WeatherCard
          label="Humidity" value={r.humidity} unit="%" color="#3B82F6"
          low={weatherRanges.humidity?.min} high={weatherRanges.humidity?.max}
          format={v => Math.round(v)} minVal={0} maxVal={100}
        />
        <WeatherCard
          label="Pressure" value={r.pressure} unit="hPa" color="#78716C"
          low={weatherRanges.pressure?.min} high={weatherRanges.pressure?.max}
          format={v => Math.round(v)} minVal={990} maxVal={1030}
          fullWidth={isMobile}
        />
      </div>

    </div>
  );
}
