import { useState, useEffect, useMemo } from 'react';
import { Shield, CheckCircle, XCircle, AlertTriangle, Loader2, Info } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { supabase, getStations, getDemoStations, getDemoHistory } from '../lib/supabase';
import { glass, glassInner, NCEC_STANDARDS, POLLUTANTS } from '../lib/utils';

// ── helpers ──────────────────────────────────────────────────────────────────

function rollingAvg(readings, key, hours) {
  const ms = hours * 3600000;
  return readings.map(r => {
    const t = new Date(r.timestamp).getTime();
    const vals = readings
      .filter(x => { const xt = new Date(x.timestamp).getTime(); return xt >= t - ms && xt <= t; })
      .map(x => x[key]).filter(v => v != null && !isNaN(Number(v))).map(Number);
    return { timestamp: r.timestamp, value: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
  });
}

function dailyAvg(readings, key) {
  const groups = {};
  readings.forEach(r => {
    const day = r.timestamp.slice(0, 10);
    if (!groups[day]) groups[day] = [];
    if (r[key] != null && !isNaN(Number(r[key]))) groups[day].push(Number(r[key]));
  });
  return Object.entries(groups).map(([date, vals]) => ({
    date,
    avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
  }));
}

function annualAvg(readings, key) {
  const vals = readings.map(r => r[key]).filter(v => v != null && !isNaN(Number(v))).map(Number);
  return vals.length ? [{ value: vals.reduce((a, b) => a + b, 0) / vals.length }] : [];
}

function computeCompliance(readings, period) {
  return Object.entries(NCEC_STANDARDS).flatMap(([key, meta]) => {
    const matchingStds = meta.standards.filter(s => {
      if (period === '1-hour')  return s.period === '1-hour';
      if (period === '8-hour')  return s.period === '8-hour';
      if (period === '24-hour') return s.period === '24-hour';
      if (period === 'annual')  return s.period === '1-year';
      return false;
    });
    return matchingStds.map(std => {
      let values;
      if (std.period === '1-hour')  values = rollingAvg(readings, key, 1).map(h => h.value).filter(v => v != null);
      else if (std.period === '8-hour') values = rollingAvg(readings, key, 8).map(h => h.value).filter(v => v != null);
      else if (std.period === '24-hour') values = dailyAvg(readings, key).map(d => d.avg).filter(v => v != null);
      else values = annualAvg(readings, key).map(d => d.value).filter(v => v != null);

      const exceedCount = values.filter(v => v > std.limit).length;
      const maxVal = values.length ? Math.max(...values) : null;
      const avgVal = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      return {
        key, label: meta.label, unit: meta.unit, color: meta.color,
        period: std.period, limit: std.limit, exceedances: std.exceedances,
        exceedCount, maxVal, avgVal, dataPoints: values.length,
        compliant: exceedCount === 0,
      };
    });
  });
}

// Build daily exceedance chart data
function buildExceedanceHistory(readings) {
  const days = {};
  readings.forEach(r => { const d = r.timestamp.slice(0, 10); if (!days[d]) days[d] = []; days[d].push(r); });
  return Object.entries(days).sort(([a], [b]) => a.localeCompare(b)).map(([date, recs]) => {
    const entry = { date: date.slice(5) }; // MM-DD
    Object.entries(NCEC_STANDARDS).forEach(([key, meta]) => {
      const std24 = meta.standards.find(s => s.period === '24-hour') || meta.standards[0];
      const vals = recs.map(r => r[key]).filter(v => v != null && !isNaN(Number(v))).map(Number);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      entry[key] = avg != null && avg > std24.limit ? 1 : 0;
    });
    entry.total = Object.entries(NCEC_STANDARDS).reduce((s, [key]) => s + (entry[key] || 0), 0);
    return entry;
  });
}

const fmtN = (v, d = 1) => v != null && !isNaN(Number(v)) ? Number(v).toFixed(d) : '—';

const PERIODS = [
  { id: '1-hour',  label: '1-Hour' },
  { id: '8-hour',  label: '8-Hour' },
  { id: '24-hour', label: '24-Hour' },
  { id: 'annual',  label: 'Annual' },
];

const GlassTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ ...glass({ borderRadius: 10, padding: '8px 12px' }), boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
      <p style={{ color: 'var(--text-muted)', fontSize: 10, margin: '0 0 4px', fontFamily: 'DM Mono, monospace' }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.fill, fontSize: 11, margin: '1px 0', fontWeight: 600 }}>
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  );
};

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Compliance({ profile }) {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  const [stations, setStations]       = useState([]);
  const [selIdx, setSelIdx]           = useState(0);
  const [period, setPeriod]           = useState('24-hour');
  const [from, setFrom]               = useState(weekAgo);
  const [to, setTo]                   = useState(today);
  const [readings, setReadings]       = useState([]);
  const [loading, setLoading]         = useState(false);
  const [loadingCount, setLoadingCount] = useState(0);
  const [isDemo, setIsDemo]           = useState(false);

  // Load stations
  useEffect(() => {
    getStations().then(st => {
      if (st.length) { setStations(st); setIsDemo(false); }
      else { setStations(getDemoStations()); setIsDemo(true); }
    });
  }, []);

  // Load readings when station/range changes
  useEffect(() => {
    if (!stations.length) return;
    const station = stations[selIdx];
    if (!station) return;
    setLoading(true);
    setLoadingCount(0);
    const load = async () => {
      try {
        if (isDemo) {
          const hours = Math.max(1, Math.ceil((new Date(to) - new Date(from)) / 3600000));
          setReadings(getDemoHistory(station.id, Math.min(hours, 720)));
        } else {
          // Chunked pagination — PostgREST caps at 1,000 rows per request
          const fromISO = from + 'T00:00:00';
          const toISO   = to   + 'T23:59:59';
          const CHUNK   = 1000;
          let all = [], offset = 0;
          while (true) {
            const { data, error: e } = await supabase
              .from('readings').select('*')
              .eq('station_id', station.id)
              .gte('timestamp', fromISO).lte('timestamp', toISO)
              .order('timestamp', { ascending: true })
              .range(offset, offset + CHUNK - 1);
            if (e) throw new Error(e.message);
            if (!data || !data.length) break;
            all = all.concat(data);
            setLoadingCount(all.length);
            if (data.length < CHUNK) break;
            offset += CHUNK;
          }
          setReadings(all);
        }
      } catch { setReadings([]); }
      setLoading(false);
    };
    load();
  }, [selIdx, stations, from, to, isDemo]);

  const compliance = useMemo(() => computeCompliance(readings, period), [readings, period]);
  const excHistory = useMemo(() => buildExceedanceHistory(readings), [readings]);

  const compliantCount   = compliance.filter(r => r.compliant || r.dataPoints === 0).length;
  const nonCompliant     = compliance.filter(r => !r.compliant && r.dataPoints > 0).length;
  const totalWithData    = compliance.filter(r => r.dataPoints > 0).length;
  const overallCompliant = nonCompliant === 0;
  const totalExceedances = compliance.reduce((s, r) => s + r.exceedCount, 0);

  const inputStyle = {
    padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.5)',
    background: 'rgba(255,255,255,0.35)', fontSize: 12, color: 'var(--text)',
    fontFamily: 'var(--font)', outline: 'none', cursor: 'pointer',
  };

  const toggleBtn = (active) => ({
    padding: '6px 14px', borderRadius: 9, border: 'none',
    background: active ? 'rgba(255,255,255,0.65)' : 'transparent',
    boxShadow: active ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
    color: active ? 'var(--text)' : 'var(--text-muted)', fontWeight: active ? 700 : 500,
    fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)', transition: 'all 0.2s',
  });

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>

      {/* Page header */}
      <div style={{ marginBottom: 24, animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) both' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.02em' }}>Compliance</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
          NCEC air quality compliance per Royal Decree M/165 — Saudi Executive Regulation on Air Quality.
        </p>
      </div>

      {isDemo && (
        <div style={{ ...glassInner({ padding: '8px 16px', borderRadius: 10, marginBottom: 16, background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.25)' }), display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={14} color="#CA8A04" />
          <span style={{ fontSize: 12, color: '#CA8A04', fontWeight: 600 }}>Demo Mode — Connect Supabase to see live compliance data</span>
        </div>
      )}

      {/* Controls */}
      <div style={{ ...glass({ padding: '16px 20px', marginBottom: 16 }), display: 'flex', gap: 12, alignItems: isMobile ? 'stretch' : 'center', flexWrap: 'wrap', flexDirection: isMobile ? 'column' : 'row', animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.05s both' }}>
        {/* Station */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Station</span>
          <select value={selIdx} onChange={e => setSelIdx(Number(e.target.value))} style={inputStyle}>
            {stations.map((s, i) => <option key={s.id} value={i}>{s.name}</option>)}
          </select>
        </div>

        {/* Date range */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>From</span>
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>To</span>
          <input type="date" value={to} min={from} max={today} onChange={e => setTo(e.target.value)} style={inputStyle} />
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 36, background: 'rgba(0,0,0,0.08)', flexShrink: 0 }} />

        {/* Period toggle */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Averaging Period</span>
          <div style={{ ...glassInner({ padding: '3px 4px', borderRadius: 11 }), display: 'flex', gap: 2 }}>
            {PERIODS.map(p => (
              <button key={p.id} onClick={() => setPeriod(p.id)} style={toggleBtn(period === p.id)}>{p.label}</button>
            ))}
          </div>
        </div>

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, color: 'var(--text-muted)', fontSize: 12 }}>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
            {loadingCount > 0 ? `Fetching… ${loadingCount.toLocaleString()} readings` : 'Loading…'}
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 14, marginBottom: 16 }}>
        {[
          {
            label: 'Overall Status',
            value: overallCompliant ? 'Compliant' : 'Non-Compliant',
            sub: `${readings.length} readings`,
            color: overallCompliant ? '#16A34A' : '#DC2626',
            icon: overallCompliant ? CheckCircle : XCircle,
            bg: overallCompliant ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)',
          },
          {
            label: 'Standards Met',
            value: `${compliance.filter(r => r.compliant && r.dataPoints > 0).length} / ${totalWithData}`,
            sub: 'parameters',
            color: '#16A34A',
            icon: CheckCircle,
            bg: 'rgba(22,163,74,0.06)',
          },
          {
            label: 'Exceedances Found',
            value: totalExceedances,
            sub: nonCompliant > 0 ? `${nonCompliant} parameter${nonCompliant !== 1 ? 's' : ''}` : 'None detected',
            color: totalExceedances > 0 ? '#DC2626' : '#16A34A',
            icon: totalExceedances > 0 ? AlertTriangle : CheckCircle,
            bg: totalExceedances > 0 ? 'rgba(220,38,38,0.06)' : 'rgba(22,163,74,0.06)',
          },
          {
            label: 'Averaging Period',
            value: PERIODS.find(p => p.id === period)?.label || period,
            sub: 'per NCEC M/165',
            color: '#3B82F6',
            icon: Shield,
            bg: 'rgba(59,130,246,0.06)',
          },
        ].map((card, i) => {
          const Icon = card.icon;
          return (
            <div key={i} style={{ ...glass({ padding: '16px 18px', borderRadius: 16 }), animation: `glassIn 0.5s cubic-bezier(.16,1,.3,1) ${0.1 + i * 0.04}s both`, background: card.bg, border: `1px solid rgba(255,255,255,0.55)` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{card.label}</span>
                <Icon size={15} color={card.color} />
              </div>
              <p style={{ fontSize: 22, fontWeight: 700, margin: '0 0 2px', fontFamily: 'DM Mono, monospace', color: card.color, lineHeight: 1 }}>{card.value}</p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>{card.sub}</p>
            </div>
          );
        })}
      </div>

      {/* Compliance table */}
      <div style={{ ...glass({ padding: '20px 24px', marginBottom: 16, borderRadius: 18 }), animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.2s both' }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Shield size={15} color="#16A34A" />
          NCEC Standards — {PERIODS.find(p => p.id === period)?.label} Averaging Period
        </h2>

        {compliance.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-faint)' }}>
            <Shield size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
            <p style={{ fontSize: 13, margin: 0 }}>No applicable standards for the selected averaging period.</p>
            <p style={{ fontSize: 11, marginTop: 4 }}>Try selecting 1-Hour or 24-Hour.</p>
          </div>
        ) : (
          <div data-scroll-x style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', width: '100%' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead>
              <tr>
                {['Pollutant', 'Unit', 'Avg. Period', 'NCEC Limit', 'Measured Avg', 'Measured Max', 'No. Exceedances', 'Allowed', 'Status'].map(h => (
                  <th key={h} style={{ padding: '9px 12px', background: '#16A34A', color: '#fff', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'left', fontFamily: 'Instrument Sans, sans-serif' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {compliance.map((row, i) => {
                const bg = row.dataPoints === 0 ? 'var(--bg-card-solid)' : row.compliant ? 'var(--row-compliant-bg)' : 'var(--row-error-bg)';
                return (
                  <tr key={i} style={{ background: bg }}>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontFamily: 'Instrument Sans, sans-serif', color: row.color, fontSize: 13 }}>{row.label}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, fontFamily: 'DM Mono, monospace', color: 'var(--text)' }}>{row.unit}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, fontFamily: 'DM Mono, monospace', color: 'var(--text)' }}>{row.period}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, fontFamily: 'DM Mono, monospace', fontWeight: 700, color: 'var(--text)' }}>{row.limit.toLocaleString()}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, fontFamily: 'DM Mono, monospace', color: 'var(--text)' }}>{fmtN(row.avgVal)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, fontFamily: 'DM Mono, monospace', color: row.maxVal != null && row.maxVal > row.limit ? '#DC2626' : 'var(--text)', fontWeight: row.maxVal != null && row.maxVal > row.limit ? 700 : 400 }}>{fmtN(row.maxVal)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, fontFamily: 'DM Mono, monospace', fontWeight: 700, color: row.exceedCount > 0 ? '#DC2626' : '#16A34A' }}>{row.dataPoints === 0 ? '—' : row.exceedCount}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)' }}>{row.exceedances || '—'}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                      {row.dataPoints === 0
                        ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-faint)', background: 'rgba(168,162,158,0.12)', padding: '3px 10px', borderRadius: 20 }}>No data</span>
                        : row.compliant
                          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#16A34A', fontWeight: 700, background: 'rgba(22,163,74,0.12)', padding: '3px 10px', borderRadius: 20 }}><CheckCircle size={11} />Compliant</span>
                          : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#DC2626', fontWeight: 700, background: 'rgba(220,38,38,0.10)', padding: '3px 10px', borderRadius: 20 }}><XCircle size={11} />Exceeded</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* Exceedance history chart */}
      {excHistory.length > 1 && (
        <div style={{ ...glass({ padding: '20px 24px', marginBottom: 16, borderRadius: 18 }), animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.25s both' }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px' }}>Daily Exceedance History</h2>
          <p style={{ color: 'var(--text-faint)', fontSize: 11, margin: '0 0 16px' }}>
            Number of pollutants exceeding their 24-hour NCEC threshold per day
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={excHistory} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" />
              <XAxis dataKey="date" tick={{ fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'DM Mono, monospace' }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'DM Mono, monospace' }} axisLine={false} tickLine={false} domain={[0, 6]} />
              <Tooltip content={<GlassTooltip />} />
              <ReferenceLine y={0} stroke="rgba(0,0,0,0.1)" />
              {Object.entries(NCEC_STANDARDS).map(([key, meta]) => (
                <Bar key={key} dataKey={key} stackId="a" fill={meta.color} name={meta.label} radius={[0, 0, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
            {Object.entries(NCEC_STANDARDS).map(([key, meta]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: meta.color, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: 'var(--text-mid)' }}>{meta.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reference note */}
      <div style={{ ...glassInner({ padding: '12px 16px', borderRadius: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }), animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.3s both' }}>
        <Info size={14} color="#78716C" style={{ flexShrink: 0, marginTop: 1 }} />
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
          <strong>Reference:</strong> NCEC Executive Regulation on Air Quality Standards, issued under Royal Decree M/165 (2019), Appendix 1.
          Standards are applied per their specified averaging period: 1-hour, 8-hour, 24-hour, or annual.
          Exceedances are counted against readings in the selected date range only and may not represent calendar-year compliance.
          CO limits: 40,000 µg/m³ (1-hour), 10,000 µg/m³ (8-hour). PM2.5: 35 µg/m³ (24-hour), 15 µg/m³ (annual).
        </p>
      </div>

    </div>
  );
}
