import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Activity, AlertTriangle, TrendingUp, TrendingDown, Download } from 'lucide-react';
import { getStations, getDemoStations, getDemoHistory, getDemoDaily, getDemoReadings } from '../lib/supabase';
import { glass, glassInner, getAqiLevel, POLLUTANTS, formatTime, formatDate } from '../lib/utils';

// ─── Glass Tooltip ───
const GlassTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ ...glass({ borderRadius: 10, padding: '8px 12px' }), boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
      <p style={{ color: '#78716C', fontSize: 10, margin: 0, marginBottom: 4, fontFamily: 'var(--font-mono)' }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color || p.stroke, fontSize: 12, margin: '1px 0', fontWeight: 600 }}>
          {p.name}: <span style={{ fontFamily: 'var(--font-mono)' }}>{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}</span>
        </p>
      ))}
    </div>
  );
};

// ─── Single Gas Chart Card ───
function GasChart({ pollutant, data, timeRange }) {
  const { key, name, unit, color, threshold, max } = pollutant;
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
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: '#1C1917' }}>{name}</h3>
            {over && <AlertTriangle size={14} color="#DC2626" />}
          </div>
          <p style={{ fontSize: 10, color: '#A8A29E', margin: 0 }}>NCEC Limit: {threshold} {unit}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: over ? '#DC2626' : color, margin: 0, lineHeight: 1 }}>
            {current != null ? current.toFixed(1) : '—'}
          </p>
          <p style={{ fontSize: 10, color: '#A8A29E', margin: '2px 0 0' }}>{unit}</p>
          {trend && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', color: trend === 'up' ? '#DC2626' : '#16A34A', marginTop: 2 }}>
              {trend === 'up' ? <TrendingUp size={10} /> : <TrendingDown size={10} />}{trendPct}%
            </span>
          )}
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
          <defs>
            <linearGradient id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={color} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" />
          <XAxis dataKey="time" tick={{ fill: '#A8A29E', fontSize: 9, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fill: '#A8A29E', fontSize: 9, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} domain={[0, 'auto']} />
          <Tooltip content={<GlassTooltip />} />
          <ReferenceLine y={threshold} stroke="#DC262680" strokeDasharray="4 4" label={{ value: 'NCEC', position: 'right', fontSize: 9, fill: '#DC2626' }} />
          <Area type="monotone" dataKey={key} stroke={color} fill={`url(#grad-${key})`} strokeWidth={2} dot={false} name={name} />
        </AreaChart>
      </ResponsiveContainer>

      {/* Stats row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, padding: '6px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.25)' }}>
        {[
          { label: 'Min', value: min },
          { label: 'Avg', value: avg },
          { label: 'Max', value: maxVal },
          { label: 'Limit', value: threshold },
        ].map((s, i) => (
          <div key={i} style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 9, color: '#A8A29E', margin: 0, fontWeight: 600, textTransform: 'uppercase' }}>{s.label}</p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: s.label === 'Max' && s.value > threshold ? '#DC2626' : '#1C1917', margin: '1px 0 0' }}>
              {s.value != null ? s.value.toFixed(1) : '—'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══ Charts Page ═══
export default function Charts({ profile }) {
  const { stationId } = useParams();
  const [stations, setStations] = useState([]);
  const [selIdx, setSelIdx] = useState(0);
  const [timeRange, setTimeRange] = useState('24h');
  const [data, setData] = useState([]);
  const [overlayKeys, setOverlayKeys] = useState(['pm25', 'pm10', 'o3']);

  useEffect(() => {
    async function load() {
      try {
        const st = await getStations();
        if (st.length > 0) { setStations(st); }
        else throw new Error('No stations');
      } catch { setStations(getDemoStations()); }
    }
    load();
  }, []);

  // Set selected station from URL param
  useEffect(() => {
    if (stationId && stations.length) {
      const idx = stations.findIndex(s => s.id === stationId);
      if (idx >= 0) setSelIdx(idx);
    }
  }, [stationId, stations]);

  // Load data when station or time range changes
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
  }, [selIdx, timeRange, stations]);

  const station = stations[selIdx] || {};

  function toggleOverlay(key) {
    setOverlayKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  function exportCSV() {
    if (!data.length) return;
    const headers = ['timestamp', ...POLLUTANTS.map(p => p.key), 'temperature', 'humidity', 'wind_speed', 'wind_direction'];
    const csv = [headers.join(','), ...data.map(r => headers.map(h => r[h] ?? '').join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${station.slug || 'station'}_${timeRange}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Header: Station selector + Time range */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        {/* Station tabs */}
        <div style={{ ...glassInner({ padding: '4px 6px', borderRadius: 12 }), display: 'flex', gap: 3, overflowX: 'auto' }}>
          {stations.map((s, i) => (
            <button key={s.id} onClick={() => setSelIdx(i)} style={{
              padding: '6px 12px', borderRadius: 9, border: 'none', cursor: 'pointer',
              background: selIdx === i ? 'rgba(255,255,255,0.65)' : 'transparent',
              boxShadow: selIdx === i ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
              fontSize: 11, fontWeight: selIdx === i ? 700 : 500, color: selIdx === i ? '#1C1917' : '#78716C',
              whiteSpace: 'nowrap', transition: 'all 0.2s',
            }}>{s.name}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Time range */}
          <div style={{ ...glassInner({ padding: '3px 4px', borderRadius: 10 }), display: 'flex', gap: 2 }}>
            {['1h', '6h', '12h', '24h', '7d', '30d'].map(t => (
              <button key={t} onClick={() => setTimeRange(t)} style={{
                padding: '5px 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
                fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)',
                background: timeRange === t ? 'rgba(255,255,255,0.7)' : 'transparent',
                color: timeRange === t ? '#1C1917' : '#A8A29E',
                boxShadow: timeRange === t ? '0 1px 3px rgba(0,0,0,0.05)' : 'none',
                transition: 'all 0.2s',
              }}>{t}</button>
            ))}
          </div>

          {/* Export */}
          <button onClick={exportCSV} style={{
            ...glassInner({ padding: '6px 12px', borderRadius: 10 }),
            border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 11, fontWeight: 600, color: '#3B82F6', transition: 'background 0.2s',
          }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.5)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
          >
            <Download size={12} />Export CSV
          </button>
        </div>
      </div>

      {/* Row 1: Individual gas charts (3x2 grid) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 16 }}>
        {POLLUTANTS.map(p => (
          <GasChart key={p.key} pollutant={p} data={data} timeRange={timeRange} />
        ))}
      </div>

      {/* Row 2: Multi-pollutant overlay */}
      <div style={{ ...glass({ padding: '20px 22px', marginBottom: 16 }), animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.3s both' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Multi-Pollutant Overlay</h2>
            <p style={{ color: '#A8A29E', fontSize: 11, margin: '2px 0 0' }}>Compare pollutants on one chart — click to toggle</p>
          </div>
        </div>

        {/* Toggle buttons */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {POLLUTANTS.map(p => (
            <button key={p.key} onClick={() => toggleOverlay(p.key)} style={{
              padding: '4px 12px', borderRadius: 8, border: `1.5px solid ${overlayKeys.includes(p.key) ? p.color : 'rgba(255,255,255,0.4)'}`,
              background: overlayKeys.includes(p.key) ? `${p.color}15` : 'transparent',
              cursor: 'pointer', fontSize: 11, fontWeight: 600, color: overlayKeys.includes(p.key) ? p.color : '#A8A29E',
              transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: overlayKeys.includes(p.key) ? p.color : '#D6D3D1' }} />
              {p.name}
            </button>
          ))}
        </div>

        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" />
            <XAxis dataKey="time" tick={{ fill: '#A8A29E', fontSize: 10, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#A8A29E', fontSize: 10, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
            <Tooltip content={<GlassTooltip />} />
            {POLLUTANTS.filter(p => overlayKeys.includes(p.key)).map(p => (
              <Line key={p.key} type="monotone" dataKey={p.key} stroke={p.color} strokeWidth={2} dot={false} name={p.name} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Row 3: Data Table */}
      <div style={{ ...glass({ padding: '20px 22px' }), animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.4s both', overflowX: 'auto' }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 12px' }}>Raw Data</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
          <thead>
            <tr>
              {['Time', ...POLLUTANTS.map(p => p.name), 'Temp', 'Humidity', 'Wind'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.4)', color: '#78716C', fontWeight: 600, fontSize: 10, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.slice(-20).reverse().map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? 'rgba(255,255,255,0.15)' : 'transparent' }}>
                <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: '#57534E' }}>{row.time}</td>
                {POLLUTANTS.map(p => {
                  const v = row[p.key];
                  const over = v != null && v > p.threshold;
                  return <td key={p.key} style={{ padding: '6px 10px', color: over ? '#DC2626' : '#1C1917', fontWeight: over ? 700 : 400 }}>{v != null ? v.toFixed(1) : '—'}</td>;
                })}
                <td style={{ padding: '6px 10px', color: '#1C1917' }}>{row.temperature?.toFixed(1) ?? '—'}</td>
                <td style={{ padding: '6px 10px', color: '#1C1917' }}>{row.humidity?.toFixed(0) ?? '—'}</td>
                <td style={{ padding: '6px 10px', color: '#1C1917' }}>{row.wind_speed?.toFixed(1) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.length > 20 && <p style={{ color: '#A8A29E', fontSize: 10, marginTop: 8, textAlign: 'center' }}>Showing latest 20 of {data.length} readings</p>}
      </div>
    </div>
  );
}
