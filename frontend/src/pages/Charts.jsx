import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ComposedChart, Scatter, Line as RLine,
} from 'recharts';
import { Activity, AlertTriangle, TrendingUp, TrendingDown, Download, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Search, GitBranch } from 'lucide-react';
import { getStations, getDemoStations, getDemoHistory, getDemoDaily, getDemoReadings } from '../lib/supabase';
import { glass, glassInner, getAqiLevel, POLLUTANTS, formatTime, formatDate } from '../lib/utils';

const PAGE_SIZE = 20;

// ─── Threshold colour for a cell value ───
const CELL_THRESHOLDS = {
  pm25: { yellow: 35,  red: 55 },
  pm10: { yellow: 250, red: 340 },
  so2:  { red: 441 },
  no2:  { red: 200 },
  o3:   { red: 157 },
  co:   { red: 40000 },
};
function cellColor(key, value) {
  if (value == null) return 'var(--text-muted)';
  const t = CELL_THRESHOLDS[key];
  if (!t) return 'var(--text)';
  if (value >= t.red)                       return '#DC2626';
  if (t.yellow != null && value >= t.yellow) return '#CA8A04';
  return '#16A34A';
}
function cellBg(key, value) {
  const c = cellColor(key, value);
  if (c === '#DC2626') return 'rgba(220,38,38,0.07)';
  if (c === '#CA8A04') return 'rgba(202,138,4,0.07)';
  return 'transparent';
}

// ─── Aggregation ───
function aggregate(rows, mode) {
  if (mode === 'raw') return rows;
  const bucketKey = ts => {
    const d = new Date(ts);
    if (mode === '1min')   return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
    if (mode === 'hourly') return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
    if (mode === '24h')    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  const groups = {};
  rows.forEach(r => {
    const k = bucketKey(r.timestamp);
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });
  const KEYS = [...POLLUTANTS.map(p => p.key), 'aqi', 'temperature', 'humidity', 'wind_speed', 'wind_direction'];
  return Object.values(groups).map(grp => {
    const result = { timestamp: grp[0].timestamp, count: grp.length };
    KEYS.forEach(key => {
      const vals = grp.map(r => r[key]).filter(v => v != null && !isNaN(Number(v))).map(Number);
      result[key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
    return result;
  });
}

// ─── Full timestamp formatter ───
function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

// ─── Glass Tooltip ───
const GlassTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ ...glass({ borderRadius: 10, padding: '8px 12px' }), boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
      <p style={{ color: 'var(--text-muted)', fontSize: 10, margin: 0, marginBottom: 4, fontFamily: 'var(--font-mono)' }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color || p.stroke, fontSize: 12, margin: '1px 0', fontWeight: 600 }}>
          {p.name}: <span style={{ fontFamily: 'var(--font-mono)' }}>{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}</span>
        </p>
      ))}
    </div>
  );
};

// ─── Single Gas Chart Card ───
function GasChart({ pollutant, data }) {
  const { key, name, unit, color, threshold } = pollutant;
  const values = data.map(d => d[key]).filter(v => v != null);
  const current = values.length ? values[values.length - 1] : null;
  const avg = values.length ? (values.reduce((a, b) => a + b, 0) / values.length) : null;
  const min = values.length ? Math.min(...values) : null;
  const maxVal = values.length ? Math.max(...values) : null;
  const over = current != null && current > threshold;
  const prevAvg = values.length > 4 ? values.slice(0, Math.floor(values.length / 2)).reduce((a, b) => a + b, 0) / Math.floor(values.length / 2) : null;
  const trend = avg && prevAvg ? (avg > prevAvg ? 'up' : 'down') : null;
  const trendPct = avg && prevAvg ? Math.abs(((avg - prevAvg) / prevAvg) * 100).toFixed(0) : null;

  return (
    <div style={{ ...glass({ padding: '18px 20px' }), animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) both' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--text)' }}>{name}</h3>
            {over && <AlertTriangle size={14} color="#DC2626" />}
          </div>
          <p style={{ fontSize: 10, color: 'var(--text-faint)', margin: 0 }}>NCEC Limit: {threshold} {unit}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: over ? '#DC2626' : color, margin: 0, lineHeight: 1 }}>
            {current != null ? current.toFixed(1) : '—'}
          </p>
          <p style={{ fontSize: 10, color: 'var(--text-faint)', margin: '2px 0 0' }}>{unit}</p>
          {trend && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', color: trend === 'up' ? '#DC2626' : '#16A34A', marginTop: 2 }}>
              {trend === 'up' ? <TrendingUp size={10} /> : <TrendingDown size={10} />}{trendPct}%
            </span>
          )}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
          <defs>
            <linearGradient id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={color} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" />
          <XAxis dataKey="time" tick={{ fill: 'var(--text-faint)', fontSize: 9, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 9, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} domain={[0, 'auto']} />
          <Tooltip content={<GlassTooltip />} />
          <ReferenceLine y={threshold} stroke="#DC262680" strokeDasharray="4 4" label={{ value: 'NCEC', position: 'right', fontSize: 9, fill: '#DC2626' }} />
          <Area type="monotone" dataKey={key} stroke={color} fill={`url(#grad-${key})`} strokeWidth={2} dot={false} name={name} />
        </AreaChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, padding: '6px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.25)' }}>
        {[{ label: 'Min', value: min }, { label: 'Avg', value: avg }, { label: 'Max', value: maxVal }, { label: 'Limit', value: threshold }].map((s, i) => (
          <div key={i} style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 9, color: 'var(--text-faint)', margin: 0, fontWeight: 600, textTransform: 'uppercase' }}>{s.label}</p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: s.label === 'Max' && s.value > threshold ? '#DC2626' : 'var(--text)', margin: '1px 0 0' }}>
              {s.value != null ? s.value.toFixed(1) : '—'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}


// ─── Sort arrow ───
function SortArrow({ col, sortKey, sortDir }) {
  if (sortKey !== col) return <span style={{ color: '#D6D3D1', marginLeft: 3, fontSize: 9 }}>⇅</span>;
  return sortDir === 'asc'
    ? <ChevronUp size={11} style={{ marginLeft: 2, verticalAlign: 'middle' }} />
    : <ChevronDown size={11} style={{ marginLeft: 2, verticalAlign: 'middle' }} />;
}

// ─── Math helpers ───
function pearsonR(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const dx = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0));
  const dy = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0));
  return dx && dy ? num / (dx * dy) : 0;
}

function linReg(xs, ys) {
  const n = xs.length;
  if (n < 2) return { m: 0, b: 0 };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const m = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const b = my - m * mx;
  return { m, b };
}

function rInterpret(r) {
  const abs = Math.abs(r);
  const sign = r > 0 ? 'positive' : 'negative';
  if (abs >= 0.7) return `Strong ${sign} correlation`;
  if (abs >= 0.4) return `Moderate ${sign} correlation`;
  if (abs >= 0.2) return `Weak ${sign} correlation`;
  return 'No significant correlation';
}

const CORR_PARAMS = [
  { key: 'pm25', name: 'PM₂.₅', unit: 'µg/m³', color: '#3B82F6' },
  { key: 'pm10', name: 'PM₁₀', unit: 'µg/m³', color: '#8B5CF6' },
  { key: 'so2',  name: 'SO₂',  unit: 'µg/m³', color: '#F59E0B' },
  { key: 'no2',  name: 'NO₂',  unit: 'µg/m³', color: '#06B6D4' },
  { key: 'o3',   name: 'O₃',   unit: 'µg/m³', color: '#EC4899' },
  { key: 'co',   name: 'CO',   unit: 'µg/m³', color: '#10B981' },
  { key: 'temperature', name: 'Temp', unit: '°C', color: '#EF4444' },
  { key: 'humidity',    name: 'RH',   unit: '%',  color: '#0EA5E9' },
  { key: 'wind_speed',  name: 'Wind Speed', unit: 'm/s', color: '#A78BFA' },
  { key: 'wind_direction', name: 'Wind Dir', unit: '°', color: '#F97316' },
];

const CORR_PRESETS = [
  { label: 'Wind vs PM₂.₅', x: 'wind_speed', y: 'pm25' },
  { label: 'Temp vs O₃',    x: 'temperature', y: 'o3' },
  { label: 'RH vs PM₂.₅',  x: 'humidity', y: 'pm25' },
  { label: 'WD vs PM₁₀',   x: 'wind_direction', y: 'pm10' },
];

function aqiDotColor(aqi) {
  if (aqi == null) return '#94a3b8';
  if (aqi <= 50)  return '#16A34A';
  if (aqi <= 100) return '#CA8A04';
  if (aqi <= 150) return '#EA580C';
  if (aqi <= 200) return '#DC2626';
  return '#7C3AED';
}

function CorrelationChart({ data }) {
  console.log('[CorrelationChart] rendering, data points:', data?.length);
  const [xKey, setXKey] = useState('wind_speed');
  const [yKey, setYKey] = useState('pm25');

  const xParam = CORR_PARAMS.find(p => p.key === xKey) || CORR_PARAMS[0];
  const yParam = CORR_PARAMS.find(p => p.key === yKey) || CORR_PARAMS[1];

  // Build scatter points from hourly aggregated data
  const points = useMemo(() => {
    return data
      .filter(r => r[xKey] != null && r[yKey] != null)
      .map(r => ({
        x: Number(r[xKey]),
        y: Number(r[yKey]),
        aqi: r.aqi != null ? Number(r.aqi) : null,
      }));
  }, [data, xKey, yKey]);

  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const r = points.length >= 2 ? pearsonR(xs, ys) : 0;
  const { m, b } = points.length >= 2 ? linReg(xs, ys) : { m: 0, b: 0 };

  // Trend line: 2 points from min to max x
  const xMin = xs.length ? Math.min(...xs) : 0;
  const xMax = xs.length ? Math.max(...xs) : 1;
  const trendData = xs.length >= 2 ? [
    { x: xMin, y: m * xMin + b },
    { x: xMax, y: m * xMax + b },
  ] : [];

  const rColor = Math.abs(r) >= 0.7 ? '#16A34A' : Math.abs(r) >= 0.4 ? '#F59E0B' : '#94a3b8';

  const selStyle = (active) => ({
    padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
    fontSize: 11, fontWeight: 600, fontFamily: 'var(--font)',
    background: active ? '#0d9488' : 'var(--glass-inner-bg)',
    color: active ? '#fff' : 'var(--text-muted)',
    transition: 'all 0.15s',
  });

  const CustomDot = (props) => {
    const { cx, cy, payload } = props;
    return <circle cx={cx} cy={cy} r={3} fill={aqiDotColor(payload.aqi)} fillOpacity={0.75} stroke="none" />;
  };

  return (
    <div style={{ ...glass({ padding: '20px 24px' }), marginTop: 20, animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) both' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 3px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <GitBranch size={16} color="#0d9488" /> Correlation Analysis
          </h3>
          <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: 0 }}>Scatter plot of parameter relationships</p>
        </div>

        {/* Presets */}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {CORR_PRESETS.map(p => (
            <button key={p.label} onClick={() => { setXKey(p.x); setYKey(p.y); }} style={selStyle(xKey === p.x && yKey === p.y)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Axis selectors */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>X Axis:</span>
          <select value={xKey} onChange={e => setXKey(e.target.value)} style={{ padding: '5px 9px', borderRadius: 8, fontSize: 12, color: 'var(--text)', background: 'var(--glass-inner-bg)', border: '1px solid var(--glass-inner-border)', outline: 'none', fontFamily: 'var(--font)' }}>
            {CORR_PARAMS.map(p => <option key={p.key} value={p.key}>{p.name} ({p.unit})</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Y Axis:</span>
          <select value={yKey} onChange={e => setYKey(e.target.value)} style={{ padding: '5px 9px', borderRadius: 8, fontSize: 12, color: 'var(--text)', background: 'var(--glass-inner-bg)', border: '1px solid var(--glass-inner-border)', outline: 'none', fontFamily: 'var(--font)' }}>
            {CORR_PARAMS.map(p => <option key={p.key} value={p.key}>{p.name} ({p.unit})</option>)}
          </select>
        </div>

        {/* R value badge */}
        {points.length >= 2 && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 10, color: 'var(--text-faint)', margin: 0, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Pearson R</p>
              <p style={{ fontSize: 22, fontWeight: 700, margin: 0, fontFamily: 'var(--mono)', color: rColor, lineHeight: 1 }}>{r.toFixed(3)}</p>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '2px 0 0' }}>{rInterpret(r)}</p>
            </div>
          </div>
        )}
      </div>

      {points.length < 2 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-faint)', fontSize: 13 }}>
          Not enough data points — select a longer time range
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
            <XAxis
              dataKey="x" type="number" domain={['auto', 'auto']}
              name={xParam.name}
              label={{ value: `${xParam.name} (${xParam.unit})`, position: 'insideBottom', offset: -10, fill: 'var(--text-muted)', fontSize: 11 }}
              tick={{ fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'var(--mono)' }}
              axisLine={false} tickLine={false}
            />
            <YAxis
              dataKey="y" type="number" domain={['auto', 'auto']}
              name={yParam.name}
              label={{ value: `${yParam.name} (${yParam.unit})`, angle: -90, position: 'insideLeft', offset: 10, fill: 'var(--text-muted)', fontSize: 11 }}
              tick={{ fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'var(--mono)' }}
              axisLine={false} tickLine={false}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload || {};
                return (
                  <div style={{ ...glass({ padding: '8px 12px', borderRadius: 10 }), boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
                    <p style={{ fontSize: 11, color: 'var(--text)', margin: 0 }}>
                      {xParam.name}: <strong style={{ fontFamily: 'var(--mono)' }}>{typeof d.x === 'number' ? d.x.toFixed(2) : d.x}</strong>
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--text)', margin: '2px 0 0' }}>
                      {yParam.name}: <strong style={{ fontFamily: 'var(--mono)' }}>{typeof d.y === 'number' ? d.y.toFixed(2) : d.y}</strong>
                    </p>
                    {d.aqi != null && <p style={{ fontSize: 10, color: aqiDotColor(d.aqi), margin: '2px 0 0' }}>AQI: {Math.round(d.aqi)}</p>}
                  </div>
                );
              }}
            />
            <Scatter data={points} shape={<CustomDot />} />
            {trendData.length === 2 && (
              <RLine
                data={trendData}
                dataKey="y"
                dot={false}
                stroke="#0d9488"
                strokeWidth={2}
                strokeDasharray="6 3"
                type="linear"
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {/* AQI color legend */}
      <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-faint)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Dot color = AQI:</span>
        {[['#16A34A','Good (0-50)'],['#CA8A04','Moderate (51-100)'],['#EA580C','USG (101-150)'],['#DC2626','Unhealthy (151-200)'],['#7C3AED','Very Unhealthy (200+)'],['#94a3b8','Unknown']].map(([c, l]) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══ Charts Page ═══
export default function Charts({ profile }) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isPhone, setIsPhone] = useState(window.innerWidth < 480);
  useEffect(() => {
    const handle = () => { setIsMobile(window.innerWidth < 768); setIsPhone(window.innerWidth < 480); };
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, []);

  const { stationId } = useParams();
  const [stations, setStations]     = useState([]);
  const [selIdx, setSelIdx]         = useState(0);
  const [timeRange, setTimeRange]   = useState('24h');
  const [data, setData]             = useState([]);
  const [overlayKeys, setOverlayKeys] = useState(['pm25', 'pm10', 'o3']);

  // Table state
  const [aggMode, setAggMode]   = useState('raw');
  const [sortKey, setSortKey]   = useState('timestamp');
  const [sortDir, setSortDir]   = useState('desc');
  const [filter, setFilter]     = useState('');
  const [page, setPage]         = useState(0);

  useEffect(() => {
    async function load() {
      try {
        const st = await getStations();
        if (st.length > 0) setStations(st);
        else throw new Error('No stations');
      } catch { setStations(getDemoStations()); }
    }
    load();
  }, []);

  useEffect(() => {
    if (stationId && stations.length) {
      const idx = stations.findIndex(s => s.id === stationId);
      if (idx >= 0) setSelIdx(idx);
    }
  }, [stationId, stations]);

  useEffect(() => {
    if (!stations.length) return;
    const sid = stations[selIdx]?.id;
    if (!sid) return;
    const hours = { '1h': 1, '6h': 6, '12h': 12, '24h': 24, '7d': 168, '30d': 720 }[timeRange] || 24;
    const hist = getDemoHistory(sid, hours);
    setData(hist.map(r => ({
      ...r,
      time: hours <= 24 ? formatTime(r.timestamp) : formatDate(r.timestamp),
    })));
    setPage(0);
  }, [selIdx, timeRange, stations]);

  // Reset page when filter/agg/sort changes
  useEffect(() => { setPage(0); }, [aggMode, filter, sortKey, sortDir]);

  const station = stations[selIdx] || {};

  function toggleOverlay(key) {
    setOverlayKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  // ─── Derived table rows ───
  const tableRows = useMemo(() => {
    let rows = aggregate(data, aggMode);

    // Filter
    if (filter.trim()) {
      const q = filter.toLowerCase();
      rows = rows.filter(r =>
        Object.values(r).some(v => v != null && String(v).toLowerCase().includes(q))
      );
    }

    // Sort
    rows = [...rows].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return rows;
  }, [data, aggMode, filter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE));
  const pageRows   = tableRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const showCount  = aggMode !== 'raw';

  // ─── Export CSV ───
  function exportCSV() {
    if (!data.length) return;
    const rows = aggregate(data, aggMode);
    const pollutantHeaders = POLLUTANTS.map(p => `${p.name} (${p.unit})`);
    const headers = ['Timestamp', ...(showCount ? ['Count'] : []), ...pollutantHeaders, 'Temp (°C)', 'Humidity (%)', 'Wind Speed (m/s)', 'Wind Dir (°)'];
    const keys    = ['timestamp', ...(showCount ? ['count'] : []), ...POLLUTANTS.map(p => p.key), 'temperature', 'humidity', 'wind_speed', 'wind_direction'];
    const csv = [
      headers.join(','),
      ...rows.map(r => keys.map(k => {
        const v = r[k];
        if (k === 'timestamp') return `"${fmtTs(v)}"`;
        return v != null ? (typeof v === 'number' ? v.toFixed(2) : v) : '';
      }).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `${station.name?.replace(/\s+/g, '_') || 'station'}_${timeRange}_${aggMode}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Shared button style ───
  const toggleBtn = (active, color = 'var(--text)') => ({
    padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
    background: active ? 'rgba(255,255,255,0.7)' : 'transparent',
    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
    fontSize: 11, fontWeight: active ? 700 : 500,
    color: active ? color : 'var(--text-faint)',
    transition: 'all 0.2s', fontFamily: 'var(--font)',
  });

  const thStyle = (col) => ({
    padding: '8px 10px', textAlign: 'left', borderBottom: '2px solid rgba(255,255,255,0.4)',
    color: sortKey === col ? 'var(--text)' : 'var(--text-muted)',
    fontWeight: 700, fontSize: 10, whiteSpace: 'nowrap',
    cursor: 'pointer', userSelect: 'none',
    background: sortKey === col ? 'rgba(255,255,255,0.25)' : 'transparent',
    transition: 'background 0.15s',
  });

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Header: Station selector + Time range */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12, flexDirection: isMobile ? 'column' : 'row' }}>
        <div style={{ ...glassInner({ padding: '4px 6px', borderRadius: 12 }), display: 'flex', gap: 3, overflowX: 'auto' }}>
          {stations.map((s, i) => (
            <button key={s.id} onClick={() => setSelIdx(i)} style={{
              padding: '6px 12px', borderRadius: 9, border: 'none', cursor: 'pointer',
              background: selIdx === i ? 'rgba(255,255,255,0.65)' : 'transparent',
              boxShadow: selIdx === i ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
              fontSize: 11, fontWeight: selIdx === i ? 700 : 500, color: selIdx === i ? 'var(--text)' : 'var(--text-muted)',
              whiteSpace: 'nowrap', transition: 'all 0.2s', fontFamily: 'var(--font)',
            }}>{s.name}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ ...glassInner({ padding: '3px 4px', borderRadius: 10 }), display: 'flex', gap: 2 }}>
            {['1h', '6h', '12h', '24h', '7d', '30d'].map(t => (
              <button key={t} onClick={() => setTimeRange(t)} style={{
                padding: isMobile ? '8px 10px' : '5px 10px', minHeight: isMobile ? 44 : undefined,
                borderRadius: 7, border: 'none', cursor: 'pointer',
                fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)',
                background: timeRange === t ? 'rgba(255,255,255,0.7)' : 'transparent',
                color: timeRange === t ? 'var(--text)' : 'var(--text-faint)',
                boxShadow: timeRange === t ? '0 1px 3px rgba(0,0,0,0.05)' : 'none',
                transition: 'all 0.2s',
              }}>{t}</button>
            ))}
          </div>
          <button onClick={exportCSV} style={{
            ...glassInner({ padding: '6px 12px', borderRadius: 10 }),
            border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 11, fontWeight: 600, color: '#3B82F6', transition: 'background 0.2s', fontFamily: 'var(--font)',
          }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.5)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
          >
            <Download size={12} />Export CSV
          </button>
        </div>
      </div>

      {/* Gas charts grid */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 14, marginBottom: 16 }}>
        {POLLUTANTS.map(p => <GasChart key={p.key} pollutant={p} data={data} />)}
      </div>

      {/* Multi-pollutant overlay */}
      <div style={{ ...glass({ padding: '20px 22px', marginBottom: 16 }), animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.3s both' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Multi-Pollutant Overlay</h2>
            <p style={{ color: 'var(--text-faint)', fontSize: 11, margin: '2px 0 0' }}>Compare pollutants on one chart — click to toggle</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {POLLUTANTS.map(p => (
            <button key={p.key} onClick={() => toggleOverlay(p.key)} style={{
              padding: '4px 12px', borderRadius: 8, border: `1.5px solid ${overlayKeys.includes(p.key) ? p.color : 'rgba(255,255,255,0.4)'}`,
              background: overlayKeys.includes(p.key) ? `${p.color}15` : 'transparent',
              cursor: 'pointer', fontSize: 11, fontWeight: 600, color: overlayKeys.includes(p.key) ? p.color : 'var(--text-faint)',
              transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font)',
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: overlayKeys.includes(p.key) ? p.color : '#D6D3D1' }} />
              {p.name}
            </button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={isMobile ? 200 : 300}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" />
            <XAxis dataKey="time" tick={{ fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
            <Tooltip content={<GlassTooltip />} />
            {POLLUTANTS.filter(p => overlayKeys.includes(p.key)).map(p => (
              <Line key={p.key} type="monotone" dataKey={p.key} stroke={p.color} strokeWidth={2} dot={false} name={p.name} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ─── Correlation Analysis ─── */}
      <CorrelationChart data={aggregate(data, 'hourly')} />

      {/* ─── Data Table ─── */}
      <div style={{ ...glass({ padding: '20px 22px' }), animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.4s both' }}>

        {/* Table toolbar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Data Table</h2>
            {/* Aggregation toggle */}
            <div style={{ ...glassInner({ padding: '3px 4px', borderRadius: 9 }), display: 'flex', gap: 2 }}>
              {[
                { id: 'raw',    label: 'Raw' },
                { id: '1min',   label: '1-Min Avg' },
                { id: 'hourly', label: 'Hourly Avg' },
                { id: '24h',    label: '24-Hr Avg' },
              ].map(m => (
                <button key={m.id} onClick={() => setAggMode(m.id)} style={toggleBtn(aggMode === m.id)}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Search filter */}
          <div style={{ position: 'relative' }}>
            <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }} />
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter readings…"
              style={{
                paddingLeft: 28, paddingRight: 10, paddingTop: 6, paddingBottom: 6,
                borderRadius: 9, border: '1px solid rgba(255,255,255,0.5)',
                background: 'rgba(255,255,255,0.35)', backdropFilter: 'blur(8px)',
                fontSize: 11, color: 'var(--text)', fontFamily: 'var(--font)',
                outline: 'none', width: 190,
              }}
            />
          </div>
        </div>

        {/* Table */}
        <div data-scroll-x style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', width: '100%' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)', minWidth: 800 }}>
            <thead>
              <tr>
                {/* Timestamp */}
                <th style={{ ...thStyle('timestamp'), position: 'sticky', left: 0, zIndex: 2, background: sortKey === 'timestamp' ? 'rgba(240,237,233,0.95)' : 'rgba(232,228,222,0.95)' }} onClick={() => handleSort('timestamp')}>
                  Timestamp <SortArrow col="timestamp" sortKey={sortKey} sortDir={sortDir} />
                </th>
                {/* Count (aggregated modes) */}
                {showCount && (
                  <th style={thStyle('count')} onClick={() => handleSort('count')}>
                    # <SortArrow col="count" sortKey={sortKey} sortDir={sortDir} />
                  </th>
                )}
                {/* Pollutants */}
                {POLLUTANTS.map(p => (
                  <th key={p.key} style={thStyle(p.key)} onClick={() => handleSort(p.key)}>
                    {p.name}
                    <span style={{ color: 'var(--text-faint)', fontWeight: 400, marginLeft: 2 }}>{p.unit}</span>
                    <SortArrow col={p.key} sortKey={sortKey} sortDir={sortDir} />
                  </th>
                ))}
                {/* Met */}
                {[
                  { key: 'temperature',   label: 'Temp',     unit: '°C' },
                  { key: 'humidity',      label: 'Humidity', unit: '%'  },
                  { key: 'wind_speed',    label: 'Wind',     unit: 'm/s' },
                ].map(col => (
                  <th key={col.key} style={thStyle(col.key)} onClick={() => handleSort(col.key)}>
                    {col.label}
                    <span style={{ color: 'var(--text-faint)', fontWeight: 400, marginLeft: 2 }}>{col.unit}</span>
                    <SortArrow col={col.key} sortKey={sortKey} sortDir={sortDir} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={99} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-faint)', fontFamily: 'var(--font)' }}>
                    No readings match your filter.
                  </td>
                </tr>
              ) : pageRows.map((row, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? 'rgba(255,255,255,0.15)' : 'transparent' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'rgba(255,255,255,0.15)' : 'transparent'}
                >
                  {/* Timestamp */}
                  <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: 'var(--text-mid)', position: 'sticky', left: 0, zIndex: 1, background: 'inherit' }}>
                    {fmtTs(row.timestamp)}
                  </td>
                  {/* Count */}
                  {showCount && (
                    <td style={{ padding: '6px 10px', color: 'var(--text-muted)', textAlign: 'center' }}>{row.count}</td>
                  )}
                  {/* Pollutant cells */}
                  {POLLUTANTS.map(p => {
                    const v = row[p.key];
                    const color = cellColor(p.key, v);
                    const bg    = cellBg(p.key, v);
                    return (
                      <td key={p.key} style={{ padding: '6px 10px', color, fontWeight: color !== 'var(--text)' && color !== 'var(--text-muted)' ? 700 : 400, background: bg, transition: 'background 0.15s' }}>
                        {v != null ? v.toFixed(1) : '—'}
                      </td>
                    );
                  })}
                  {/* Met cells */}
                  <td style={{ padding: '6px 10px', color: 'var(--text)' }}>{row.temperature != null ? row.temperature.toFixed(1) : '—'}</td>
                  <td style={{ padding: '6px 10px', color: 'var(--text)' }}>{row.humidity    != null ? row.humidity.toFixed(0)    : '—'}</td>
                  <td style={{ padding: '6px 10px', color: 'var(--text)' }}>{row.wind_speed  != null ? row.wind_speed.toFixed(1)  : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font)' }}>
            {tableRows.length === 0
              ? 'No readings'
              : `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, tableRows.length)} of ${tableRows.length} ${aggMode === 'raw' ? 'readings' : 'periods'}`
            }
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={() => setPage(0)}
              disabled={page === 0}
              style={{ ...glassInner({ padding: '4px 8px', borderRadius: 7 }), border: 'none', cursor: page === 0 ? 'default' : 'pointer', fontSize: 10, color: page === 0 ? '#D6D3D1' : 'var(--text-mid)', fontFamily: 'var(--font)' }}
            >«</button>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{ ...glassInner({ padding: '4px 7px', borderRadius: 7 }), border: 'none', cursor: page === 0 ? 'default' : 'pointer', color: page === 0 ? '#D6D3D1' : 'var(--text-mid)', display: 'flex', alignItems: 'center' }}
            ><ChevronLeft size={13} /></button>

            {/* Page number pills */}
            {isPhone
              ? <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', padding: '0 6px' }}>{page + 1} / {totalPages}</span>
              : Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const offset = Math.max(0, Math.min(page - 2, totalPages - 5));
                  const pg = offset + i;
                  return (
                    <button key={pg} onClick={() => setPage(pg)} style={{
                      width: 28, height: 28, borderRadius: 7, border: 'none', cursor: 'pointer',
                      background: pg === page ? 'rgba(255,255,255,0.7)' : 'transparent',
                      boxShadow: pg === page ? '0 1px 3px rgba(0,0,0,0.07)' : 'none',
                      fontSize: 11, fontWeight: pg === page ? 700 : 400, color: pg === page ? 'var(--text)' : 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                    }}>{pg + 1}</button>
                  );
                })
            }

            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              style={{ ...glassInner({ padding: '4px 7px', borderRadius: 7 }), border: 'none', cursor: page >= totalPages - 1 ? 'default' : 'pointer', color: page >= totalPages - 1 ? '#D6D3D1' : 'var(--text-mid)', display: 'flex', alignItems: 'center' }}
            ><ChevronRight size={13} /></button>
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={page >= totalPages - 1}
              style={{ ...glassInner({ padding: '4px 8px', borderRadius: 7 }), border: 'none', cursor: page >= totalPages - 1 ? 'default' : 'pointer', fontSize: 10, color: page >= totalPages - 1 ? '#D6D3D1' : 'var(--text-mid)', fontFamily: 'var(--font)' }}
            >»</button>
          </div>
        </div>
      </div>

    </div>
  );
}
