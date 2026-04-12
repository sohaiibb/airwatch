import { useState, useEffect, useRef } from 'react';
import { FileText, Download, Calendar, AlertTriangle, Loader2, Clock, Trash2, Printer, ChevronDown, ChevronUp } from 'lucide-react';
import { getStations, getReadingsByDateRange } from '../lib/supabase';
import { glass, glassInner, POLLUTANTS, getAqiLevel, generateDemoHistory, NCEC_STANDARDS } from '../lib/utils';

// ── helpers ─────────────────────────────────────────────────────────────────

function fmtN(v, d = 1) { return v != null && !isNaN(Number(v)) ? Number(v).toFixed(d) : '—'; }
function fmtDate(s) { return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtDateTime(s) { return new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); }

function stdDev(vals) {
  if (vals.length < 2) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function calcStats(readings, key) {
  const vals = readings.map(r => r[key]).filter(v => v != null && !isNaN(Number(v))).map(Number);
  if (!vals.length) return { count: 0, mean: null, min: null, max: null, sd: null, p98: null, avg: null };
  const sorted = [...vals].sort((a, b) => a - b);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { count: vals.length, mean, avg: mean, min: sorted[0], max: sorted[sorted.length - 1], sd: stdDev(vals), p98: percentile(sorted, 98) };
}

// Rolling N-hour average (returns array of { timestamp, value })
function rollingAvg(readings, key, hours) {
  const ms = hours * 3600000;
  return readings.map((r, i) => {
    const t = new Date(r.timestamp).getTime();
    const window = readings.filter(x => {
      const xt = new Date(x.timestamp).getTime();
      return xt >= t - ms && xt <= t;
    });
    const vals = window.map(x => x[key]).filter(v => v != null && !isNaN(Number(v))).map(Number);
    return { timestamp: r.timestamp, value: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
  });
}

// Daily averages grouped by date
function calcDailyAvgs(readings, key) {
  const groups = {};
  readings.forEach(r => {
    const day = r.timestamp.slice(0, 10);
    if (!groups[day]) groups[day] = [];
    if (r[key] != null && !isNaN(Number(r[key]))) groups[day].push(Number(r[key]));
  });
  return Object.entries(groups).map(([day, vals]) => ({
    date: day,
    avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
    count: vals.length,
  }));
}

// Build compliance rows per NCEC_STANDARDS
function buildComplianceRows(readings) {
  return Object.entries(NCEC_STANDARDS).map(([key, meta]) => {
    const rows = meta.standards.map(std => {
      let values, exceedCount;
      if (std.period === '1-hour') {
        const hourly = rollingAvg(readings, key, 1);
        values = hourly.map(h => h.value).filter(v => v != null);
        exceedCount = values.filter(v => v > std.limit).length;
      } else if (std.period === '8-hour') {
        const rolling = rollingAvg(readings, key, 8);
        values = rolling.map(h => h.value).filter(v => v != null);
        exceedCount = values.filter(v => v > std.limit).length;
      } else if (std.period === '24-hour') {
        const daily = calcDailyAvgs(readings, key);
        values = daily.map(d => d.avg).filter(v => v != null);
        exceedCount = values.filter(v => v > std.limit).length;
      } else if (std.period === '1-year') {
        const allVals = readings.map(r => r[key]).filter(v => v != null && !isNaN(Number(v))).map(Number);
        values = allVals.length ? [allVals.reduce((a, b) => a + b, 0) / allVals.length] : [];
        exceedCount = values.filter(v => v > std.limit).length;
      } else {
        values = [];
        exceedCount = 0;
      }
      const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      const max = values.length ? Math.max(...values) : null;
      const compliant = exceedCount === 0;
      return { ...std, key, label: meta.label, unit: meta.unit, color: meta.color, avg, max, exceedCount, compliant, dataPoints: values.length };
    });
    return rows;
  }).flat();
}

const DATE_PRESETS = [
  { label: 'Last 24h',  days: 1 },
  { label: 'Last 7 Days', days: 7 },
  { label: 'Last 30 Days', days: 30 },
];

// ── ReportView ───────────────────────────────────────────────────────────────

function ReportView({ station, from, to, readings, generatedAt }) {
  const printStyleRef = useRef(null);

  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'airwatch-print-css';
    style.textContent = `
      @media print {
        aside, .report-generator, nav { display: none !important; }
        body { background: #fff !important; }
        main { margin-left: 0 !important; padding: 0 !important; }
        .no-print { display: none !important; }
        .print-section { break-inside: avoid; }
        @page { margin: 18mm 16mm; size: A4; }
      }
    `;
    document.head.appendChild(style);
    printStyleRef.current = style;
    return () => { if (printStyleRef.current) printStyleRef.current.remove(); };
  }, []);

  const complianceRows = buildComplianceRows(readings);
  const aqiStats = calcStats(readings, 'aqi');
  const aqiLvl = getAqiLevel(Math.round(aqiStats.avg || 0));
  const overallCompliant = complianceRows.every(r => r.compliant || r.dataPoints === 0);
  const totalExceedances = complianceRows.reduce((s, r) => s + r.exceedCount, 0);

  const MET_PARAMS = [
    { key: 'temperature', label: 'Temperature', unit: '°C' },
    { key: 'humidity', label: 'Relative Humidity', unit: '%' },
    { key: 'wind_speed', label: 'Wind Speed', unit: 'm/s' },
    { key: 'pressure', label: 'Pressure', unit: 'hPa' },
  ];

  const cellStyle = (border = true) => ({
    padding: '8px 12px',
    borderBottom: border ? '1px solid #E7E5E4' : 'none',
    fontSize: 12,
    fontFamily: 'DM Mono, monospace',
    color: '#1C1917',
    verticalAlign: 'middle',
  });

  const thStyle = {
    padding: '9px 12px',
    background: '#16A34A',
    color: '#fff',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    textAlign: 'left',
    fontFamily: 'Instrument Sans, sans-serif',
  };

  return (
    <div id="airwatch-report" style={{ fontFamily: 'Instrument Sans, sans-serif', color: '#1C1917', maxWidth: 900, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div className="print-section" style={{ ...glass({ padding: '24px 28px', marginBottom: 16, borderRadius: 16 }), display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#16A34A', textTransform: 'uppercase', marginBottom: 6 }}>Hills and Field Company Limited · NCEC Type A Environmental Consultancy</p>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.02em' }}>Air Quality Compliance Report</h2>
          <p style={{ fontSize: 13, color: '#57534E', margin: 0 }}>{station.name} &nbsp;·&nbsp; {fmtDate(from)} – {fmtDate(to)}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ ...glassInner({ padding: '10px 16px', display: 'inline-block' }), background: overallCompliant ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.10)', border: `1px solid ${overallCompliant ? 'rgba(22,163,74,0.3)' : 'rgba(220,38,38,0.3)'}` }}>
            <p style={{ fontSize: 10, color: '#78716C', margin: '0 0 2px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Overall Status</p>
            <p style={{ fontSize: 16, fontWeight: 700, margin: 0, color: overallCompliant ? '#16A34A' : '#DC2626' }}>
              {overallCompliant ? '✓ Compliant' : `✗ ${totalExceedances} Exceedance${totalExceedances !== 1 ? 's' : ''}`}
            </p>
            <p style={{ fontSize: 10, color: '#A8A29E', margin: '2px 0 0' }}>Per NCEC Executive Regulation (Royal Decree M/165)</p>
          </div>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="print-section" style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Avg AQI', value: fmtN(aqiStats.avg, 0), sub: aqiLvl.label, color: aqiLvl.color },
          { label: 'Min AQI', value: fmtN(aqiStats.min, 0), sub: 'Best reading', color: '#16A34A' },
          { label: 'Max AQI', value: fmtN(aqiStats.max, 0), sub: 'Worst reading', color: '#DC2626' },
          { label: 'Data Points', value: readings.length, sub: `${Math.round(readings.length / Math.max(1, (new Date(to) - new Date(from)) / 86400000))}/day avg`, color: '#3B82F6' },
          { label: 'Exceedances', value: totalExceedances, sub: totalExceedances === 0 ? 'All standards met' : 'NCEC threshold(s)', color: totalExceedances === 0 ? '#16A34A' : '#DC2626' },
        ].map((b, i) => (
          <div key={i} style={{ ...glass({ padding: '14px 16px', borderRadius: 14, borderTop: `3px solid ${b.color}` }) }}>
            <p style={{ fontSize: 10, color: '#78716C', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>{b.label}</p>
            <p style={{ fontSize: 24, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: '#1C1917', margin: '0 0 2px', lineHeight: 1 }}>{b.value}</p>
            <p style={{ fontSize: 11, color: b.color, fontWeight: 600, margin: 0 }}>{b.sub}</p>
          </div>
        ))}
      </div>

      {/* ── NCEC Compliance Table ── */}
      <div className="print-section" style={{ ...glass({ padding: '20px 24px', marginBottom: 16, borderRadius: 16 }) }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 4, height: 14, background: '#16A34A', borderRadius: 2, display: 'inline-block' }} />
          NCEC Compliance — Royal Decree M/165 (Appendix 1)
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Pollutant', 'Unit', 'Avg. Period', 'NCEC Limit', 'Measured Avg', 'Measured Max', 'Exceedances', 'Allowed', 'Status'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {complianceRows.map((row, i) => {
              const bg = row.dataPoints === 0 ? '#fff' : row.compliant ? '#F0FDF4' : '#FEF2F2';
              return (
                <tr key={i} style={{ background: bg }}>
                  <td style={{ ...cellStyle(), fontWeight: 700, fontFamily: 'Instrument Sans, sans-serif', color: row.color }}>{row.label}</td>
                  <td style={cellStyle()}>{row.unit}</td>
                  <td style={cellStyle()}>{row.period}</td>
                  <td style={{ ...cellStyle(), fontWeight: 700 }}>{row.limit.toLocaleString()}</td>
                  <td style={cellStyle()}>{fmtN(row.avg)}</td>
                  <td style={cellStyle()}>{fmtN(row.max)}</td>
                  <td style={{ ...cellStyle(), fontWeight: 700, color: row.exceedCount > 0 ? '#DC2626' : '#16A34A' }}>{row.dataPoints === 0 ? '—' : row.exceedCount}</td>
                  <td style={{ ...cellStyle(), color: '#78716C', fontSize: 10 }}>{row.exceedances || '—'}</td>
                  <td style={cellStyle()}>
                    {row.dataPoints === 0
                      ? <span style={{ color: '#A8A29E', fontSize: 11 }}>No data</span>
                      : row.compliant
                        ? <span style={{ color: '#16A34A', fontWeight: 700, fontSize: 11 }}>✓ Compliant</span>
                        : <span style={{ color: '#DC2626', fontWeight: 700, fontSize: 11 }}>✗ Exceeded</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={{ fontSize: 10, color: '#78716C', marginTop: 8, lineHeight: 1.5 }}>
          NCEC Executive Regulation on Air Quality Standards (Royal Decree M/165, Appendix 1, 2019). Averaging periods applied as specified per pollutant. Exceedances counted against measured data in selected date range only.
        </p>
      </div>

      {/* ── Statistics Table ── */}
      <div className="print-section" style={{ ...glass({ padding: '20px 24px', marginBottom: 16, borderRadius: 16 }) }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 4, height: 14, background: '#3B82F6', borderRadius: 2, display: 'inline-block' }} />
          Descriptive Statistics
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Pollutant', 'Unit', 'Count', 'Mean', 'Min', 'Max', 'Std Dev', 'P98', 'Exceedances (24h avg)'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {POLLUTANTS.map((p, i) => {
              const s = calcStats(readings, p.key);
              const daily = calcDailyAvgs(readings, p.key);
              const dailyExceed = daily.filter(d => d.avg != null && d.avg > p.threshold).length;
              return (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : 'rgba(248,248,247,0.8)' }}>
                  <td style={{ ...cellStyle(), fontWeight: 700, fontFamily: 'Instrument Sans, sans-serif', color: p.color }}>{p.name}</td>
                  <td style={cellStyle()}>{p.unit}</td>
                  <td style={cellStyle()}>{s.count || '—'}</td>
                  <td style={cellStyle()}>{fmtN(s.mean)}</td>
                  <td style={cellStyle()}>{fmtN(s.min)}</td>
                  <td style={cellStyle()}>{fmtN(s.max)}</td>
                  <td style={cellStyle()}>{fmtN(s.sd)}</td>
                  <td style={cellStyle()}>{fmtN(s.p98)}</td>
                  <td style={{ ...cellStyle(), color: dailyExceed > 0 ? '#DC2626' : '#16A34A', fontWeight: dailyExceed > 0 ? 700 : 400 }}>
                    {s.count === 0 ? '—' : dailyExceed === 0 ? '0 (All OK)' : `${dailyExceed} day${dailyExceed !== 1 ? 's' : ''}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Meteorological Summary ── */}
      <div className="print-section" style={{ ...glass({ padding: '20px 24px', marginBottom: 16, borderRadius: 16 }) }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 4, height: 14, background: '#F59E0B', borderRadius: 2, display: 'inline-block' }} />
          Meteorological Summary
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Parameter', 'Unit', 'Count', 'Mean', 'Min', 'Max', 'Std Dev'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MET_PARAMS.map((m, i) => {
              const s = calcStats(readings, m.key);
              return (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : 'rgba(248,248,247,0.8)' }}>
                  <td style={{ ...cellStyle(), fontWeight: 700, fontFamily: 'Instrument Sans, sans-serif' }}>{m.label}</td>
                  <td style={cellStyle()}>{m.unit}</td>
                  <td style={cellStyle()}>{s.count || '—'}</td>
                  <td style={cellStyle()}>{fmtN(s.mean)}</td>
                  <td style={cellStyle()}>{fmtN(s.min)}</td>
                  <td style={cellStyle()}>{fmtN(s.max)}</td>
                  <td style={cellStyle()}>{fmtN(s.sd)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Hourly Data Table ── */}
      <HourlyTable readings={readings} />

      {/* ── Footer ── */}
      <div className="print-section" style={{ ...glass({ padding: '16px 24px', borderRadius: 14 }), display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, margin: '0 0 2px' }}>Hills and Field Company Limited</p>
          <p style={{ fontSize: 10, color: '#78716C', margin: 0 }}>NCEC Type A Environmental Consultancy · Report generated: {fmtDateTime(generatedAt)}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: 10, color: '#78716C', margin: 0 }}>Data source: AirWatch Monitoring Platform</p>
          <p style={{ fontSize: 10, color: '#78716C', margin: '2px 0 0' }}>Station: {station.name}</p>
        </div>
      </div>
    </div>
  );
}

// Hourly table as separate component to handle its own pagination
function HourlyTable({ readings }) {
  const [page, setPage] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const PER_PAGE = 48;
  const sorted = [...readings].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const total = sorted.length;
  const totalPages = Math.ceil(total / PER_PAGE);
  const slice = sorted.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  const thStyle = {
    padding: '8px 10px',
    background: '#1C1917',
    color: '#fff',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    textAlign: 'left',
    fontFamily: 'Instrument Sans, sans-serif',
    whiteSpace: 'nowrap',
  };
  const tdStyle = {
    padding: '7px 10px',
    fontSize: 11,
    fontFamily: 'DM Mono, monospace',
    borderBottom: '1px solid #F5F5F4',
    whiteSpace: 'nowrap',
  };

  return (
    <div className="print-section" style={{ ...glass({ padding: '20px 24px', marginBottom: 16, borderRadius: 16 }) }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: collapsed ? 0 : 14 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 4, height: 14, background: '#8B5CF6', borderRadius: 2, display: 'inline-block' }} />
          Hourly Data ({total} records)
        </h3>
        <button
          className="no-print"
          onClick={() => setCollapsed(c => !c)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#57534E', fontFamily: 'var(--font)' }}
        >
          {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </div>

      {!collapsed && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr>
                  {['Timestamp', 'AQI', 'PM2.5', 'PM10', 'SO₂', 'NO₂', 'O₃', 'CO', 'Temp °C', 'Hum %', 'Wind m/s'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slice.map((r, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : 'rgba(248,248,247,0.8)' }}>
                    <td style={{ ...tdStyle, color: '#57534E', fontWeight: 500 }}>{fmtDateTime(r.timestamp)}</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: getAqiLevel(r.aqi || 0).color }}>{r.aqi ?? '—'}</td>
                    <td style={tdStyle}>{r.pm25 != null ? Number(r.pm25).toFixed(1) : '—'}</td>
                    <td style={tdStyle}>{r.pm10 != null ? Number(r.pm10).toFixed(1) : '—'}</td>
                    <td style={tdStyle}>{r.so2 != null ? Number(r.so2).toFixed(1) : '—'}</td>
                    <td style={tdStyle}>{r.no2 != null ? Number(r.no2).toFixed(1) : '—'}</td>
                    <td style={tdStyle}>{r.o3 != null ? Number(r.o3).toFixed(1) : '—'}</td>
                    <td style={tdStyle}>{r.co != null ? Number(r.co).toFixed(0) : '—'}</td>
                    <td style={tdStyle}>{r.temperature != null ? Number(r.temperature).toFixed(1) : '—'}</td>
                    <td style={tdStyle}>{r.humidity != null ? Number(r.humidity).toFixed(1) : '—'}</td>
                    <td style={tdStyle}>{r.wind_speed != null ? Number(r.wind_speed).toFixed(1) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
              <p style={{ fontSize: 11, color: '#78716C', margin: 0 }}>
                Showing {page * PER_PAGE + 1}–{Math.min((page + 1) * PER_PAGE, total)} of {total}
              </p>
              <div style={{ display: 'flex', gap: 6 }}>
                <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={{ padding: '4px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.5)', background: page === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.4)', fontSize: 11, cursor: page === 0 ? 'default' : 'pointer', fontFamily: 'var(--font)', color: page === 0 ? '#A8A29E' : '#1C1917' }}>
                  Prev
                </button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  const pg = totalPages <= 7 ? i : Math.max(0, Math.min(page - 3 + i, totalPages - 1));
                  return (
                    <button key={pg} onClick={() => setPage(pg)} style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid', borderColor: page === pg ? '#16A34A' : 'rgba(255,255,255,0.5)', background: page === pg ? 'rgba(22,163,74,0.15)' : 'rgba(255,255,255,0.4)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font)', color: page === pg ? '#16A34A' : '#1C1917', fontWeight: page === pg ? 700 : 400 }}>
                      {pg + 1}
                    </button>
                  );
                })}
                <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} style={{ padding: '4px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.5)', background: page >= totalPages - 1 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.4)', fontSize: 11, cursor: page >= totalPages - 1 ? 'default' : 'pointer', fontFamily: 'var(--font)', color: page >= totalPages - 1 ? '#A8A29E' : '#1C1917' }}>
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main Reports Page ────────────────────────────────────────────────────────

export default function Reports({ profile }) {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const [stations, setStations] = useState([]);
  const [form, setForm] = useState({ stationId: '', from: weekAgo, to: today });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);
  const [recentReports, setRecentReports] = useState([]);

  useEffect(() => {
    getStations().then(st => {
      if (st.length) {
        setStations(st);
        setForm(f => ({ ...f, stationId: st[0].id }));
      } else {
        const demo = [
          { id: 'demo-1', name: 'Al Khobar Central' },
          { id: 'demo-2', name: 'Dammam Industrial' },
          { id: 'demo-3', name: 'Dhahran Tech Valley' },
        ];
        setStations(demo);
        setForm(f => ({ ...f, stationId: demo[0].id }));
      }
    });
    try {
      const saved = JSON.parse(localStorage.getItem('airwatch_reports') || '[]');
      setRecentReports(saved);
    } catch {}
  }, []);

  function applyPreset(days) {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    setForm(f => ({ ...f, from, to }));
  }

  async function generateReport(params = form) {
    if (!params.stationId || !params.from || !params.to) { setError('Please select a station and date range.'); return; }
    if (new Date(params.to) < new Date(params.from)) { setError('"To" date must be after "From" date.'); return; }
    setError('');
    setLoading(true);
    setReport(null);

    try {
      const station = stations.find(s => s.id === params.stationId) || { id: params.stationId, name: params.stationName || 'Unknown' };
      const isDemo = params.stationId.startsWith('demo-');

      let readings;
      if (isDemo) {
        const hours = Math.max(1, Math.ceil((new Date(params.to) - new Date(params.from)) / 3600000));
        readings = generateDemoHistory(Math.min(hours, 720));
      } else {
        readings = await getReadingsByDateRange(params.stationId, params.from + 'T00:00:00', params.to + 'T23:59:59');
      }

      const generatedAt = new Date().toISOString();
      setReport({ station, from: params.from, to: params.to, readings, generatedAt });

      const entry = { id: Date.now(), stationId: params.stationId, stationName: station.name, from: params.from, to: params.to, readingCount: readings.length, generatedAt };
      const updated = [entry, ...recentReports].slice(0, 8);
      setRecentReports(updated);
      localStorage.setItem('airwatch_reports', JSON.stringify(updated));

      setTimeout(() => document.getElementById('airwatch-report')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (e) {
      console.error(e);
      setError('Failed to load data. Please try again.');
    }
    setLoading(false);
  }

  function clearHistory() {
    setRecentReports([]);
    localStorage.removeItem('airwatch_reports');
  }

  const inputStyle = {
    width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.5)',
    background: 'rgba(255,255,255,0.35)', backdropFilter: 'blur(8px)', fontSize: 13,
    color: '#1C1917', fontFamily: 'var(--font)', outline: 'none',
  };
  const labelStyle = { fontSize: 11, fontWeight: 700, color: '#78716C', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6, display: 'block' };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Page header */}
      <div style={{ marginBottom: 24, animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) both' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.02em' }}>Reports</h1>
        <p style={{ color: '#78716C', fontSize: 13, margin: 0 }}>Generate NCEC compliance reports per Royal Decree M/165 for Hills and Field clients.</p>
      </div>

      {/* ── Report generator form ── */}
      <div className="report-generator" style={{ ...glass({ padding: '24px 28px' }), marginBottom: 20, animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.05s both' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={16} color="#16A34A" /> Generate New Report
        </h2>

        {/* Quick presets */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 11, color: '#78716C', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', alignSelf: 'center' }}>Quick range:</span>
          {DATE_PRESETS.map(p => (
            <button key={p.days} onClick={() => applyPreset(p.days)} style={{
              padding: '5px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.5)',
              background: 'rgba(255,255,255,0.35)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              color: '#57534E', fontFamily: 'var(--font)', transition: 'background 0.2s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.55)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.35)'}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr auto', gap: 16, alignItems: 'flex-end' }}>
          <div>
            <label style={labelStyle}>Station</label>
            <select value={form.stationId} onChange={e => setForm(f => ({ ...f, stationId: e.target.value }))} style={inputStyle}>
              {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>From</label>
            <input type="date" value={form.from} max={form.to || today} onChange={e => setForm(f => ({ ...f, from: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>To</label>
            <input type="date" value={form.to} min={form.from} max={today} onChange={e => setForm(f => ({ ...f, to: e.target.value }))} style={inputStyle} />
          </div>
          <button
            onClick={() => generateReport()}
            disabled={loading || !form.stationId}
            style={{
              padding: '10px 24px', borderRadius: 12, border: 'none', height: 40,
              background: loading ? 'rgba(22,163,74,0.5)' : 'linear-gradient(135deg, #16A34A, #15803D)',
              color: '#fff', fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 2px 16px rgba(22,163,74,0.3)', fontFamily: 'var(--font)',
            }}
          >
            {loading ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <FileText size={15} />}
            {loading ? 'Loading…' : 'Generate'}
          </button>
        </div>

        {error && (
          <div style={{ ...glassInner({ padding: '8px 14px', marginTop: 14, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)' }), display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={13} color="#DC2626" />
            <span style={{ fontSize: 12, color: '#DC2626' }}>{error}</span>
          </div>
        )}
      </div>

      {/* ── Recent reports ── */}
      {recentReports.length > 0 && !report && (
        <div style={{ ...glass({ padding: '20px 24px' }), marginBottom: 20, animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.1s both' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={15} color="#78716C" /> Recent Reports
            </h2>
            <button onClick={clearHistory} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: 'none', background: 'rgba(220,38,38,0.07)', color: '#DC2626', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}>
              <Trash2 size={11} /> Clear History
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recentReports.map((r, i) => (
              <div key={r.id} style={{ ...glassInner({ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }), animation: `glassIn 0.4s cubic-bezier(.16,1,.3,1) ${i * 0.04}s both` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <FileText size={15} color="#16A34A" />
                  </div>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{r.stationName}</p>
                    <p style={{ fontSize: 11, color: '#78716C', margin: '2px 0 0' }}>{fmtDate(r.from)} – {fmtDate(r.to)} · {r.readingCount} readings</p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 10, color: '#A8A29E', fontFamily: 'var(--mono)' }}>{fmtDateTime(r.generatedAt)}</span>
                  <button
                    onClick={() => generateReport({ stationId: r.stationId, stationName: r.stationName, from: r.from, to: r.to })}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(22,163,74,0.3)', background: 'rgba(22,163,74,0.08)', color: '#16A34A', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(22,163,74,0.15)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(22,163,74,0.08)'}
                  >
                    <Download size={12} /> Regenerate
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Inline Report View ── */}
      {report && (
        <div style={{ animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) both' }}>
          {/* Report actions bar */}
          <div className="no-print" style={{ ...glass({ padding: '12px 20px', marginBottom: 16, borderRadius: 14 }), display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: '#57534E' }}>
              Report: {report.station.name} · {fmtDate(report.from)} – {fmtDate(report.to)} · {report.readings.length} readings
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => { setReport(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#57534E', fontFamily: 'var(--font)' }}
              >
                ← New Report
              </button>
              <button
                onClick={() => window.print()}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #16A34A, #15803D)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 12px rgba(22,163,74,0.3)', fontFamily: 'var(--font)' }}
              >
                <Printer size={14} /> Save as PDF
              </button>
            </div>
          </div>

          <ReportView
            station={report.station}
            from={report.from}
            to={report.to}
            readings={report.readings}
            generatedAt={report.generatedAt}
          />
        </div>
      )}
    </div>
  );
}
