import { useState, useEffect, useMemo } from 'react';
import { Wind, AlertTriangle, Navigation, Gauge, Activity } from 'lucide-react';
import { getStations, getDemoStations, getDemoHistory, getReadingsByDateRange } from '../lib/supabase';
import { glass, glassInner } from '../lib/utils';

// ── Constants ─────────────────────────────────────────────────────────────────

const WIND_DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

const WIND_SPEED_BINS = [
  { label: 'Calm',        range: '≤0.5 m/s', min: 0,   max: 0.5,      color: '#D6D3D1' },
  { label: 'Light',       range: '0.5–2 m/s',min: 0.5, max: 2,        color: '#06B6D4' },
  { label: 'Moderate',    range: '2–4 m/s',  min: 2,   max: 4,        color: '#16A34A' },
  { label: 'Fresh',       range: '4–6 m/s',  min: 4,   max: 6,        color: '#F59E0B' },
  { label: 'Strong',      range: '6–8 m/s',  min: 6,   max: 8,        color: '#EA580C' },
  { label: 'Very Strong', range: '8+ m/s',   min: 8,   max: Infinity, color: '#DC2626' },
];

const N_SECTORS = 16;
const TIME_RANGES = [
  { id: '1h',  label: '1h',  hours: 1 },
  { id: '6h',  label: '6h',  hours: 6 },
  { id: '12h', label: '12h', hours: 12 },
  { id: '24h', label: '24h', hours: 24 },
  { id: '7d',  label: '7d',  hours: 168 },
  { id: '30d', label: '30d', hours: 720 },
];

// ── Math helpers ──────────────────────────────────────────────────────────────

function processWindRose(data) {
  const sectors = Array.from({ length: N_SECTORS }, () => new Array(WIND_SPEED_BINS.length).fill(0));
  let calmCount = 0, validCount = 0;
  let speedSum = 0, speedCount = 0, maxSpeed = 0;
  data.forEach(r => {
    const spd = r.wind_speed     != null ? Number(r.wind_speed)     : null;
    const dir = r.wind_direction != null ? Number(r.wind_direction) : null;
    if (spd == null || dir == null || isNaN(spd) || isNaN(dir)) return;
    validCount++;
    if (spd > maxSpeed) maxSpeed = spd;
    if (!isNaN(spd)) { speedSum += spd; speedCount++; }
    if (spd <= 0.5) { calmCount++; return; }
    const si = Math.round(((dir % 360) + 360) % 360 / (360 / N_SECTORS)) % N_SECTORS;
    const bi = WIND_SPEED_BINS.findIndex(b => spd >= b.min && (b.max === Infinity || spd < b.max));
    if (bi >= 0) sectors[si][bi]++;
  });
  const avgSpeed = speedCount > 0 ? speedSum / speedCount : null;
  return { sectors, calmCount, validCount, avgSpeed, maxSpeed: validCount > 0 ? maxSpeed : null };
}

function polarPt(cx, cy, r, deg) {
  const rad = deg * Math.PI / 180;
  return [+(cx + r * Math.sin(rad)).toFixed(2), +(cy - r * Math.cos(rad)).toFixed(2)];
}

function petalPath(cx, cy, r1, r2, startDeg, endDeg) {
  const [ax, ay] = polarPt(cx, cy, r2, startDeg);
  const [bx, by] = polarPt(cx, cy, r2, endDeg);
  const la = endDeg - startDeg > 180 ? 1 : 0;
  if (r1 < 0.5)
    return `M ${cx} ${cy} L ${ax} ${ay} A ${r2.toFixed(2)} ${r2.toFixed(2)} 0 ${la} 1 ${bx} ${by} Z`;
  const [cx1, cy1] = polarPt(cx, cy, r1, startDeg);
  const [dx,  dy]  = polarPt(cx, cy, r1, endDeg);
  return `M ${cx1} ${cy1} L ${ax} ${ay} A ${r2.toFixed(2)} ${r2.toFixed(2)} 0 ${la} 1 ${bx} ${by} L ${dx} ${dy} A ${r1.toFixed(2)} ${r1.toFixed(2)} 0 ${la} 0 ${cx1} ${cy1} Z`;
}

const fmtN = (v, d = 1) => v != null && !isNaN(v) ? Number(v).toFixed(d) : '—';

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WindRose({ profile }) {
  const [stations, setStations]   = useState([]);
  const [selIdx, setSelIdx]       = useState(0);
  const [timeRange, setTimeRange] = useState('24h');
  const [data, setData]           = useState([]);
  const [loading, setLoading]     = useState(false);
  const [isDemo, setIsDemo]       = useState(false);
  const [hovered, setHovered]     = useState(null);
  const [isMobile, setIsMobile]   = useState(window.innerWidth <= 768);

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  useEffect(() => {
    getStations().then(st => {
      if (st.length) { setStations(st); setIsDemo(false); }
      else { setStations(getDemoStations()); setIsDemo(true); }
    });
  }, []);

  useEffect(() => {
    if (!stations.length) return;
    const station = stations[selIdx];
    if (!station) return;
    setLoading(true);
    const tr = TIME_RANGES.find(t => t.id === timeRange) || TIME_RANGES[3];
    const load = async () => {
      try {
        if (isDemo) {
          setData(getDemoHistory(station.id, tr.hours));
        } else {
          const since = new Date(Date.now() - tr.hours * 3600000).toISOString();
          const now   = new Date().toISOString();
          setData(await getReadingsByDateRange(station.id, since, now));
        }
      } catch { setData([]); }
      setLoading(false);
    };
    load();
  }, [selIdx, stations, timeRange, isDemo]);

  // Wind rose computation — larger viewBox on mobile so labels don't clip
  const VB = isMobile ? 500 : 460;
  const CX = VB / 2, CY = VB / 2, MAX_R = 165, LABEL_R = isMobile ? 215 : 195, GAP = 0.8;

  const { sectors, calmCount, validCount, avgSpeed, maxSpeed } = useMemo(() => processWindRose(data), [data]);
  const sectorTotals = useMemo(() => sectors.map(s => s.reduce((a, b) => a + b, 0)), [sectors]);
  const maxFreq      = Math.max(...sectorTotals, 1);
  const calmPct      = validCount > 0 ? (calmCount / validCount * 100).toFixed(1) : '—';
  const domIdx       = sectorTotals.indexOf(Math.max(...sectorTotals));

  const petals = useMemo(() => {
    const out = [];
    sectors.forEach((bins, si) => {
      const center = si * (360 / N_SECTORS);
      const half   = 360 / N_SECTORS / 2 - GAP;
      let r0 = 0;
      bins.forEach((count, bi) => {
        const dr = (count / maxFreq) * MAX_R;
        if (count > 0) out.push({ si, bi, count, r1: r0, r2: r0 + dr, start: center - half, end: center + half });
        r0 += dr;
      });
    });
    return out;
  }, [sectors, maxFreq]);

  const rings = [0.25, 0.5, 0.75, 1].map(f => ({
    r: MAX_R * f,
    label: validCount > 0 ? (maxFreq * f / validCount * 100).toFixed(0) + '%' : '',
  }));

  const toggleBtn = (active) => ({
    padding: '6px 12px', borderRadius: 8, border: 'none',
    background: active ? 'rgba(255,255,255,0.65)' : 'transparent',
    boxShadow: active ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
    color: active ? 'var(--text)' : 'var(--text-muted)', fontWeight: active ? 700 : 500,
    fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)', transition: 'all 0.2s',
  });

  return (
    <div style={{ width: '100%' }}>

      {/* Page header */}
      <div style={{ marginBottom: 24, animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) both' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.02em' }}>Wind Rose</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>Wind direction and speed distribution across 16 compass sectors.</p>
      </div>

      {isDemo && (
        <div style={{ ...glassInner({ padding: '8px 16px', borderRadius: 10, marginBottom: 16, background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.25)' }), display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={14} color="#CA8A04" />
          <span style={{ fontSize: 12, color: '#CA8A04', fontWeight: 600 }}>Demo Mode — showing synthetic wind data</span>
        </div>
      )}

      {/* Controls */}
      <div style={{ ...glass({ padding: '14px 20px', marginBottom: 16 }), display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.05s both' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Station</span>
          <select
            value={selIdx}
            onChange={e => setSelIdx(Number(e.target.value))}
            style={{ padding: '7px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.35)', fontSize: 12, color: 'var(--text)', fontFamily: 'var(--font)', outline: 'none' }}
          >
            {stations.map((s, i) => <option key={s.id} value={i}>{s.name}</option>)}
          </select>
        </div>

        <div style={{ width: 1, height: 36, background: 'rgba(0,0,0,0.08)', flexShrink: 0 }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Time Range</span>
          <div style={{ ...glassInner({ padding: '3px 4px', borderRadius: 11 }), display: 'flex', gap: 2 }}>
            {TIME_RANGES.map(t => (
              <button key={t.id} onClick={() => setTimeRange(t.id)} style={toggleBtn(timeRange === t.id)}>{t.label}</button>
            ))}
          </div>
        </div>

        {loading && <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #A8A29E', borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Loading…</span>}
      </div>

      {/* Main content: rose + stats */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 280px', gap: 16, marginBottom: 16 }}>

        {/* Wind Rose SVG */}
        <div style={{ ...glass({ padding: isMobile ? '16px' : '24px', borderRadius: 18 }), animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.1s both', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ width: '100%', maxWidth: isMobile ? '100%' : 480, minHeight: isMobile ? 350 : undefined, position: 'relative' }}>
            <svg viewBox={`0 0 ${VB} ${VB}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
              {/* Reference rings */}
              {rings.map((ring, i) => (
                <g key={i}>
                  <circle cx={CX} cy={CY} r={ring.r} fill="none"
                    stroke="rgba(0,0,0,0.08)" strokeWidth={0.8}
                    strokeDasharray={i < 3 ? '4 4' : undefined} />
                  {ring.label && (
                    <text x={CX + 3} y={CY - ring.r + 9} fontSize={9}
                      fill="var(--text-faint)" fontFamily="'DM Mono',monospace">{ring.label}</text>
                  )}
                </g>
              ))}

              {/* Spokes */}
              {Array.from({ length: N_SECTORS }, (_, i) => {
                const [x2, y2] = polarPt(CX, CY, MAX_R, i * (360 / N_SECTORS));
                return <line key={i} x1={CX} y1={CY} x2={x2} y2={y2} stroke="rgba(0,0,0,0.06)" strokeWidth={0.7} />;
              })}

              {/* Petals */}
              {petals.map((p, i) => (
                <path key={i}
                  d={petalPath(CX, CY, p.r1, p.r2, p.start, p.end)}
                  fill={WIND_SPEED_BINS[p.bi].color}
                  fillOpacity={hovered === p.si ? 1 : 0.82}
                  stroke="rgba(255,255,255,0.55)" strokeWidth={0.7}
                  style={{ cursor: 'pointer', transition: 'fill-opacity 0.12s' }}
                  onMouseEnter={() => setHovered(p.si)}
                  onMouseLeave={() => setHovered(null)}
                />
              ))}

              {/* Empty state */}
              {validCount === 0 && (
                <text x={CX} y={CY + 4} textAnchor="middle" dominantBaseline="middle"
                  fontSize={13} fill="var(--text-faint)" fontFamily="'Instrument Sans',sans-serif">
                  No wind data
                </text>
              )}

              {/* Center circle */}
              <circle cx={CX} cy={CY} r={28} fill="var(--glass-inner-bg)" stroke="var(--glass-inner-border)" strokeWidth={1.5} />
              <text x={CX} y={CY - 6} textAnchor="middle" fontSize={14} fontWeight="700" fill="var(--text)" fontFamily="'DM Mono',monospace">{calmPct}%</text>
              <text x={CX} y={CY + 8} textAnchor="middle" fontSize={8} fill="var(--text-muted)" fontFamily="'Instrument Sans',sans-serif" fontWeight="700" letterSpacing="0.08em">CALM</text>

              {/* Direction labels */}
              {WIND_DIRS.map((dir, i) => {
                const [x, y] = polarPt(CX, CY, LABEL_R, i * (360 / N_SECTORS));
                const primary = i % 4 === 0;
                const inter   = i % 2 === 0;
                return (
                  <text key={dir} x={x} y={y}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={primary ? (isMobile ? 15 : 13) : inter ? (isMobile ? 12 : 10.5) : (isMobile ? 10 : 9)}
                    fontWeight={primary ? 700 : inter ? 600 : 400}
                    fill={hovered === i ? '#16A34A' : primary ? 'var(--text)' : 'var(--text-muted)'}
                    fontFamily="'Instrument Sans',sans-serif"
                  >{dir}</text>
                );
              })}
            </svg>

            {/* Sector hover tooltip */}
            {hovered !== null && sectorTotals[hovered] > 0 && (
              <div style={{ position: 'absolute', top: 8, left: 8, ...glassInner({ padding: '10px 14px' }), pointerEvents: 'none', minWidth: 175 }}>
                <p style={{ fontSize: 14, fontWeight: 700, margin: '0 0 8px', color: 'var(--text)' }}>{WIND_DIRS[hovered]}</p>
                {WIND_SPEED_BINS.slice(1).map((bin, i) => {
                  const count = sectors[hovered][i + 1];
                  if (!count) return null;
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: bin.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 10, color: 'var(--text-mid)', flex: 1 }}>{bin.label}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--text)' }}>
                        {count} <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>({validCount > 0 ? (count / validCount * 100).toFixed(0) : 0}%)</span>
                      </span>
                    </div>
                  );
                })}
                <div style={{ borderTop: '1px solid rgba(0,0,0,0.07)', marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Sector total</span>
                  <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'DM Mono, monospace' }}>
                    {sectorTotals[hovered]} ({validCount > 0 ? (sectorTotals[hovered] / validCount * 100).toFixed(0) : 0}%)
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right panel: stats + legend */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Wind statistics */}
          <div style={{ ...glass({ padding: '20px', borderRadius: 16 }), animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.15s both' }}>
            <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 14px' }}>Wind Statistics</h3>
            {[
              { icon: Navigation, label: 'Predominant Dir.', value: domIdx >= 0 && sectorTotals[domIdx] > 0 ? WIND_DIRS[domIdx] : '—', color: '#16A34A' },
              { icon: Gauge,      label: 'Average Speed',    value: fmtN(avgSpeed) + ' m/s', color: '#3B82F6' },
              { icon: Activity,   label: 'Max Speed',        value: fmtN(maxSpeed) + ' m/s', color: '#EA580C' },
              { icon: Wind,       label: 'Calm ≤0.5 m/s',   value: `${calmCount} (${calmPct}%)`, color: '#8B5CF6' },
              { icon: Wind,       label: 'Total Readings',   value: validCount, color: 'var(--text-muted)' },
            ].map((s, i) => {
              const Icon = s.icon;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: i < 4 ? 12 : 0, ...glassInner({ padding: '9px 12px', borderRadius: 10 }), background: `${s.color}08` }}>
                  <Icon size={13} color={s.color} style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'var(--text-mid)', flex: 1 }}>{s.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--text)' }}>{s.value}</span>
                </div>
              );
            })}
          </div>

          {/* Speed legend */}
          <div style={{ ...glass({ padding: '18px 20px', borderRadius: 16 }), animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.2s both' }}>
            <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 12px' }}>Speed Bins</h3>
            {WIND_SPEED_BINS.map((bin, i) => {
              const sectorFreq = sectors.reduce((sum, s) => sum + s[i], 0);
              const pct = validCount > 0 ? (sectorFreq / validCount * 100).toFixed(0) : 0;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: i < WIND_SPEED_BINS.length - 1 ? 9 : 0 }}>
                  <div style={{ width: 30, height: 11, borderRadius: 3, background: bin.color, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-mid)', fontWeight: 600 }}>{bin.label}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 5 }}>{bin.range}</span>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--text-muted)' }}>
                    {i === 0 ? `${calmCount}` : sectorFreq} <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>({pct}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
