import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../lib/permissions';

const LIMITS = { pm25: 35, pm10: 340, so2: 441, no2: 200, o3: 157, co: 40000 };

function tickerColor(key, value) {
  const limit = LIMITS[key];
  if (!limit || value == null) return '#94a3b8';
  const ratio = value / limit;
  if (ratio >= 1.0) return '#ef4444';
  if (ratio >= 0.5) return '#f59e0b';
  return '#22c55e';
}

function fmtVal(v, d = 1) {
  return v != null ? Number(v).toFixed(d) : '—';
}

function degToCard(d) {
  if (d == null) return '—';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
}

export default function TickerStrip({ visible = true }) {
  const { canSeeParam, isHFCL } = usePermissions();
  const [items, setItems] = useState([]);

  async function fetchLatest() {
    try {
      const { data: stations } = await supabase
        .from('stations')
        .select('id, name')
        .eq('is_active', true);

      if (!stations?.length) return;

      const rows = await Promise.all(
        stations.map(async (s) => {
          const { data } = await supabase
            .from('readings')
            .select('pm25,pm10,so2,no2,o3,co,aqi,temperature,wind_speed,wind_direction,timestamp')
            .eq('station_id', s.id)
            .order('timestamp', { ascending: false })
            .limit(1)
            .single();
          return data ? { ...data, station: s.name } : null;
        })
      );

      const valid = rows.filter(Boolean);
      if (!valid.length) return;

      const built = [];
      valid.forEach(r => {
        const name = r.station.length > 20 ? r.station.slice(0, 18) + '…' : r.station;
        built.push({ label: name, value: null, unit: '', color: '#94a3b8', isHeader: true });
        if (canSeeParam('pm25') && r.pm25 != null)  built.push({ label: 'PM₂.₅', value: fmtVal(r.pm25), unit: 'µg/m³', color: tickerColor('pm25', r.pm25) });
        if (canSeeParam('pm10') && r.pm10 != null)  built.push({ label: 'PM₁₀',  value: fmtVal(r.pm10), unit: 'µg/m³', color: tickerColor('pm10', r.pm10) });
        if (canSeeParam('so2')  && r.so2 != null)   built.push({ label: 'SO₂',   value: fmtVal(r.so2),  unit: 'µg/m³', color: tickerColor('so2',  r.so2) });
        if (canSeeParam('no2')  && r.no2 != null)   built.push({ label: 'NO₂',   value: fmtVal(r.no2),  unit: 'µg/m³', color: tickerColor('no2',  r.no2) });
        if (canSeeParam('o3')   && r.o3 != null)    built.push({ label: 'O₃',    value: fmtVal(r.o3),   unit: 'µg/m³', color: tickerColor('o3',   r.o3) });
        if (canSeeParam('co')   && r.co != null)    built.push({ label: 'CO',    value: fmtVal(r.co, 0),unit: 'µg/m³', color: tickerColor('co',   r.co) });
        if (r.aqi != null)     built.push({ label: 'AQI',   value: Math.round(r.aqi).toString(), unit: '', color: r.aqi > 100 ? '#ef4444' : r.aqi > 50 ? '#f59e0b' : '#22c55e' });
        if (canSeeParam('temp') && r.temperature != null) built.push({ label: 'Temp', value: fmtVal(r.temperature), unit: '°C', color: '#94a3b8' });
        if (canSeeParam('ws') && r.wind_speed != null) built.push({ label: 'Wind', value: `${fmtVal(r.wind_speed)} m/s ${degToCard(r.wind_direction)}`, unit: '', color: '#94a3b8' });
      });

      setItems(built);
    } catch (e) {
      console.error('[TickerStrip]', e);
    }
  }

  useEffect(() => {
    fetchLatest();
    const id = setInterval(fetchLatest, 60000);
    return () => clearInterval(id);
  }, []);

  if (!visible || !items.length) return null;

  const renderItems = () => items.map((item, i) => {
    if (item.isHeader) {
      return (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 20 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#475569', display: 'inline-block' }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{item.label}</span>
        </span>
      );
    }
    return (
      <span key={i} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3, marginRight: 22 }}>
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>{item.label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: item.color, fontFamily: 'var(--mono)' }}>{item.value}</span>
        {item.unit && <span style={{ fontSize: 10, color: '#475569' }}>{item.unit}</span>}
      </span>
    );
  });

  const duration = Math.max(20, items.length * 1.8);

  return (
    <div style={{
      height: 36,
      background: '#0f172a',
      display: 'flex',
      alignItems: 'center',
      overflow: 'hidden',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      position: 'relative',
    }}>
      {/* LIVE badge */}
      <div style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '0 12px',
        height: '100%',
        background: 'rgba(15,23,42,1)',
        borderRight: '1px solid rgba(255,255,255,0.08)',
        zIndex: 2,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', background: '#22c55e',
          animation: 'live-pulse 2s ease-in-out infinite',
          display: 'inline-block',
        }} />
        <span style={{ fontSize: 10, fontWeight: 800, color: '#22c55e', letterSpacing: '0.1em' }}>LIVE</span>
      </div>

      {/* Scrolling content */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          whiteSpace: 'nowrap',
          animation: `ticker-scroll ${duration}s linear infinite`,
          paddingLeft: 20,
        }}>
          {renderItems()}
          {renderItems()}
        </div>
      </div>

      {/* Fade edges */}
      <div style={{ position: 'absolute', left: 72, top: 0, width: 24, height: '100%', background: 'linear-gradient(to right, #0f172a, transparent)', pointerEvents: 'none', zIndex: 1 }} />
      <div style={{ position: 'absolute', right: 0, top: 0, width: 32, height: '100%', background: 'linear-gradient(to left, #0f172a, transparent)', pointerEvents: 'none', zIndex: 1 }} />
    </div>
  );
}
