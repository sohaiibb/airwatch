import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, CircleMarker, Tooltip as LTooltip, useMap } from 'react-leaflet';
import {
  Wind, Droplets, Thermometer, Eye, Activity, CheckCircle, TrendingUp, TrendingDown,
  AlertTriangle, Leaf, Sun, Cloud, Shield, Heart, Gauge, Navigation, BarChart3,
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { getStations, getLatestReadings, getDemoStations, getDemoReadings, getDemoHistory } from '../lib/supabase';
import { glass, glassInner, getAqiLevel, POLLUTANTS, formatTime } from '../lib/utils';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function beaufortLabel(speed) {
  if (speed == null) return '';
  if (speed < 0.5)  return 'Calm';
  if (speed < 1.5)  return 'Light Air';
  if (speed < 3.3)  return 'Light Breeze';
  if (speed < 5.5)  return 'Gentle Breeze';
  if (speed < 8.0)  return 'Moderate Breeze';
  if (speed < 10.7) return 'Fresh Breeze';
  if (speed < 13.8) return 'Strong Breeze';
  return 'High Wind';
}

function beaufortBars(speed) {
  if (speed == null || speed < 0.3) return 0;
  if (speed < 1.6) return 1;
  if (speed < 3.4) return 2;
  if (speed < 5.5) return 3;
  if (speed < 8.0) return 4;
  return 5;
}

function windDirLabel(deg) {
  if (deg == null) return '';
  const dirs = ['N','NE','E','SE','S','SW','W','NW','N'];
  return dirs[Math.round((deg % 360) / 45)];
}

function pressureStatus(hpa) {
  if (hpa == null) return '—';
  if (hpa < 1000) return 'Low';
  if (hpa > 1025) return 'High';
  return 'Normal';
}

function fmtVal(v, d = 1) {
  return v != null ? Number(v).toFixed(d) : '—';
}

// ─── Glass tooltip ──────────────────────────────────────────────────────────────
const GlassTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ ...glass({ borderRadius: 10, padding: '8px 12px' }), boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
      <p style={{ color: 'var(--text-muted)', fontSize: 10, margin: 0, marginBottom: 4, fontFamily: 'var(--mono)' }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, fontSize: 12, margin: '1px 0', fontWeight: 600 }}>
          {p.name}: <span style={{ fontFamily: 'var(--mono)' }}>{p.value}</span>
        </p>
      ))}
    </div>
  );
};

// ─── Pollutant Card (with sparkline + NCEC bar) ─────────────────────────────────
function PollutantCard({ pollutant, value, spark, delay = 0 }) {
  const { key, name, unit, color, threshold } = pollutant;
  const over = value != null && value > threshold;
  const fillColor = over ? '#DC2626' : color;
  const pct = value != null ? Math.min((value / threshold) * 100, 120) : 0;
  const barColor = pct >= 100 ? '#DC2626' : pct >= 80 ? '#F59E0B' : '#16A34A';

  return (
    <div style={{
      ...glass({ padding: '20px 18px' }),
      animation: `glassIn 0.6s cubic-bezier(.16,1,.3,1) ${delay}s both`,
      transition: 'transform 0.3s, box-shadow 0.3s', cursor: 'default',
      display: 'flex', flexDirection: 'column',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 40px rgba(0,0,0,0.1)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: fillColor, flexShrink: 0 }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{name}</span>
        </div>
        {over && <AlertTriangle size={11} color="#DC2626" />}
      </div>

      {/* Value */}
      <div style={{ marginBottom: 10 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700, color: over ? '#DC2626' : 'var(--text)', letterSpacing: '-0.02em' }}>
          {fmtVal(value)}
        </span>
        <span style={{ fontSize: 9, color: 'var(--text-faint)', marginLeft: 3 }}>{unit}</span>
      </div>

      {/* Sparkline */}
      <div style={{ margin: '0 -18px', overflow: 'hidden', flex: 1 }}>
        <ResponsiveContainer width="100%" height={56}>
          <AreaChart data={spark} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`spark-${key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={fillColor} stopOpacity={0.22} />
                <stop offset="100%" stopColor={fillColor} stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey={key} stroke={fillColor} fill={`url(#spark-${key})`}
              strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* NCEC progress bar */}
      <div style={{ height: 3, borderRadius: 2, background: 'rgba(0,0,0,0.06)', overflow: 'hidden', marginTop: 4, marginBottom: 2 }}>
        <div style={{
          height: '100%', borderRadius: 2,
          width: `${Math.min(pct, 100)}%`,
          background: barColor,
          transition: 'width 1s cubic-bezier(.16,1,.3,1)',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 8, color: 'var(--text-faint)' }}>0</span>
        <span style={{ fontSize: 8, color: barColor, fontWeight: 600 }}>{pct.toFixed(0)}%</span>
        <span style={{ fontSize: 8, color: 'var(--text-faint)' }}>NCEC {threshold}</span>
      </div>
    </div>
  );
}

// ─── Shared met card hover handlers ────────────────────────────────────────────
const metHover = {
  onMouseEnter: e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 40px rgba(0,0,0,0.1)'; },
  onMouseLeave: e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; },
};
const MET_H = 128; // fixed card height — all 5 met cards the same

// ─── Wind Compass Card ──────────────────────────────────────────────────────────
function WindCompassCard({ direction, speed, delay = 0 }) {
  const dir = direction ?? 0;
  // viewBox 0 0 90 90: cx=45,cy=45, r=30 → circle diameter 60 of 90 → at 72px renders ~48px diameter
  // labelR=41 → labels fit at max 86px of 90
  const cx = 45, cy = 45, r = 30, innerR = 19;
  const cardinals = [
    { label: 'N', angle: 0 },
    { label: 'E', angle: 90 },
    { label: 'S', angle: 180 },
    { label: 'W', angle: 270 },
  ];
  const ticks = [0, 45, 90, 135, 180, 225, 270, 315];
  const labelR = r + 11;

  return (
    <div style={{
      ...glass({ padding: '14px 16px' }),
      animation: `glassIn 0.6s cubic-bezier(.16,1,.3,1) ${delay}s both`,
      transition: 'transform 0.3s, box-shadow 0.3s', cursor: 'default',
      height: MET_H, boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
    }} {...metHover}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', alignSelf: 'flex-start' }}>Wind Dir</span>

      {/* SVG Compass — 72×72 rendered, viewBox 90×90 gives 12px padding around ring for labels */}
      <svg width={72} height={72} viewBox="0 0 90 90">
        {/* Outer ring */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--glass-inner-border)" strokeWidth="1.5" />
        <circle cx={cx} cy={cy} r={innerR - 2} fill="var(--glass-inner-bg)" />

        {/* 8 tick marks */}
        {ticks.map(deg => {
          const rad = (deg - 90) * (Math.PI / 180);
          const x1 = cx + (innerR - 1) * Math.cos(rad);
          const y1 = cy + (innerR - 1) * Math.sin(rad);
          const isCardinal = deg % 90 === 0;
          const x2 = cx + (r - (isCardinal ? 3 : 5)) * Math.cos(rad);
          const y2 = cy + (r - (isCardinal ? 3 : 5)) * Math.sin(rad);
          return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={isCardinal ? 'var(--text-faint)' : 'var(--glass-inner-border)'}
            strokeWidth={isCardinal ? 1.5 : 1} />;
        })}

        {/* N/S/E/W labels — N and S bold, all outside ring */}
        {cardinals.map(({ label, angle }) => {
          const rad = (angle - 90) * (Math.PI / 180);
          const lx = cx + labelR * Math.cos(rad);
          const ly = cy + labelR * Math.sin(rad);
          const isNS = label === 'N' || label === 'S';
          return <text key={label} x={lx} y={ly + 4} textAnchor="middle"
            fontSize={isNS ? '11' : '9'}
            fontWeight={isNS ? '800' : '600'}
            fill={isNS ? 'var(--text-mid)' : 'var(--text-faint)'}
            fontFamily="var(--font)">{label}</text>;
        })}

        {/* Arrow shows FLOW direction (where wind is GOING = direction + 180°) */}
        <g style={{
          transformOrigin: `${cx}px ${cy}px`,
          transform: `rotate(${dir + 180}deg)`,
          transition: 'transform 0.7s cubic-bezier(.34,1.56,.64,1)',
        }}>
          {/* Arrowhead */}
          <polygon points={`${cx},${cy - innerR + 1} ${cx - 5.5},${cy - innerR + 11} ${cx + 5.5},${cy - innerR + 11}`} fill="#0d9488" />
          {/* Shaft */}
          <line x1={cx} y1={cy - innerR + 11} x2={cx} y2={cy + 8}
            stroke="#0d9488" strokeWidth="3" strokeLinecap="round" />
          {/* Center pin */}
          <circle cx={cx} cy={cy} r="3.5" fill="#0d9488" />
        </g>
      </svg>

      {/* Direction value + "Wind from X" */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
          {direction != null ? `${Math.round(direction)}° ${windDirLabel(direction)}` : '—'}
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 1 }}>
          {direction != null ? `Wind from ${windDirLabel(direction)}` : ''}
        </div>
      </div>
    </div>
  );
}

// ─── Temperature Card ───────────────────────────────────────────────────────────
function ThermometerCard({ value, low, high, delay = 0 }) {
  const temp = value ?? 0;
  // Track 40px tall, fill scales 0–50°C
  const fillH = Math.round(Math.max(0, Math.min(1, temp / 50)) * 40);
  const bulbColor = temp > 40 ? '#ef4444' : temp > 25 ? '#f97316' : '#3b82f6';

  return (
    <div style={{
      ...glass({ padding: '14px 16px' }),
      animation: `glassIn 0.6s cubic-bezier(.16,1,.3,1) ${delay}s both`,
      transition: 'transform 0.3s, box-shadow 0.3s', cursor: 'default',
      height: MET_H, boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
    }} {...metHover}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Thermometer in 40px container */}
        <div style={{ width: 40, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
          <svg width={14} height={64} viewBox="0 0 14 64">
            <defs>
              <linearGradient id="thermo-grad" x1="0" y1="1" x2="0" y2="0" gradientUnits="objectBoundingBox">
                <stop offset="0%"   stopColor="#3b82f6" />
                <stop offset="50%"  stopColor="#f97316" />
                <stop offset="100%" stopColor="#ef4444" />
              </linearGradient>
            </defs>
            {/* Track */}
            <rect x="5" y="2" width="4" height="42" rx="2" fill="#e5e7eb" />
            {/* Fill from bottom */}
            {fillH > 0 && <rect x="5" y={44 - fillH} width="4" height={fillH} rx="2" fill="url(#thermo-grad)" />}
            {/* Bulb */}
            <circle cx="7" cy="57" r="7" fill={bulbColor} />
            <circle cx="7" cy="57" r="4.5" fill="rgba(255,255,255,0.28)" />
          </svg>
        </div>

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Temperature</span>
          <div style={{ marginTop: 4 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>{fmtVal(value)}</span>
            <span style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 3 }}>°C</span>
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 4, fontFamily: 'var(--mono)' }}>
            {low != null && high != null ? `Low ${low} · High ${high}` : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Humidity Card ─────────────────────────────────────────────────────────────
function HumidityCard({ value, low, high, delay = 0 }) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  // Teardrop path in 24×30 viewBox (0,0 to 24,30)
  const dropPath = 'M 12,28 C 18,28 22,22 22,16 C 22,9 12,1 12,1 C 12,1 2,9 2,16 C 2,22 6,28 12,28 Z';
  // fillY: at pct=0 → rect starts at 28 (empty); at pct=100 → rect starts at 1 (full)
  const fillY = 28 - (pct / 100) * 27;

  return (
    <div style={{
      ...glass({ padding: '14px 16px' }),
      animation: `glassIn 0.6s cubic-bezier(.16,1,.3,1) ${delay}s both`,
      transition: 'transform 0.3s, box-shadow 0.3s', cursor: 'default',
      height: MET_H, boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
    }} {...metHover}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Droplet in 40px container */}
        <div style={{ width: 40, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
          <svg width={24} height={30} viewBox="0 0 24 30">
            <defs>
              <clipPath id="drop-clip">
                <path d={dropPath} />
              </clipPath>
            </defs>
            {/* Gray background */}
            <path d={dropPath} fill="#e5e7eb" />
            {/* Blue fill from bottom */}
            <rect x="0" y={fillY} width="24" height={30 - fillY}
              fill="#0ea5e9" clipPath="url(#drop-clip)"
              style={{ transition: 'y 1s cubic-bezier(.16,1,.3,1), height 1s cubic-bezier(.16,1,.3,1)' }} />
            {/* Outline */}
            <path d={dropPath} fill="none" stroke="rgba(0,0,0,0.10)" strokeWidth="0.8" />
          </svg>
        </div>

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Humidity</span>
          <div style={{ marginTop: 4 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>{fmtVal(value, 0)}</span>
            <span style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 3 }}>%</span>
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 4, fontFamily: 'var(--mono)' }}>
            {low != null && high != null ? `Low ${low} · High ${high}` : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Pressure Card (barometer arc) ─────────────────────────────────────────────
function PressureCard({ value, low, high, delay = 0 }) {
  // Semicircle 980–1040 hPa. Small viewBox keeps it proportionate in the fixed-height card.
  const cx = 60, cy = 50, r = 38;
  const gaugeMin = 980, gaugeMax = 1040;
  const fraction = value != null ? Math.max(0, Math.min(1, (value - gaugeMin) / (gaugeMax - gaugeMin))) : 0.5;
  const needleAngleDeg = (fraction - 0.5) * 180;

  const arcAngle = (val) => Math.PI - ((val - gaugeMin) / (gaugeMax - gaugeMin)) * Math.PI;
  const arcPt = (val) => {
    const a = arcAngle(val);
    return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
  };
  const p980 = arcPt(980), p1000 = arcPt(1000), p1020 = arcPt(1020), p1040 = arcPt(1040);

  // Labels outside arc at labelR
  const labelR = r + 10;
  const lblPt = (val) => {
    const a = arcAngle(val);
    return { x: cx + labelR * Math.cos(a), y: cy - labelR * Math.sin(a) };
  };
  const l980 = lblPt(980), l1000 = lblPt(1000), l1020 = lblPt(1020), l1040 = lblPt(1040);

  const status = pressureStatus(value);
  const statusColor = status === 'Low' ? '#3B82F6' : status === 'High' ? '#F59E0B' : '#16A34A';

  return (
    <div style={{
      ...glass({ padding: '14px 16px' }),
      animation: `glassIn 0.6s cubic-bezier(.16,1,.3,1) ${delay}s both`,
      transition: 'transform 0.3s, box-shadow 0.3s', cursor: 'default',
      height: MET_H, boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    }} {...metHover}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Pressure</span>

      {/* Arc gauge — fixed 120×66 SVG, viewBox proportioned to avoid clipping */}
      <svg width={120} height={66} viewBox="0 0 120 66" style={{ display: 'block', margin: '0 auto' }}>
        {/* Background track */}
        <path d={`M ${p980.x.toFixed(1)},${p980.y.toFixed(1)} A ${r},${r} 0 0 1 ${p1040.x.toFixed(1)},${p1040.y.toFixed(1)}`}
          fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth="5" strokeLinecap="round" />
        {/* Blue zone 980–1000 */}
        <path d={`M ${p980.x.toFixed(1)},${p980.y.toFixed(1)} A ${r},${r} 0 0 1 ${p1000.x.toFixed(1)},${p1000.y.toFixed(1)}`}
          fill="none" stroke="#3b82f6" strokeWidth="5" strokeLinecap="round" opacity="0.7" />
        {/* Green zone 1000–1020 */}
        <path d={`M ${p1000.x.toFixed(1)},${p1000.y.toFixed(1)} A ${r},${r} 0 0 1 ${p1020.x.toFixed(1)},${p1020.y.toFixed(1)}`}
          fill="none" stroke="#10b981" strokeWidth="5" strokeLinecap="round" opacity="0.7" />
        {/* Orange zone 1020–1040 */}
        <path d={`M ${p1020.x.toFixed(1)},${p1020.y.toFixed(1)} A ${r},${r} 0 0 1 ${p1040.x.toFixed(1)},${p1040.y.toFixed(1)}`}
          fill="none" stroke="#f59e0b" strokeWidth="5" strokeLinecap="round" opacity="0.7" />
        {/* Zone divider ticks */}
        {[1000, 1020].map(v => {
          const a = arcAngle(v);
          const ox = cx + r * Math.cos(a), oy = cy - r * Math.sin(a);
          const ix = cx + (r - 7) * Math.cos(a), iy = cy - (r - 7) * Math.sin(a);
          return <line key={v} x1={ox.toFixed(1)} y1={oy.toFixed(1)} x2={ix.toFixed(1)} y2={iy.toFixed(1)}
            stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" />;
        })}
        {/* Needle */}
        <g style={{
          transformOrigin: `${cx}px ${cy}px`,
          transform: `rotate(${needleAngleDeg}deg)`,
          transition: 'transform 0.8s cubic-bezier(.34,1.56,.64,1)',
        }}>
          <line x1={cx} y1={cy} x2={cx} y2={cy - r + 7}
            stroke="var(--text-mid)" strokeWidth="1.8" strokeLinecap="round" opacity="0.8" />
          <polygon points={`${cx},${cy - r + 3} ${cx - 3},${cy - r + 10} ${cx + 3},${cy - r + 10}`}
            fill="var(--text-mid)" opacity="0.8" />
        </g>
        <circle cx={cx} cy={cy} r="4.5" fill="var(--text-mid)" opacity="0.5" />
        <circle cx={cx} cy={cy} r="2" fill="var(--glass-inner-bg)" />
        {/* Scale labels */}
        <text x={l980.x.toFixed(1)} y={(l980.y + 3).toFixed(1)} fontSize="7" fill="var(--text-faint)" fontFamily="var(--font)" textAnchor="end">980</text>
        <text x={l1000.x.toFixed(1)} y={(l1000.y - 1).toFixed(1)} fontSize="7" fill="var(--text-faint)" fontFamily="var(--font)" textAnchor="middle">1000</text>
        <text x={l1020.x.toFixed(1)} y={(l1020.y - 1).toFixed(1)} fontSize="7" fill="var(--text-faint)" fontFamily="var(--font)" textAnchor="middle">1020</text>
        <text x={l1040.x.toFixed(1)} y={(l1040.y + 3).toFixed(1)} fontSize="7" fill="var(--text-faint)" fontFamily="var(--font)" textAnchor="start">1040</text>
      </svg>

      {/* Value + status + range */}
      <div style={{ textAlign: 'center' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{fmtVal(value, 1)}</span>
        <span style={{ fontSize: 9, color: 'var(--text-faint)', marginLeft: 2 }}>hPa</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: statusColor, marginLeft: 6 }}>{status}</span>
      </div>
      <div style={{ textAlign: 'center' }}>
        <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>
          {low != null && high != null ? `Low ${low} · High ${high}` : ''}
        </span>
      </div>
    </div>
  );
}

// ─── Wind Speed Card ────────────────────────────────────────────────────────────
function WindSpeedCard({ value, low, high, delay = 0 }) {
  const filled = beaufortBars(value);
  const barHeights = [8, 14, 20, 26, 32];

  return (
    <div style={{
      ...glass({ padding: '14px 16px' }),
      animation: `glassIn 0.6s cubic-bezier(.16,1,.3,1) ${delay}s both`,
      transition: 'transform 0.3s, box-shadow 0.3s', cursor: 'default',
      height: MET_H, boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
    }} {...metHover}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Wind strength bars in 40px container */}
        <div style={{ width: 40, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3 }}>
            {barHeights.map((h, i) => (
              <div key={i} style={{
                width: 4, height: h, borderRadius: 2,
                background: i < filled ? '#0d9488' : '#e5e7eb',
                transition: 'background 0.5s ease',
              }} />
            ))}
          </div>
        </div>

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Wind Speed</span>
          <div style={{ marginTop: 4 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>{fmtVal(value)}</span>
            <span style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 3 }}>m/s</span>
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 4, fontFamily: 'var(--mono)' }}>
            {value != null ? beaufortLabel(value) : '—'}
            {low != null && high != null ? ` · ${low}–${high}` : ''}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Stat Card (kept for AQI sparkline row) ─────────────────────────────────────
function StatCard({ icon: Icon, label, value, unit, trend, trendVal, accent, delay = 0 }) {
  return (
    <div style={{
      ...glass({ padding: '16px 18px' }),
      animation: `glassIn 0.6s cubic-bezier(.16,1,.3,1) ${delay}s both`,
      transition: 'transform 0.3s, box-shadow 0.3s', cursor: 'default',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 40px rgba(0,0,0,0.1)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: `${accent}18`, border: `1px solid ${accent}25`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={15} color={accent} />
        </div>
        {trend && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono)', color: trend === 'up' ? '#DC2626' : '#16A34A' }}>
            {trend === 'up' ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{trendVal}
          </span>
        )}
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 600, margin: 0, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</p>
      <p style={{ color: 'var(--text)', fontSize: 24, fontWeight: 700, margin: '2px 0 0', fontFamily: 'var(--mono)', letterSpacing: '-0.03em' }}>
        {value ?? '—'}<span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 3, fontWeight: 500 }}>{unit}</span>
      </p>
    </div>
  );
}

// ─── Pollutant Bar ───────────────────────────────────────────────────────────────
function PollutantBar({ name, value, max, unit, color, threshold }) {
  const pct = Math.min(((value || 0) / max) * 100, 100);
  const over = (value || 0) > threshold;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ color: 'var(--text-mid)', fontSize: 12, fontWeight: 600 }}>{name}</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, color: over ? '#DC2626' : '#16A34A' }}>
          {value ?? '—'} <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>{unit}</span>
        </span>
      </div>
      <div style={{ background: 'rgba(255,255,255,0.45)', borderRadius: 6, height: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.5)' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 6, background: over ? `linear-gradient(90deg, ${color}, #EF4444)` : `linear-gradient(90deg, ${color}CC, ${color})`, transition: 'width 1s cubic-bezier(.16,1,.3,1)', boxShadow: `0 0 10px ${color}30` }} />
      </div>
    </div>
  );
}

// ─── Map fit helper ──────────────────────────────────────────────────────────────
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

// ═══ Dashboard Page ══════════════════════════════════════════════════════════════
export default function Dashboard({ profile }) {
  const [stations, setStations] = useState([]);
  const [readings, setReadings] = useState({});
  const [selIdx, setSelIdx] = useState(0);
  const [sparkData, setSparkData] = useState({});
  const [isDemo, setIsDemo] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    async function load() {
      try {
        const st = await getStations();
        if (st.length > 0) {
          setStations(st);
          const r = await getLatestReadings(st.map(s => s.id));
          setReadings(r);
          setIsDemo(false);
        } else throw new Error('No stations');
      } catch {
        setStations(getDemoStations());
        setReadings(getDemoReadings());
        setIsDemo(true);
      }
    }
    load();
  }, []);

  // Load full history for selected station (all fields for sparklines + ranges)
  useEffect(() => {
    if (!stations.length) return;
    const sid = stations[selIdx]?.id;
    if (!sid || sparkData[sid]) return;
    const hist = getDemoHistory(sid, 24); // 24h history, all fields
    setSparkData(prev => ({ ...prev, [sid]: hist }));
  }, [selIdx, stations]);

  const station  = stations[selIdx] || {};
  const r        = readings[station.id] || {};
  const aqi      = r.aqi ?? 0;
  const lvl      = getAqiLevel(aqi);
  const hist     = sparkData[station.id] || [];
  const spark20  = hist.slice(-20); // last 20 for pollutant sparklines
  const sparkAqi = hist.map(d => ({ time: formatTime(d.timestamp), aqi: d.aqi, pm25: d.pm25 }));

  // Compute Low/High ranges from history
  const weatherRanges = useMemo(() => {
    const compute = (key, decimals = 1) => {
      const vals = hist.map(d => d[key]).filter(v => v != null);
      if (!vals.length) return { low: null, high: null };
      return {
        low: Math.min(...vals).toFixed(decimals),
        high: Math.max(...vals).toFixed(decimals),
      };
    };
    return {
      temperature: compute('temperature', 1),
      humidity: compute('humidity', 0),
      wind_speed: compute('wind_speed', 1),
      pressure: compute('pressure', 1),
    };
  }, [hist]);

  const healthAdvice = aqi <= 50 ? [
    { icon: Sun,    title: 'Outdoor Activity',  desc: 'Safe for all groups.',               color: '#16A34A' },
    { icon: Heart,  title: 'Sensitive Groups',  desc: 'No precautions needed.',             color: '#3B82F6' },
    { icon: Shield, title: 'Dust Advisory',     desc: 'Low dust levels.',                   color: '#F59E0B' },
    { icon: Cloud,  title: 'Forecast',          desc: 'Quality expected to remain good.',   color: '#8B5CF6' },
  ] : aqi <= 100 ? [
    { icon: Sun,    title: 'Outdoor Activity',  desc: 'Acceptable for most.',               color: '#CA8A04' },
    { icon: Heart,  title: 'Sensitive Groups',  desc: 'Consider reducing exertion.',        color: '#3B82F6' },
    { icon: Shield, title: 'Dust Advisory',     desc: 'Moderate levels.',                   color: '#F59E0B' },
    { icon: Cloud,  title: 'Forecast',          desc: 'Monitor conditions.',                color: '#8B5CF6' },
  ] : [
    { icon: Sun,    title: 'Outdoor Activity',  desc: 'Limit outdoor exertion.',            color: '#DC2626' },
    { icon: Heart,  title: 'Sensitive Groups',  desc: 'Stay indoors.',                      color: '#DC2626' },
    { icon: Shield, title: 'Dust Advisory',     desc: 'Wear N95 mask outdoors.',            color: '#EA580C' },
    { icon: Cloud,  title: 'Forecast',          desc: 'Poor conditions may persist.',       color: '#8B5CF6' },
  ];

  return (
    <div style={{ width: '100%' }}>
      {isDemo && (
        <div style={{ ...glassInner({ padding: '8px 16px', borderRadius: 10, marginBottom: 16, background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.25)' }), display: 'flex', alignItems: 'center', gap: 8, animation: 'glassIn 0.4s ease both' }}>
          <AlertTriangle size={14} color="#CA8A04" />
          <span style={{ fontSize: 12, color: '#CA8A04', fontWeight: 600 }}>Demo Mode — Connect Supabase to see live station data</span>
        </div>
      )}

      {/* Row 1: Map + AQI Gauge */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16, marginBottom: 16 }}>
        {/* Map */}
        <div style={{ ...glass({ padding: 0, overflow: 'hidden' }), animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.05s both', height: 300 }}>
          <MapContainer center={[26.4, 50.0]} zoom={8} style={{ height: '100%', width: '100%' }} zoomControl={true} attributionControl={false}>
            <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
            <FitBounds stations={stations} />
            {stations.map((s, i) => {
              const sr = readings[s.id] || {};
              const sl = getAqiLevel(sr.aqi || 0);
              return (
                <CircleMarker key={s.id} center={[s.latitude, s.longitude]}
                  radius={selIdx === i ? 12 : 8}
                  pathOptions={{ fillColor: sl.color, fillOpacity: 0.8, color: selIdx === i ? '#fff' : sl.color, weight: selIdx === i ? 3 : 1.5 }}
                  eventHandlers={{ click: () => setSelIdx(i) }}
                >
                  <LTooltip direction="top" offset={[0, -10]}>
                    <div style={{ fontFamily: 'var(--font)', padding: '2px 0' }}>
                      <strong>{s.name}</strong><br />
                      <span style={{ fontFamily: 'var(--mono)', color: sl.color }}>AQI: {sr.aqi ?? '—'}</span>
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
          <p style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 14px', zIndex: 1 }}>Air Quality Index</p>
          <div style={{ width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.35)', border: `3px solid ${lvl.color}60`, backdropFilter: 'blur(16px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 1, animation: 'gaugeGlow 3s ease-in-out infinite', boxShadow: `0 0 40px ${lvl.color}15` }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 42, fontWeight: 500, color: lvl.color, lineHeight: 1 }}>{aqi || '—'}</span>
            <span style={{ color: 'var(--text-faint)', fontSize: 10, fontWeight: 500, marginTop: 2 }}>US AQI</span>
          </div>
          <div style={{ marginTop: 12, padding: '4px 14px', borderRadius: 16, background: lvl.soft, border: `1px solid ${lvl.color}25`, display: 'flex', alignItems: 'center', gap: 4, zIndex: 1 }}>
            <CheckCircle size={12} color={lvl.color} />
            <span style={{ color: lvl.color, fontSize: 11, fontWeight: 700 }}>{lvl.label}</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 600, marginTop: 8, zIndex: 1, textAlign: 'center' }}>{station.name || '—'}</p>
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
              display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, transition: 'all 0.2s',
            }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: sl.color, boxShadow: `0 0 6px ${sl.color}50` }} />
              <span style={{ fontSize: 12, fontWeight: selIdx === i ? 700 : 500, color: selIdx === i ? 'var(--text)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>{s.name}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: sl.color }}>{sr.aqi || '—'}</span>
            </button>
          );
        })}
      </div>

      {/* Row 3: Pollutant cards (6) with sparklines */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 16 }}>
        {POLLUTANTS.map((p, i) => (
          <PollutantCard key={p.key} pollutant={p} value={r[p.key]} spark={spark20} delay={0.2 + i * 0.04} />
        ))}
      </div>

      {/* Row 4: Weather cards (5) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16 }}>
        <ThermometerCard
          value={r.temperature}
          low={weatherRanges.temperature.low}
          high={weatherRanges.temperature.high}
          delay={0.4}
        />
        <HumidityCard
          value={r.humidity}
          low={weatherRanges.humidity.low}
          high={weatherRanges.humidity.high}
          delay={0.44}
        />
        <WindSpeedCard
          value={r.wind_speed}
          low={weatherRanges.wind_speed.low}
          high={weatherRanges.wind_speed.high}
          delay={0.48}
        />
        <WindCompassCard
          direction={r.wind_direction}
          speed={r.wind_speed}
          delay={0.52}
        />
        <PressureCard
          value={r.pressure}
          low={weatherRanges.pressure.low}
          high={weatherRanges.pressure.high}
          delay={0.56}
        />
      </div>

      {/* Row 5: AQI sparkline */}
      <div style={{ ...glass({ padding: '14px 16px', marginBottom: 16 }), animation: 'glassIn 0.6s cubic-bezier(.16,1,.3,1) 0.5s both' }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}>24H AQI TREND — {station.name || '—'}</p>
        <ResponsiveContainer width="100%" height={60}>
          <AreaChart data={sparkAqi} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="sparkG" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lvl.color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={lvl.color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis dataKey="time" hide />
            <YAxis hide />
            <Tooltip content={<GlassTooltip />} />
            <Area type="monotone" dataKey="aqi" stroke={lvl.color} fill="url(#sparkG)" strokeWidth={2} dot={false} name="AQI" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Row 6: Pollutant bars + Health Advisory */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Pollutant breakdown */}
        <div style={{ ...glass({ padding: '20px 22px' }), animation: 'glassIn 0.6s cubic-bezier(.16,1,.3,1) 0.55s both' }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 3px' }}>NCEC Threshold Status</h2>
          <p style={{ color: 'var(--text-faint)', fontSize: 11, margin: '0 0 16px' }}>Current levels vs. NCEC limits</p>
          {POLLUTANTS.map((p, i) => <PollutantBar key={i} name={p.name} value={r[p.key]} max={p.max} unit={p.unit} color={p.color} threshold={p.threshold} />)}
          <div style={{ ...glassInner({ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }) }}>
            <Leaf size={12} color="#16A34A" />
            <span style={{ color: 'var(--text-muted)', fontSize: 10, lineHeight: 1.4 }}>Thresholds: NCEC Executive Regulation (Royal Decree M/165)</span>
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
                <p style={{ color: 'var(--text)', fontSize: 12, fontWeight: 650, margin: 0 }}>{item.title}</p>
                <p style={{ color: 'var(--text-muted)', fontSize: 11, margin: '2px 0 0', lineHeight: 1.4 }}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
