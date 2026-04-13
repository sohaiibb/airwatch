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
      ...glass({ padding: '12px 14px' }),
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
      <div style={{ marginBottom: 4 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700, color: over ? '#DC2626' : 'var(--text)', letterSpacing: '-0.02em' }}>
          {fmtVal(value)}
        </span>
        <span style={{ fontSize: 9, color: 'var(--text-faint)', marginLeft: 3 }}>{unit}</span>
      </div>

      {/* Sparkline */}
      <div style={{ margin: '0 -14px', overflow: 'hidden', flex: 1 }}>
        <ResponsiveContainer width="100%" height={40}>
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

// ─── Wind Compass Card ──────────────────────────────────────────────────────────
function WindCompassCard({ direction, speed, delay = 0 }) {
  const dir = direction ?? 0;
  const cx = 35, cy = 35, r = 28, innerR = 20;
  const cardinals = [
    { label: 'N', angle: 270 },
    { label: 'E', angle: 0 },
    { label: 'S', angle: 90 },
    { label: 'W', angle: 180 },
  ];
  const ticks = [0, 45, 90, 135, 180, 225, 270, 315];

  return (
    <div style={{
      ...glass({ padding: '12px 14px' }),
      animation: `glassIn 0.6s cubic-bezier(.16,1,.3,1) ${delay}s both`,
      transition: 'transform 0.3s, box-shadow 0.3s', cursor: 'default',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 40px rgba(0,0,0,0.1)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Wind Dir</span>

      {/* SVG Compass */}
      <svg width={70} height={70} viewBox="0 0 70 70">
        {/* Outer ring */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--glass-inner-border)" strokeWidth="1.5" />
        <circle cx={cx} cy={cy} r={innerR - 2} fill="var(--glass-inner-bg)" />

        {/* 8 tick marks */}
        {ticks.map(deg => {
          const rad = (deg - 90) * (Math.PI / 180);
          const x1 = cx + (innerR + 1) * Math.cos(rad);
          const y1 = cy + (innerR + 1) * Math.sin(rad);
          const isCardinal = deg % 90 === 0;
          const x2 = cx + (r - (isCardinal ? 4 : 6)) * Math.cos(rad);
          const y2 = cy + (r - (isCardinal ? 4 : 6)) * Math.sin(rad);
          return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={isCardinal ? 'var(--text-faint)' : 'var(--glass-inner-border)'}
            strokeWidth={isCardinal ? 1.5 : 1} />;
        })}

        {/* Cardinal labels */}
        {cardinals.map(({ label, angle }) => {
          const rad = (angle - 90) * (Math.PI / 180);
          const lx = cx + (r + 7) * Math.cos(rad);
          const ly = cy + (r + 7) * Math.sin(rad);
          return <text key={label} x={lx} y={ly + 3.5} textAnchor="middle" fontSize="8"
            fill="var(--text-faint)" fontFamily="var(--font)" fontWeight="600">{label}</text>;
        })}

        {/* Needle (animated via CSS transform) */}
        <g style={{
          transformOrigin: `${cx}px ${cy}px`,
          transform: `rotate(${dir}deg)`,
          transition: 'transform 0.7s cubic-bezier(.34,1.56,.64,1)',
        }}>
          {/* Teal front half */}
          <polygon points={`${cx},${cy - innerR + 2} ${cx - 3},${cy} ${cx + 3},${cy}`} fill="#0d9488" opacity="0.95" />
          {/* Muted back half */}
          <polygon points={`${cx},${cy + innerR - 2} ${cx - 3},${cy} ${cx + 3},${cy}`} fill="rgba(0,0,0,0.18)" />
          {/* Center pin */}
          <circle cx={cx} cy={cy} r="2.5" fill="#0d9488" />
        </g>
      </svg>

      {/* Direction text */}
      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>
        {direction != null ? `${Math.round(direction)}° ${windDirLabel(direction)}` : '—'}
      </span>
      <span style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 1 }}>
        {speed != null ? `${fmtVal(speed)} m/s · ${beaufortLabel(speed)}` : '—'}
      </span>
    </div>
  );
}

// ─── Temperature Card (with thermometer bar) ───────────────────────────────────
function ThermometerCard({ value, low, high, delay = 0 }) {
  const temp = value ?? 0;
  const fillPct = Math.max(0, Math.min(1, temp / 50));
  const fillH = Math.round(fillPct * 32); // max 32px fill inside 36px track

  return (
    <div style={{
      ...glass({ padding: '12px 14px' }),
      animation: `glassIn 0.6s cubic-bezier(.16,1,.3,1) ${delay}s both`,
      transition: 'transform 0.3s, box-shadow 0.3s', cursor: 'default',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 40px rgba(0,0,0,0.1)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Thermometer SVG */}
        <svg width={14} height={48} viewBox="0 0 14 48" style={{ flexShrink: 0 }}>
          <defs>
            <linearGradient id="thermo-grad" x1="0" y1="1" x2="0" y2="0" gradientUnits="objectBoundingBox">
              <stop offset="0%" stopColor="#60A5FA" />
              <stop offset="60%" stopColor="#FBBF24" />
              <stop offset="100%" stopColor="#EF4444" />
            </linearGradient>
          </defs>
          {/* Track */}
          <rect x="5" y="2" width="4" height="36" rx="2" fill="rgba(0,0,0,0.07)" />
          {/* Fill (from bottom up) */}
          {fillH > 0 && (
            <rect x="5" y={38 - fillH} width="4" height={fillH} rx="2"
              fill="url(#thermo-grad)"
              style={{ transition: 'height 1s cubic-bezier(.16,1,.3,1), y 1s cubic-bezier(.16,1,.3,1)' }} />
          )}
          {/* Bulb */}
          <circle cx="7" cy="43" r="5" fill={value != null && value > 40 ? '#EF4444' : value != null && value > 30 ? '#FBBF24' : '#60A5FA'} />
          <circle cx="7" cy="43" r="3" fill="rgba(255,255,255,0.35)" />
        </svg>

        {/* Value + range */}
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Temperature</span>
          <div style={{ marginTop: 2 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{fmtVal(value)}</span>
            <span style={{ fontSize: 9, color: 'var(--text-faint)', marginLeft: 3 }}>°C</span>
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 3, fontFamily: 'var(--mono)' }}>
            {low != null && high != null ? `Low ${low} · High ${high}` : 'No range data'}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Humidity Card (with droplet fill) ─────────────────────────────────────────
function HumidityCard({ value, low, high, delay = 0 }) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  // Droplet SVG path (24×30 viewBox)
  const dropPath = 'M 12,28 C 18,28 22,22 22,16 C 22,9 12,1 12,1 C 12,1 2,9 2,16 C 2,22 6,28 12,28 Z';
  const fillY = 29 - (pct / 100) * 28; // from 1 (full) to 29 (empty)

  return (
    <div style={{
      ...glass({ padding: '12px 14px' }),
      animation: `glassIn 0.6s cubic-bezier(.16,1,.3,1) ${delay}s both`,
      transition: 'transform 0.3s, box-shadow 0.3s', cursor: 'default',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 40px rgba(0,0,0,0.1)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Droplet SVG */}
        <svg width={24} height={30} viewBox="0 0 24 30" style={{ flexShrink: 0 }}>
          <defs>
            <clipPath id="drop-clip">
              <path d={dropPath} />
            </clipPath>
          </defs>
          {/* Outline */}
          <path d={dropPath} fill="none" stroke="var(--text-faint)" strokeWidth="1.2" opacity="0.4" />
          {/* Fill from bottom */}
          <rect x="0" y={fillY} width="24" height={30 - fillY}
            fill="#0EA5E9" opacity="0.65" clipPath="url(#drop-clip)"
            style={{ transition: 'y 1s cubic-bezier(.16,1,.3,1), height 1s cubic-bezier(.16,1,.3,1)' }} />
        </svg>

        {/* Value + range */}
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Humidity</span>
          <div style={{ marginTop: 2 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{fmtVal(value, 0)}</span>
            <span style={{ fontSize: 9, color: 'var(--text-faint)', marginLeft: 3 }}>%</span>
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 3, fontFamily: 'var(--mono)' }}>
            {low != null && high != null ? `Low ${low} · High ${high}` : 'No range data'}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Pressure Card (with arc gauge) ────────────────────────────────────────────
function PressureCard({ value, low, high, delay = 0 }) {
  // Semicircle arc: 990–1040 hPa, left→top→right (clockwise through top)
  const cx = 50, cy = 44, r = 34;
  const gaugeMin = 990, gaugeMax = 1040;
  const fraction = value != null ? Math.max(0, Math.min(1, (value - gaugeMin) / (gaugeMax - gaugeMin))) : 0;
  // Marker angle: 180° (left) to 0° (right) going clockwise through top (270°)
  const angle = Math.PI - fraction * Math.PI; // π→0 as fraction goes 0→1
  const mx = cx + r * Math.cos(angle);
  const my = cy - r * Math.sin(angle); // minus = SVG y inverted
  const status = pressureStatus(value);
  const statusColor = status === 'Low' ? '#3B82F6' : status === 'High' ? '#F59E0B' : '#16A34A';

  return (
    <div style={{
      ...glass({ padding: '12px 14px' }),
      animation: `glassIn 0.6s cubic-bezier(.16,1,.3,1) ${delay}s both`,
      transition: 'transform 0.3s, box-shadow 0.3s', cursor: 'default',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 40px rgba(0,0,0,0.1)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Pressure</span>

      {/* Arc gauge */}
      <svg width={100} height={52} viewBox="0 0 100 52" style={{ display: 'block', margin: '4px auto 0' }}>
        <defs>
          <linearGradient id="pressure-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor="#3B82F6" />
            <stop offset="50%"  stopColor="#16A34A" />
            <stop offset="100%" stopColor="#F59E0B" />
          </linearGradient>
        </defs>
        {/* Track arc */}
        <path
          d={`M ${cx - r},${cy} A ${r},${r} 0 0 1 ${cx + r},${cy}`}
          fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth="5" strokeLinecap="round"
        />
        {/* Colored fill arc (from left to marker) */}
        {value != null && fraction > 0 && (
          <path
            d={`M ${cx - r},${cy} A ${r},${r} 0 0 1 ${mx.toFixed(2)},${my.toFixed(2)}`}
            fill="none" stroke="url(#pressure-grad)" strokeWidth="5" strokeLinecap="round"
          />
        )}
        {/* Marker dot */}
        {value != null && (
          <circle cx={mx} cy={my} r="4.5" fill={statusColor}
            style={{ filter: `drop-shadow(0 0 4px ${statusColor}60)` }} />
        )}
        {/* Min/max labels */}
        <text x={cx - r + 2} y={cy + 12} fontSize="7" fill="var(--text-faint)" fontFamily="var(--font)">990</text>
        <text x={cx + r - 10} y={cy + 12} fontSize="7" fill="var(--text-faint)" fontFamily="var(--font)">1040</text>
      </svg>

      {/* Value row */}
      <div style={{ textAlign: 'center', marginTop: 2 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>{fmtVal(value, 1)}</span>
        <span style={{ fontSize: 9, color: 'var(--text-faint)', marginLeft: 3 }}>hPa</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 }}>
        <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>
          {low != null && high != null ? `Low ${low} · High ${high}` : ''}
        </span>
        <span style={{ fontSize: 9, fontWeight: 700, color: statusColor }}>{status}</span>
      </div>
    </div>
  );
}

// ─── Wind Speed Card ────────────────────────────────────────────────────────────
function WindSpeedCard({ value, low, high, delay = 0 }) {
  return (
    <div style={{
      ...glass({ padding: '12px 14px' }),
      animation: `glassIn 0.6s cubic-bezier(.16,1,.3,1) ${delay}s both`,
      transition: 'transform 0.3s, box-shadow 0.3s', cursor: 'default',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 40px rgba(0,0,0,0.1)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <div style={{ width: 26, height: 26, borderRadius: 8, background: '#8B5CF618', border: '1px solid #8B5CF625', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Wind size={13} color="#8B5CF6" />
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Wind Speed</span>
      </div>
      <div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{fmtVal(value)}</span>
        <span style={{ fontSize: 9, color: 'var(--text-faint)', marginLeft: 3 }}>m/s</span>
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 4, fontFamily: 'var(--mono)' }}>
        {value != null ? beaufortLabel(value) : '—'}
        {low != null && high != null ? ` · ${low}–${high} m/s` : ''}
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
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
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
