import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase, getDemoHistory } from '../lib/supabase';
import { glass, glassInner } from '../lib/utils';
import { Loader2, CalendarDays } from 'lucide-react';

// ── US EPA AQI breakpoints for PM2.5 ─────────────────────────────────────────
const AQI_BP = [
  [0,    12,    0,   50],
  [12.1, 35.4,  51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 150.4,151, 200],
  [150.5,250.4,201, 300],
];

function pm25ToAqi(pm25) {
  if (pm25 == null || isNaN(pm25)) return null;
  const v = Number(pm25);
  for (const [cLow, cHigh, iLow, iHigh] of AQI_BP) {
    if (v >= cLow && v <= cHigh) {
      return Math.round(((iHigh - iLow) / (cHigh - cLow)) * (v - cLow) + iLow);
    }
  }
  if (v > 250.4) return Math.round(((500 - 301) / (500.4 - 250.5)) * (v - 250.5) + 301);
  return null;
}

// ── NCEC daily limits ─────────────────────────────────────────────────────────
const DAILY_LIMITS = {
  pm25:  35,
  pm10:  340,
  so2:   441,
  no2:   200,
  o3:    157,
  co:    40000,
};

const POLLUTANT_LABELS = {
  pm25: 'PM₂.₅',
  pm10: 'PM₁₀',
  so2:  'SO₂',
  no2:  'NO₂',
  o3:   'O₃',
  co:   'CO',
};

const POLLUTANT_UNITS = {
  pm25: 'µg/m³',
  pm10: 'µg/m³',
  so2:  'µg/m³',
  no2:  'µg/m³',
  o3:   'µg/m³',
  co:   'µg/m³',
};

// ── Cell color logic ──────────────────────────────────────────────────────────
function getDayColor(dayData) {
  if (!dayData || dayData.count === 0) return 'var(--border)';
  const { aqi, exceedances } = dayData;
  const hasNCEC = exceedances && exceedances.length > 0;
  if (aqi == null) {
    if (hasNCEC) return '#ef4444';
    return '#10b981';
  }
  if (aqi <= 50 && !hasNCEC) return '#10b981';
  if (aqi <= 100 && !hasNCEC) return '#f59e0b';
  if (aqi <= 150 || (hasNCEC && aqi <= 150)) return '#f97316';
  if (aqi <= 200 || hasNCEC) return '#ef4444';
  return '#991b1b';
}

// ── Month names ───────────────────────────────────────────────────────────────
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_LABELS  = ['M','T','W','T','F','S','S'];

// ── Format date for tooltip ───────────────────────────────────────────────────
function fmtDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Build weeks array ─────────────────────────────────────────────────────────
function buildWeeks(year) {
  const jan1 = new Date(year, 0, 1);
  // Mon=0..Sun=6
  const offset = (jan1.getDay() + 6) % 7;
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const totalDays = isLeap ? 366 : 365;

  const days = [];
  // pad start
  for (let i = 0; i < offset; i++) days.push(null);
  for (let d = 0; d < totalDays; d++) {
    const dt = new Date(year, 0, d + 1);
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    days.push(`${year}-${mm}-${dd}`);
  }

  // slice into columns of 7
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

// ── Month label positions ──────────────────────────────────────────────────────
function buildMonthLabels(year, weeks) {
  const labels = [];
  const seen = new Set();
  weeks.forEach((week, wi) => {
    week.forEach(day => {
      if (!day) return;
      const m = parseInt(day.split('-')[1], 10) - 1;
      if (!seen.has(m)) {
        seen.add(m);
        labels.push({ month: m, weekIdx: wi });
      }
    });
  });
  return labels;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function ExceedanceCalendar({ station, isDemo, onNavigate }) {
  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4];

  const [year, setYear]         = useState(currentYear);
  const [loading, setLoading]   = useState(false);
  const [dayMap, setDayMap]     = useState({});   // { 'YYYY-MM-DD': { aqi, exceedances, count, maxVals } }
  const [tooltip, setTooltip]   = useState(null); // { x, y, day, data }

  // ── Fetch data ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!station) return;
    setDayMap({});
    setLoading(true);

    const load = async () => {
      try {
        let readings = [];

        if (isDemo) {
          readings = getDemoHistory(station.id, 8760);
        } else {
          const fromISO = `${year}-01-01T00:00:00`;
          const toISO   = `${year}-12-31T23:59:59`;
          const CHUNK   = 1000;
          let offset    = 0;
          while (true) {
            const { data, error } = await supabase
              .from('readings')
              .select('timestamp, pm25, pm10, so2, no2, o3, co, aqi')
              .eq('station_id', station.id)
              .gte('timestamp', fromISO)
              .lte('timestamp', toISO)
              .order('timestamp', { ascending: true })
              .range(offset, offset + CHUNK - 1);
            if (error) throw new Error(error.message);
            if (!data || !data.length) break;
            readings = readings.concat(data);
            if (data.length < CHUNK) break;
            offset += CHUNK;
          }
        }

        // Group by day
        const groups = {};
        readings.forEach(r => {
          const day = r.timestamp.slice(0, 10);
          if (!groups[day]) groups[day] = [];
          groups[day].push(r);
        });

        // Compute per-day stats
        const map = {};
        Object.entries(groups).forEach(([day, recs]) => {
          // Max values per pollutant
          const maxVals = {};
          Object.keys(DAILY_LIMITS).forEach(k => {
            const vals = recs.map(r => r[k]).filter(v => v != null && !isNaN(Number(v))).map(Number);
            maxVals[k] = vals.length ? Math.max(...vals) : null;
          });

          // AQI from maxPM25
          const aqi = maxVals.pm25 != null ? pm25ToAqi(maxVals.pm25)
            : (recs.some(r => r.aqi != null)
              ? Math.max(...recs.map(r => r.aqi).filter(v => v != null && !isNaN(Number(v))).map(Number))
              : null);

          // Exceedances
          const exceedances = [];
          Object.entries(DAILY_LIMITS).forEach(([k, limit]) => {
            if (maxVals[k] != null && maxVals[k] > limit) {
              exceedances.push({ key: k, value: maxVals[k], limit });
            }
          });

          map[day] = { aqi, exceedances, count: recs.length, maxVals };
        });

        setDayMap(map);
      } catch {
        setDayMap({});
      }
      setLoading(false);
    };

    load();
  }, [station, year, isDemo]);

  // ── Build grid ────────────────────────────────────────────────────────────────
  const weeks = useMemo(() => buildWeeks(year), [year]);
  const monthLabels = useMemo(() => buildMonthLabels(year, weeks), [year, weeks]);

  // ── Summary stats ──────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const days = Object.entries(dayMap);
    const totalMonitored = days.filter(([, d]) => d.count > 0).length;
    const daysWithExceed = days.filter(([, d]) => d.exceedances && d.exceedances.length > 0).length;
    const pct = totalMonitored > 0 ? ((daysWithExceed / totalMonitored) * 100).toFixed(1) : '0.0';

    // Longest compliant streak
    const allDaysSorted = days
      .filter(([, d]) => d.count > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    let longest = 0, current = 0;
    allDaysSorted.forEach(([, d]) => {
      if (!d.exceedances || d.exceedances.length === 0) {
        current++;
        longest = Math.max(longest, current);
      } else {
        current = 0;
      }
    });

    // Most common breach
    const breachCount = {};
    days.forEach(([, d]) => {
      if (d.exceedances) d.exceedances.forEach(e => {
        breachCount[e.key] = (breachCount[e.key] || 0) + 1;
      });
    });
    let topBreach = null, topCount = 0;
    Object.entries(breachCount).forEach(([k, n]) => {
      if (n > topCount) { topBreach = k; topCount = n; }
    });

    return { totalMonitored, daysWithExceed, pct, longest, topBreach, topBreachCount: topCount };
  }, [dayMap]);

  // ── Tooltip handlers ──────────────────────────────────────────────────────────
  const handleMouseEnter = useCallback((e, day, data) => {
    setTooltip({ x: e.clientX, y: e.clientY, day, data });
  }, []);

  const handleMouseMove = useCallback((e) => {
    setTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : prev);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const handleDayClick = useCallback((day, data) => {
    if (!data || data.count === 0) return;
    localStorage.setItem('aw-data-from', day);
    localStorage.setItem('aw-data-to', day);
    onNavigate?.('data');
  }, [onNavigate]);

  const CELL = 11;
  const GAP  = 2;

  return (
    <div style={{ ...glass({ padding: '20px 24px', marginBottom: 16, borderRadius: 18 }), animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.18s both' }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CalendarDays size={15} color="#16A34A" />
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Exceedance Calendar</h2>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, flex: 1 }}>
          Daily AQI &amp; NCEC exceedance status — click any day to view its data
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {loading && <Loader2 size={13} color="var(--text-muted)" style={{ animation: 'spin 1s linear infinite' }} />}
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            style={{
              padding: '6px 10px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.5)',
              background: 'rgba(255,255,255,0.35)', fontSize: 12, color: 'var(--text)',
              fontFamily: 'var(--font)', outline: 'none', cursor: 'pointer',
            }}
          >
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Calendar grid */}
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ display: 'inline-block', minWidth: weeks.length * (CELL + GAP) + 28 }}>

          {/* Month labels */}
          <div style={{ display: 'flex', marginLeft: 28, marginBottom: 4 }}>
            {weeks.map((_, wi) => {
              const lbl = monthLabels.find(m => m.weekIdx === wi);
              return (
                <div
                  key={wi}
                  style={{ width: CELL + GAP, flexShrink: 0, fontSize: 9, color: 'var(--text-faint)', fontFamily: 'DM Mono, monospace', overflow: 'visible', whiteSpace: 'nowrap' }}
                >
                  {lbl ? MONTH_NAMES[lbl.month] : ''}
                </div>
              );
            })}
          </div>

          {/* Grid rows */}
          <div style={{ display: 'flex', gap: 0 }}>
            {/* Day labels column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: GAP, marginRight: GAP, width: 24, flexShrink: 0 }}>
              {DAY_LABELS.map((lbl, i) => (
                <div
                  key={i}
                  style={{
                    height: CELL, width: 24, display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                    paddingRight: 4, fontSize: 8, color: (i === 0 || i === 2 || i === 4) ? 'var(--text-faint)' : 'transparent',
                    fontFamily: 'DM Mono, monospace', userSelect: 'none', flexShrink: 0,
                  }}
                >
                  {(i === 0 || i === 2 || i === 4) ? lbl : ''}
                </div>
              ))}
            </div>

            {/* Week columns */}
            {weeks.map((week, wi) => (
              <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: GAP, marginRight: GAP }}>
                {week.map((day, di) => {
                  if (!day) {
                    return <div key={di} style={{ width: CELL, height: CELL, flexShrink: 0 }} />;
                  }
                  const data = dayMap[day];
                  const color = getDayColor(data);
                  const hasData = data && data.count > 0;
                  return (
                    <div
                      key={di}
                      style={{
                        width: CELL, height: CELL, borderRadius: 2, flexShrink: 0,
                        background: color,
                        cursor: hasData ? 'pointer' : 'default',
                        transition: 'opacity 0.1s, transform 0.1s',
                        opacity: loading ? 0.5 : 1,
                      }}
                      onMouseEnter={e => handleMouseEnter(e, day, data)}
                      onMouseMove={handleMouseMove}
                      onMouseLeave={handleMouseLeave}
                      onClick={() => handleDayClick(day, data)}
                      onMouseOver={e => { if (hasData) e.currentTarget.style.opacity = '0.75'; }}
                      onMouseOut={e => { e.currentTarget.style.opacity = loading ? '0.5' : '1'; }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
        {[
          { color: 'var(--border)', label: 'No data' },
          { color: '#10b981', label: 'Good (AQI ≤50)' },
          { color: '#f59e0b', label: 'Moderate (51–100)' },
          { color: '#f97316', label: 'Sensitive (101–150)' },
          { color: '#ef4444', label: 'Unhealthy / Exceedance' },
          { color: '#991b1b', label: 'Very Unhealthy (200+)' },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0, border: color === 'var(--border)' ? '1px solid var(--border)' : 'none' }} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Summary stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 16 }}>
        {[
          {
            label: 'Total Days Monitored',
            value: stats.totalMonitored,
            sub: `in ${year}`,
          },
          {
            label: 'Days with Exceedances',
            value: stats.daysWithExceed,
            sub: `${stats.pct}% of monitored days`,
            color: stats.daysWithExceed > 0 ? '#ef4444' : '#10b981',
          },
          {
            label: 'Longest Compliant Streak',
            value: `${stats.longest}d`,
            sub: 'consecutive clean days',
            color: '#10b981',
          },
          {
            label: 'Most Common Breach',
            value: stats.topBreach ? POLLUTANT_LABELS[stats.topBreach] : 'None',
            sub: stats.topBreach ? `${stats.topBreachCount} day${stats.topBreachCount !== 1 ? 's' : ''}` : 'No exceedances recorded',
            color: stats.topBreach ? '#ef4444' : '#10b981',
          },
        ].map((card, i) => (
          <div key={i} style={{ ...glassInner({ padding: '12px 14px', borderRadius: 12 }) }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>{card.label}</p>
            <p style={{ fontSize: 20, fontWeight: 700, margin: '0 0 2px', fontFamily: 'DM Mono, monospace', color: card.color || 'var(--text)', lineHeight: 1 }}>{card.value}</p>
            <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: 0 }}>{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          style={{
            ...glass({ padding: '10px 14px', borderRadius: 12 }),
            position: 'fixed',
            left: tooltip.x + 14,
            top: tooltip.y - 10,
            zIndex: 9999,
            pointerEvents: 'none',
            minWidth: 180,
            maxWidth: 260,
            boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
          }}
        >
          <p style={{ fontSize: 11, fontWeight: 700, margin: '0 0 6px', color: 'var(--text)', fontFamily: 'Instrument Sans, sans-serif' }}>
            {fmtDay(tooltip.day)}
          </p>
          {tooltip.data && tooltip.data.count > 0 ? (
            <>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 4px', fontFamily: 'DM Mono, monospace' }}>
                AQI: {tooltip.data.aqi != null ? tooltip.data.aqi : '—'}
                <span style={{ marginLeft: 8, color: 'var(--text-faint)' }}>({tooltip.data.count} readings)</span>
              </p>
              {tooltip.data.exceedances && tooltip.data.exceedances.length > 0 ? (
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', margin: '4px 0 3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Exceedances</p>
                  {tooltip.data.exceedances.map(e => (
                    <p key={e.key} style={{ fontSize: 11, color: '#ef4444', margin: '1px 0', fontFamily: 'DM Mono, monospace' }}>
                      {POLLUTANT_LABELS[e.key]}: {Number(e.value).toFixed(1)} {POLLUTANT_UNITS[e.key]} &gt; {e.limit} limit
                    </p>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 11, color: '#10b981', margin: '4px 0 0', fontWeight: 600 }}>No exceedances</p>
              )}
            </>
          ) : (
            <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: 0 }}>No data recorded</p>
          )}
        </div>
      )}
    </div>
  );
}
