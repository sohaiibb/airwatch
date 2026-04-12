import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, CircleMarker, Tooltip as LTooltip, useMap } from 'react-leaflet';
import {
  Wind, Droplets, Thermometer, Eye, Activity, CheckCircle, TrendingUp, TrendingDown,
  AlertTriangle, Leaf, Sun, Cloud, Shield, Heart, Gauge, Navigation, BarChart3,
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { getStations, getLatestReadings, getDemoStations, getDemoReadings, getDemoHistory } from '../lib/supabase';
import { glass, glassInner, getAqiLevel, POLLUTANTS, formatTime } from '../lib/utils';

// ─── Glass tooltip for charts ───
const GlassTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ ...glass({ borderRadius: 10, padding: '8px 12px' }), boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
      <p style={{ color: '#78716C', fontSize: 10, margin: 0, marginBottom: 4, fontFamily: 'var(--font-mono)' }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, fontSize: 12, margin: '1px 0', fontWeight: 600 }}>
          {p.name}: <span style={{ fontFamily: 'var(--font-mono)' }}>{p.value}</span>
        </p>
      ))}
    </div>
  );
};

// ─── Stat Card ───
function StatCard({ icon: Icon, label, value, unit, trend, trendVal, accent, delay = 0 }) {
  return (
    <div style={{
      ...glass({ padding: '16px 18px' }),
      animation: `glassIn 0.6s cubic-bezier(.16,1,.3,1) ${delay}s both`,
      transition: 'transform 0.3s, box-shadow 0.3s', cursor: 'default',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 40px rgba(0,0,0,0.1)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 32px rgba(0,0,0,0.06)'; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: `${accent}18`, border: `1px solid ${accent}25`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={15} color={accent} />
        </div>
        {trend && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', color: trend === 'up' ? '#DC2626' : '#16A34A' }}>
            {trend === 'up' ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{trendVal}
          </span>
        )}
      </div>
      <p style={{ color: '#78716C', fontSize: 10, fontWeight: 600, margin: 0, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</p>
      <p style={{ color: '#1C1917', fontSize: 24, fontWeight: 700, margin: '2px 0 0', fontFamily: 'var(--font-mono)', letterSpacing: '-0.03em' }}>
        {value ?? '—'}<span style={{ fontSize: 11, color: '#A8A29E', marginLeft: 3, fontWeight: 500 }}>{unit}</span>
      </p>
    </div>
  );
}

// ─── Pollutant Bar ───
function PollutantBar({ name, value, max, unit, color, threshold }) {
  const pct = Math.min(((value || 0) / max) * 100, 100);
  const over = (value || 0) > threshold;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ color: '#44403C', fontSize: 12, fontWeight: 600 }}>{name}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: over ? '#DC2626' : '#16A34A' }}>
          {value ?? '—'} <span style={{ color: '#A8A29E', fontWeight: 400 }}>{unit}</span>
        </span>
      </div>
      <div style={{ background: 'rgba(255,255,255,0.45)', borderRadius: 6, height: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.5)' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 6, background: over ? `linear-gradient(90deg, ${color}, #EF4444)` : `linear-gradient(90deg, ${color}CC, ${color})`, transition: 'width 1s cubic-bezier(.16,1,.3,1)', boxShadow: `0 0 10px ${color}30` }} />
      </div>
    </div>
  );
}

// ─── Map fit helper ───
function FitBounds({ stations }) {
  const map = useMap();
  useEffect(() => {
    if (stations.length > 0) {
      const bounds = stations.map(s => [s.latitude, s.longitude]);
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 10 });
    }
  }, [stations, map]);
  return null;
}

// ═══ Dashboard Page ═══
export default function Dashboard({ profile }) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isPhone, setIsPhone] = useState(window.innerWidth < 480);
  useEffect(() => {
    const handle = () => { setIsMobile(window.innerWidth < 768); setIsPhone(window.innerWidth < 480); };
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, []);

  const [stations, setStations] = useState([]);
  const [readings, setReadings] = useState({});
  const [selIdx, setSelIdx] = useState(0);
  const [sparkData, setSparkData] = useState({});
  const [isDemo, setIsDemo] = useState(false);
  const navigate = useNavigate();
  const stationsRef = useRef([]);
  const wsRef = useRef(null);

  useEffect(() => {
    async function load() {
      try {
        const st = await getStations();
        if (st.length > 0) {
          setStations(st);
          stationsRef.current = st;
          const r = await getLatestReadings(st.map(s => s.id));
          setReadings(r);
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
            getLatestReadings(stationsRef.current.map(s => s.id)).then(setReadings);
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

  // Load sparkline data for selected station
  useEffect(() => {
    if (!stations.length) return;
    const sid = stations[selIdx]?.id;
    if (!sid || sparkData[sid]) return;
    const hist = getDemoHistory(sid, 24);
    setSparkData(prev => ({ ...prev, [sid]: hist.map(r => ({ time: formatTime(r.timestamp), aqi: r.aqi, pm25: r.pm25 })) }));
  }, [selIdx, stations]);

  const station = stations[selIdx] || {};
  const r = readings[station.id] || {};
  const aqi = r.aqi ?? 0;
  const lvl = getAqiLevel(aqi);
  const spark = sparkData[station.id] || [];

  const healthAdvice = aqi <= 50 ? [
    { icon: Sun, title: 'Outdoor Activity', desc: 'Safe for all groups.', color: '#16A34A' },
    { icon: Heart, title: 'Sensitive Groups', desc: 'No precautions needed.', color: '#3B82F6' },
    { icon: Shield, title: 'Dust Advisory', desc: 'Low dust levels.', color: '#F59E0B' },
    { icon: Cloud, title: 'Forecast', desc: 'Quality expected to remain good.', color: '#8B5CF6' },
  ] : aqi <= 100 ? [
    { icon: Sun, title: 'Outdoor Activity', desc: 'Acceptable for most.', color: '#CA8A04' },
    { icon: Heart, title: 'Sensitive Groups', desc: 'Consider reducing exertion.', color: '#3B82F6' },
    { icon: Shield, title: 'Dust Advisory', desc: 'Moderate levels.', color: '#F59E0B' },
    { icon: Cloud, title: 'Forecast', desc: 'Monitor conditions.', color: '#8B5CF6' },
  ] : [
    { icon: Sun, title: 'Outdoor Activity', desc: 'Limit outdoor exertion.', color: '#DC2626' },
    { icon: Heart, title: 'Sensitive Groups', desc: 'Stay indoors.', color: '#DC2626' },
    { icon: Shield, title: 'Dust Advisory', desc: 'Wear N95 mask outdoors.', color: '#EA580C' },
    { icon: Cloud, title: 'Forecast', desc: 'Poor conditions may persist.', color: '#8B5CF6' },
  ];

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {isDemo && (
        <div style={{ ...glassInner({ padding: '8px 16px', borderRadius: 10, marginBottom: 16, background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.25)' }), display: 'flex', alignItems: 'center', gap: 8, animation: 'glassIn 0.4s ease both' }}>
          <AlertTriangle size={14} color="#CA8A04" />
          <span style={{ fontSize: 12, color: '#CA8A04', fontWeight: 600 }}>Demo Mode — Connect Supabase to see live station data</span>
        </div>
      )}

      {/* Row 1: Map + AQI Gauge */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 280px', gap: 16, marginBottom: 16 }}>
        {/* Map */}
        <div style={{ ...glass({ padding: 0, overflow: 'hidden' }), animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.05s both', height: isMobile ? 200 : 300 }}>
          <MapContainer center={[26.4, 50.0]} zoom={8} style={{ height: '100%', width: '100%' }} zoomControl={true} attributionControl={false}>
            <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
            <FitBounds stations={stations} />
            {stations.map((s, i) => {
              const sr = readings[s.id] || {};
              const sl = getAqiLevel(sr.aqi || 0);
              return (
                <CircleMarker
                  key={s.id}
                  center={[s.latitude, s.longitude]}
                  radius={selIdx === i ? 12 : 8}
                  pathOptions={{
                    fillColor: sl.color, fillOpacity: 0.8,
                    color: selIdx === i ? '#fff' : sl.color, weight: selIdx === i ? 3 : 1.5,
                  }}
                  eventHandlers={{ click: () => setSelIdx(i) }}
                >
                  <LTooltip direction="top" offset={[0, -10]}>
                    <div style={{ fontFamily: 'var(--font-display)', padding: '2px 0' }}>
                      <strong>{s.name}</strong><br />
                      <span style={{ fontFamily: 'var(--font-mono)', color: sl.color }}>AQI: {sr.aqi ?? '—'}</span>
                      <span style={{ marginLeft: 6, color: sl.color, fontWeight: 600 }}>{sl.label}</span>
                    </div>
                  </LTooltip>
                </CircleMarker>
              );
            })}
          </MapContainer>
        </div>

        {/* AQI Gauge */}
        <div style={{ ...glass({ padding: '24px 20px' }), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.1s both', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: -30, right: -30, width: 90, height: 90, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.45), transparent 70%)', pointerEvents: 'none' }} />
          <p style={{ color: '#78716C', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 14px', zIndex: 1 }}>Air Quality Index</p>
          <div style={{ width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.35)', border: `3px solid ${lvl.color}60`, backdropFilter: 'blur(16px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 1, animation: 'gaugeGlow 3s ease-in-out infinite', boxShadow: `0 0 40px ${lvl.color}15` }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 42, fontWeight: 500, color: lvl.color, lineHeight: 1 }}>{aqi || '—'}</span>
            <span style={{ color: '#A8A29E', fontSize: 10, fontWeight: 500, marginTop: 2 }}>US AQI</span>
          </div>
          <div style={{ marginTop: 12, padding: '4px 14px', borderRadius: 16, background: lvl.soft, border: `1px solid ${lvl.color}25`, display: 'flex', alignItems: 'center', gap: 4, zIndex: 1 }}>
            <CheckCircle size={12} color={lvl.color} />
            <span style={{ color: lvl.color, fontSize: 11, fontWeight: 700 }}>{lvl.label}</span>
          </div>
          <p style={{ color: '#78716C', fontSize: 11, fontWeight: 600, marginTop: 8, zIndex: 1, textAlign: 'center' }}>{station.name || '—'}</p>
          <button onClick={() => navigate(`/charts/${station.id}`)} style={{
            marginTop: 8, padding: '6px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: 'rgba(255,255,255,0.35)', color: '#3B82F6', fontSize: 11, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 4, transition: 'background 0.2s',
          }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.55)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.35)'}
          >
            <BarChart3 size={12} />View Charts
          </button>
        </div>
      </div>

      {/* Row 2: Station selector tabs */}
      <div style={{ ...glass({ padding: '8px 10px', marginBottom: 16 }), display: 'flex', gap: 4, overflowX: 'auto', animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.15s both' }}>
        {stations.map((s, i) => {
          const sr = readings[s.id] || {};
          const sl = getAqiLevel(sr.aqi || 0);
          return (
            <button key={s.id} onClick={() => setSelIdx(i)} style={{
              padding: '8px 14px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: selIdx === i ? 'rgba(255,255,255,0.6)' : 'transparent',
              boxShadow: selIdx === i ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
              display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
              transition: 'all 0.2s',
            }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: sl.color, boxShadow: `0 0 6px ${sl.color}50` }} />
              <span style={{ fontSize: 12, fontWeight: selIdx === i ? 700 : 500, color: selIdx === i ? '#1C1917' : '#78716C', whiteSpace: 'nowrap' }}>{s.name}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: sl.color }}>{sr.aqi || '—'}</span>
            </button>
          );
        })}
      </div>

      {/* Row 3: Pollutant cards (6) */}
      <div style={{ display: 'grid', gridTemplateColumns: isPhone ? 'repeat(2, 1fr)' : isMobile ? 'repeat(3, 1fr)' : 'repeat(6, 1fr)', gap: 12, marginBottom: 16 }}>
        {POLLUTANTS.map((p, i) => (
          <StatCard key={p.key} icon={Activity} label={p.name} value={r[p.key]} unit={p.unit} accent={p.color}
            trend={r[p.key] != null ? (Math.random() > 0.5 ? 'up' : 'down') : undefined}
            trendVal={`${Math.round(Math.random() * 15)}%`}
            delay={0.2 + i * 0.04} />
        ))}
      </div>

      {/* Row 4: Weather cards (4) + Sparkline */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr) 1.5fr', gap: 12, marginBottom: 16 }}>
        <StatCard icon={Thermometer} label="Temperature" value={r.temperature} unit="°C" accent="#EF4444" delay={0.4} />
        <StatCard icon={Droplets} label="Humidity" value={r.humidity} unit="%" accent="#0EA5E9" delay={0.44} />
        <StatCard icon={Wind} label="Wind Speed" value={r.wind_speed} unit="m/s" accent="#8B5CF6" delay={0.48} />
        <StatCard icon={Navigation} label="Wind Dir" value={r.wind_direction ? `${Math.round(r.wind_direction)}°` : null} unit="" accent="#F59E0B" delay={0.52} />

        {/* Mini sparkline */}
        <div style={{ ...glass({ padding: '14px 16px' }), animation: 'glassIn 0.6s cubic-bezier(.16,1,.3,1) 0.5s both' }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#78716C', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}>24H AQI TREND</p>
          <ResponsiveContainer width="100%" height={70}>
            <AreaChart data={spark} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="sparkG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#16A34A" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#16A34A" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" hide />
              <YAxis hide />
              <Tooltip content={<GlassTooltip />} />
              <Area type="monotone" dataKey="aqi" stroke="#16A34A" fill="url(#sparkG)" strokeWidth={2} dot={false} name="AQI" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 5: Compliance summary + Health Advisory */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Compliance summary */}
        <div style={{ ...glass({ padding: '20px 22px' }), animation: 'glassIn 0.6s cubic-bezier(.16,1,.3,1) 0.55s both', display: 'flex', flexDirection: 'column' }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 3px' }}>Current Readings</h2>
          <p style={{ color: '#A8A29E', fontSize: 11, margin: '0 0 14px' }}>Live pollutant levels vs. NCEC limits</p>
          {POLLUTANTS.map((p, i) => <PollutantBar key={i} name={p.name} value={r[p.key]} max={p.max} unit={p.unit} color={p.color} threshold={p.threshold} />)}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <div style={{ ...glassInner({ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6 }) }}>
              <Leaf size={12} color="#16A34A" />
              <span style={{ color: '#78716C', fontSize: 10 }}>NCEC Royal Decree M/165</span>
            </div>
            {(() => {
              const over = POLLUTANTS.filter(p => r[p.key] != null && r[p.key] > p.threshold).length;
              const compliant = over === 0;
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: compliant ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.10)', border: `1px solid ${compliant ? 'rgba(22,163,74,0.25)' : 'rgba(220,38,38,0.25)'}` }}>
                  <Shield size={11} color={compliant ? '#16A34A' : '#DC2626'} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: compliant ? '#16A34A' : '#DC2626' }}>
                    {compliant ? 'All Compliant' : `${over} Exceeded`}
                  </span>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Health Advisory */}
        <div style={{ ...glass({ padding: '20px 22px' }), animation: 'glassIn 0.6s cubic-bezier(.16,1,.3,1) 0.6s both' }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 14px' }}>Health Advisory</h2>
          {healthAdvice.map((item, i) => (
            <div key={i} style={{
              ...glassInner({ display: 'flex', gap: 10, padding: '10px 12px', marginBottom: i < 3 ? 8 : 0, background: `linear-gradient(135deg, ${item.color}08, rgba(255,255,255,0.25))` }),
              transition: 'transform 0.2s', cursor: 'default',
            }}
              onMouseEnter={e => e.currentTarget.style.transform = 'translateX(3px)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'translateX(0)'}
            >
              <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: `${item.color}12`, border: `1px solid ${item.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <item.icon size={14} color={item.color} />
              </div>
              <div>
                <p style={{ color: '#1C1917', fontSize: 12, fontWeight: 650, margin: 0 }}>{item.title}</p>
                <p style={{ color: '#78716C', fontSize: 11, margin: '2px 0 0', lineHeight: 1.4 }}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
