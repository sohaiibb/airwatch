import { useState, useEffect, useRef } from 'react';
import { FileText, AlertTriangle, Loader2, Clock, Trash2, Printer, ChevronDown, ChevronUp, Download } from 'lucide-react';
import { getStations, getReadingsByDateRange } from '../lib/supabase';
import { glass, glassInner, POLLUTANTS, getAqiLevel, generateDemoHistory, NCEC_STANDARDS } from '../lib/utils';

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtN(v, d = 1) { return v != null && !isNaN(Number(v)) ? Number(v).toFixed(d) : '—'; }
function fmtDate(s) { return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtDateTime(s) { return new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); }
function fmtHour(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

// US EPA PM2.5 → AQI breakpoints
const PM25_BP = [
  { lo: 0,     hi: 12.0,  aqiLo: 0,   aqiHi: 50  },
  { lo: 12.1,  hi: 35.4,  aqiLo: 51,  aqiHi: 100 },
  { lo: 35.5,  hi: 55.4,  aqiLo: 101, aqiHi: 150 },
  { lo: 55.5,  hi: 150.4, aqiLo: 151, aqiHi: 200 },
  { lo: 150.5, hi: 250.4, aqiLo: 201, aqiHi: 300 },
  { lo: 250.5, hi: 350.4, aqiLo: 301, aqiHi: 400 },
  { lo: 350.5, hi: 500.4, aqiLo: 401, aqiHi: 500 },
];
function pm25ToAqi(pm25) {
  if (pm25 == null || isNaN(pm25)) return null;
  const c = Math.round(pm25 * 10) / 10;
  const bp = PM25_BP.find(b => c >= b.lo && c <= b.hi);
  if (!bp) return c > 500 ? 500 : 0;
  return Math.round(((bp.aqiHi - bp.aqiLo) / (bp.hi - bp.lo)) * (c - bp.lo) + bp.aqiLo);
}

// Group raw readings into hourly buckets and average each parameter
const HOURLY_KEYS = ['pm25', 'pm10', 'so2', 'no2', 'o3', 'co', 'temperature', 'humidity', 'wind_speed', 'pressure'];
function buildHourlyRows(readings) {
  const buckets = {};
  readings.forEach(r => {
    const d = new Date(r.timestamp);
    d.setMinutes(0, 0, 0);
    const key = d.toISOString();
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(r);
  });
  return Object.entries(buckets)
    .sort(([a], [b]) => b.localeCompare(a)) // newest first
    .map(([hourIso, recs]) => {
      const row = { timestamp: hourIso, count: recs.length };
      HOURLY_KEYS.forEach(k => {
        const vals = recs.map(r => r[k]).filter(v => v != null && !isNaN(Number(v))).map(Number);
        row[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      });
      row.aqi = row.pm25 != null ? pm25ToAqi(row.pm25) : null;
      return row;
    });
}

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
  }));
}

// Rolling N-hour average
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

function buildComplianceRows(readings) {
  return Object.entries(NCEC_STANDARDS).flatMap(([key, meta]) =>
    meta.standards.map(std => {
      let values;
      if (std.period === '1-hour')       values = rollingAvg(readings, key, 1).map(h => h.value).filter(v => v != null);
      else if (std.period === '8-hour')  values = rollingAvg(readings, key, 8).map(h => h.value).filter(v => v != null);
      else if (std.period === '24-hour') values = calcDailyAvgs(readings, key).map(d => d.avg).filter(v => v != null);
      else {
        const allVals = readings.map(r => r[key]).filter(v => v != null && !isNaN(Number(v))).map(Number);
        values = allVals.length ? [allVals.reduce((a, b) => a + b, 0) / allVals.length] : [];
      }
      const exceedCount = values.filter(v => v > std.limit).length;
      const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      const max = values.length ? Math.max(...values) : null;
      return { ...std, key, label: meta.label, unit: meta.unit, color: meta.color, avg, max, exceedCount, compliant: exceedCount === 0, dataPoints: values.length };
    })
  );
}

const DATE_PRESETS = [
  { label: 'Last 24h', days: 1 },
  { label: 'Last 7 Days', days: 7 },
  { label: 'Last 30 Days', days: 30 },
];

// ── Shared table styles for the REPORT (clean white, no glass) ───────────────

const RS = {
  section: {
    background: '#ffffff',
    border: '1px solid #E7E5E4',
    borderRadius: 10,
    padding: '20px 24px',
    marginBottom: 16,
  },
  th: {
    padding: '9px 12px',
    background: '#16A34A',
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    textAlign: 'left',
    fontFamily: 'Instrument Sans, sans-serif',
    borderBottom: 'none',
  },
  thDark: {
    padding: '9px 12px',
    background: '#1C1917',
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    textAlign: 'left',
    fontFamily: 'Instrument Sans, sans-serif',
  },
  td: {
    padding: '8px 12px',
    borderBottom: '1px solid #E7E5E4',
    fontSize: 12,
    fontFamily: 'DM Mono, monospace',
    color: '#1C1917',
    verticalAlign: 'middle',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 700,
    margin: '0 0 14px',
    color: '#1C1917',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontFamily: 'Instrument Sans, sans-serif',
  },
};

// ── ReportView ────────────────────────────────────────────────────────────────

function ReportView({ station, from, to, readings, generatedAt }) {
  const printStyleRef = useRef(null);

  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'airwatch-print-css';
    style.textContent = `
      @media print {
        aside, .report-generator, nav, .no-print { display: none !important; }
        html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
        main { margin-left: 0 !important; padding: 6mm 8mm !important; max-width: 100% !important; }
        #airwatch-report { max-width: 100% !important; }
        #airwatch-report * {
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
          box-shadow: none !important;
        }
        .report-section {
          background: #fff !important;
          border: 1px solid #E7E5E4 !important;
          border-radius: 6px !important;
          break-inside: avoid;
          page-break-inside: avoid;
          margin-bottom: 10mm !important;
        }
        .report-page-break { page-break-before: always; break-before: page; }
        .report-summary-cards { display: grid !important; grid-template-columns: repeat(5,1fr) !important; gap: 6px !important; }
        .report-card {
          background: #fff !important;
          border: 1px solid #E7E5E4 !important;
          border-radius: 6px !important;
          padding: 10px 12px !important;
        }
        table { width: 100% !important; font-size: 10px !important; }
        th, td { padding: 6px 8px !important; }
        @page { margin: 14mm 12mm; size: A4 portrait; }
      }
    `;
    document.head.appendChild(style);
    printStyleRef.current = style;
    return () => { if (printStyleRef.current) printStyleRef.current.remove(); };
  }, []);

  const complianceRows = buildComplianceRows(readings);
  const hourlyRows     = buildHourlyRows(readings);
  // Compute AQI from PM2.5 for each raw reading, then stats
  const aqiValues = readings.map(r => pm25ToAqi(r.pm25)).filter(v => v != null);
  const aqiAvg    = aqiValues.length ? Math.round(aqiValues.reduce((a, b) => a + b, 0) / aqiValues.length) : null;
  const aqiMin    = aqiValues.length ? Math.min(...aqiValues) : null;
  const aqiMax    = aqiValues.length ? Math.max(...aqiValues) : null;
  const aqiLvl    = getAqiLevel(aqiAvg || 0);

  const overallCompliant  = complianceRows.every(r => r.compliant || r.dataPoints === 0);
  const totalExceedances  = complianceRows.reduce((s, r) => s + r.exceedCount, 0);

  // Data capture % (expected 1 reading/hour)
  const expectedHours   = Math.max(1, Math.round((new Date(to + 'T23:59:59') - new Date(from + 'T00:00:00')) / 3600000));
  const capturePercent  = Math.min(100, Math.round((hourlyRows.length / expectedHours) * 100));

  const MET_PARAMS = [
    { key: 'temperature', label: 'Temperature',      unit: '°C' },
    { key: 'humidity',    label: 'Relative Humidity', unit: '%' },
    { key: 'wind_speed',  label: 'Wind Speed',        unit: 'm/s' },
    { key: 'pressure',    label: 'Pressure',          unit: 'hPa' },
  ];

  return (
    <div id="airwatch-report" style={{ fontFamily: 'Instrument Sans, sans-serif', color: '#1C1917', maxWidth: 920, margin: '0 auto' }}>

      {/* ── a. Header ── */}
      <div className="report-section" style={{ ...RS.section, borderLeft: '4px solid #16A34A', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#16A34A', textTransform: 'uppercase', margin: '0 0 6px' }}>Hills and Field Company Limited</p>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.02em', color: '#1C1917' }}>Air Quality Compliance Report</h2>
          <p style={{ fontSize: 13, color: '#57534E', margin: '0 0 4px' }}>{station.name}</p>
          <p style={{ fontSize: 12, color: '#78716C', margin: 0 }}>Period: {fmtDate(from)} – {fmtDate(to)} &nbsp;·&nbsp; Generated: {fmtDateTime(generatedAt)}</p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 24 }}>
          <div style={{ display: 'inline-block', padding: '10px 18px', background: overallCompliant ? '#F0FDF4' : '#FEF2F2', border: `1px solid ${overallCompliant ? '#86EFAC' : '#FCA5A5'}`, borderRadius: 10 }}>
            <p style={{ fontSize: 10, color: '#78716C', margin: '0 0 3px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Overall Status</p>
            <p style={{ fontSize: 17, fontWeight: 700, margin: '0 0 2px', color: overallCompliant ? '#16A34A' : '#DC2626' }}>
              {overallCompliant ? '✓ Compliant' : `✗ ${totalExceedances} Exceedance${totalExceedances !== 1 ? 's' : ''}`}
            </p>
            <p style={{ fontSize: 10, color: '#78716C', margin: 0 }}>Royal Decree M/165</p>
          </div>
        </div>
      </div>

      {/* ── b. Summary Cards ── */}
      <div className="report-summary-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Data Points',   value: readings.length,                   sub: `${hourlyRows.length} hours`,              color: '#3B82F6' },
          { label: 'Data Capture',  value: `${capturePercent}%`,              sub: `${hourlyRows.length} / ${expectedHours}h`, color: capturePercent >= 75 ? '#16A34A' : '#CA8A04' },
          { label: 'Average AQI',   value: aqiAvg ?? '—',                     sub: aqiLvl.label,                              color: aqiLvl.color },
          { label: 'Min AQI',       value: aqiMin ?? '—',                     sub: 'Best hour',                               color: '#16A34A' },
          { label: 'Max AQI',       value: aqiMax ?? '—',                     sub: 'Worst hour',                              color: '#DC2626' },
        ].map((b, i) => (
          <div key={i} className="report-card" style={{ ...RS.section, padding: '14px 16px', borderTop: `3px solid ${b.color}` }}>
            <p style={{ fontSize: 10, color: '#78716C', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 5px' }}>{b.label}</p>
            <p style={{ fontSize: 24, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: '#1C1917', margin: '0 0 2px', lineHeight: 1 }}>{b.value}</p>
            <p style={{ fontSize: 11, color: b.color, fontWeight: 600, margin: 0 }}>{b.sub}</p>
          </div>
        ))}
      </div>

      {/* ── c. NCEC Compliance Table ── */}
      <div className="report-section report-page-break" style={RS.section}>
        <h3 style={RS.sectionTitle}>
          <span style={{ width: 4, height: 14, background: '#16A34A', borderRadius: 2, flexShrink: 0 }} />
          NCEC Compliance — Royal Decree M/165 (Appendix 1)
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Pollutant','Unit','Avg. Period','NCEC Limit','Measured Avg','Measured Max','Exceedances','Allowed','Status'].map(h => (
                <th key={h} style={RS.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {complianceRows.map((row, i) => (
              <tr key={i} style={{ background: row.dataPoints === 0 ? '#fff' : row.compliant ? '#F0FDF4' : '#FEF2F2' }}>
                <td style={{ ...RS.td, fontWeight: 700, fontFamily: 'Instrument Sans, sans-serif', color: row.color }}>{row.label}</td>
                <td style={RS.td}>{row.unit}</td>
                <td style={RS.td}>{row.period}</td>
                <td style={{ ...RS.td, fontWeight: 700 }}>{row.limit.toLocaleString()}</td>
                <td style={RS.td}>{fmtN(row.avg)}</td>
                <td style={RS.td}>{fmtN(row.max)}</td>
                <td style={{ ...RS.td, fontWeight: 700, color: row.exceedCount > 0 ? '#DC2626' : '#16A34A' }}>{row.dataPoints === 0 ? '—' : row.exceedCount}</td>
                <td style={{ ...RS.td, fontSize: 10, color: '#78716C' }}>{row.exceedances || '—'}</td>
                <td style={RS.td}>
                  {row.dataPoints === 0
                    ? <span style={{ color: '#A8A29E', fontSize: 11 }}>No data</span>
                    : row.compliant
                      ? <span style={{ color: '#16A34A', fontWeight: 700, fontSize: 11 }}>✓ Compliant</span>
                      : <span style={{ color: '#DC2626', fontWeight: 700, fontSize: 11 }}>✗ Exceeded</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 10, color: '#78716C', marginTop: 10, lineHeight: 1.6 }}>
          Standards per NCEC Executive Regulation on Air Quality (Royal Decree M/165, Appendix 1, 2019). Averaging periods applied as specified. Exceedances counted against data in selected range only.
        </p>
      </div>

      {/* ── d. Descriptive Statistics ── */}
      <div className="report-section report-page-break" style={RS.section}>
        <h3 style={RS.sectionTitle}>
          <span style={{ width: 4, height: 14, background: '#3B82F6', borderRadius: 2, flexShrink: 0 }} />
          Descriptive Statistics
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Pollutant','Unit','N','Mean','Min','Max','Std Dev','P98','Daily Exceedances'].map(h => (
                <th key={h} style={RS.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {POLLUTANTS.map((p, i) => {
              const s = calcStats(readings, p.key);
              const daily = calcDailyAvgs(readings, p.key);
              const dailyExceed = daily.filter(d => d.avg != null && d.avg > p.threshold).length;
              return (
                <tr key={i} style={{ background: i % 2 === 0 ? '#ffffff' : '#F9FAFB' }}>
                  <td style={{ ...RS.td, fontWeight: 700, fontFamily: 'Instrument Sans, sans-serif', color: p.color }}>{p.name}</td>
                  <td style={RS.td}>{p.unit}</td>
                  <td style={RS.td}>{s.count || '—'}</td>
                  <td style={RS.td}>{fmtN(s.mean)}</td>
                  <td style={RS.td}>{fmtN(s.min)}</td>
                  <td style={RS.td}>{fmtN(s.max)}</td>
                  <td style={RS.td}>{fmtN(s.sd)}</td>
                  <td style={RS.td}>{fmtN(s.p98)}</td>
                  <td style={{ ...RS.td, color: dailyExceed > 0 ? '#DC2626' : '#16A34A', fontWeight: dailyExceed > 0 ? 700 : 400 }}>
                    {s.count === 0 ? '—' : dailyExceed === 0 ? '0 (OK)' : `${dailyExceed} day${dailyExceed !== 1 ? 's' : ''}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── e. Meteorological Summary ── */}
      <div className="report-section" style={RS.section}>
        <h3 style={RS.sectionTitle}>
          <span style={{ width: 4, height: 14, background: '#F59E0B', borderRadius: 2, flexShrink: 0 }} />
          Meteorological Summary
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Parameter','Unit','N','Mean','Min','Max','Std Dev'].map(h => (
                <th key={h} style={RS.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MET_PARAMS.map((m, i) => {
              const s = calcStats(readings, m.key);
              return (
                <tr key={i} style={{ background: i % 2 === 0 ? '#ffffff' : '#F9FAFB' }}>
                  <td style={{ ...RS.td, fontWeight: 700, fontFamily: 'Instrument Sans, sans-serif' }}>{m.label}</td>
                  <td style={RS.td}>{m.unit}</td>
                  <td style={RS.td}>{s.count || '—'}</td>
                  <td style={RS.td}>{fmtN(s.mean)}</td>
                  <td style={RS.td}>{fmtN(s.min)}</td>
                  <td style={RS.td}>{fmtN(s.max)}</td>
                  <td style={RS.td}>{fmtN(s.sd)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── f. Hourly Averaged Data ── */}
      <HourlyTable hourlyRows={hourlyRows} />

      {/* ── g. Footer ── */}
      <div className="report-section" style={{ ...RS.section, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '3px solid #16A34A' }}>
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, margin: '0 0 3px', color: '#1C1917' }}>Hills and Field Company Limited</p>
          <p style={{ fontSize: 10, color: '#78716C', margin: 0, lineHeight: 1.5 }}>
            Report generated: {fmtDateTime(generatedAt)} &nbsp;·&nbsp; Data source: AirWatch Monitoring Platform<br />
            AQI calculated using US EPA PM2.5 breakpoint formula. Standards per NCEC Royal Decree M/165 (2019).
          </p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 20 }}>
          <p style={{ fontSize: 10, color: '#78716C', margin: 0 }}>Station: {station.name}</p>
          <p style={{ fontSize: 10, color: '#78716C', margin: '2px 0 0' }}>Period: {fmtDate(from)} – {fmtDate(to)}</p>
        </div>
      </div>

    </div>
  );
}

// ── Hourly Averaged Data Table ────────────────────────────────────────────────

function HourlyTable({ hourlyRows }) {
  const [page, setPage]           = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const PER_PAGE = 48;
  const total      = hourlyRows.length;
  const totalPages = Math.ceil(total / PER_PAGE);
  const slice      = hourlyRows.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  return (
    <div className="report-section report-page-break" style={{ ...RS.section, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: collapsed ? 0 : 14 }}>
        <h3 style={{ ...RS.sectionTitle, margin: 0 }}>
          <span style={{ width: 4, height: 14, background: '#8B5CF6', borderRadius: 2, flexShrink: 0 }} />
          Hourly Averaged Data ({total} hours)
        </h3>
        <button
          className="no-print"
          onClick={() => setCollapsed(c => !c)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, border: '1px solid #E7E5E4', background: '#F9FAFB', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#57534E', fontFamily: 'var(--font)' }}
        >
          {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </div>

      {!collapsed && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead>
                <tr>
                  {['Date / Time', 'AQI', 'PM2.5', 'PM10', 'SO₂', 'NO₂', 'O₃', 'CO', 'Temp °C', 'Hum %', 'Wind m/s', 'N'].map(h => (
                    <th key={h} style={{ ...RS.thDark, padding: '8px 10px', fontSize: 10, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slice.map((r, i) => {
                  const aqi = r.aqi;
                  const aqiLvl = aqi != null ? getAqiLevel(aqi) : null;
                  return (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#ffffff' : '#F9FAFB' }}>
                      <td style={{ ...RS.td, padding: '7px 10px', fontSize: 11, color: '#57534E', whiteSpace: 'nowrap' }}>{fmtHour(r.timestamp)}</td>
                      <td style={{ ...RS.td, padding: '7px 10px', fontSize: 11, fontWeight: 700, color: aqiLvl ? aqiLvl.color : '#A8A29E' }}>{aqi ?? '—'}</td>
                      <td style={{ ...RS.td, padding: '7px 10px', fontSize: 11 }}>{r.pm25 != null ? r.pm25.toFixed(1) : '—'}</td>
                      <td style={{ ...RS.td, padding: '7px 10px', fontSize: 11 }}>{r.pm10 != null ? r.pm10.toFixed(1) : '—'}</td>
                      <td style={{ ...RS.td, padding: '7px 10px', fontSize: 11 }}>{r.so2  != null ? r.so2.toFixed(1)  : '—'}</td>
                      <td style={{ ...RS.td, padding: '7px 10px', fontSize: 11 }}>{r.no2  != null ? r.no2.toFixed(1)  : '—'}</td>
                      <td style={{ ...RS.td, padding: '7px 10px', fontSize: 11 }}>{r.o3   != null ? r.o3.toFixed(1)   : '—'}</td>
                      <td style={{ ...RS.td, padding: '7px 10px', fontSize: 11 }}>{r.co   != null ? r.co.toFixed(0)   : '—'}</td>
                      <td style={{ ...RS.td, padding: '7px 10px', fontSize: 11 }}>{r.temperature != null ? r.temperature.toFixed(1) : '—'}</td>
                      <td style={{ ...RS.td, padding: '7px 10px', fontSize: 11 }}>{r.humidity    != null ? r.humidity.toFixed(1)    : '—'}</td>
                      <td style={{ ...RS.td, padding: '7px 10px', fontSize: 11 }}>{r.wind_speed  != null ? r.wind_speed.toFixed(1)  : '—'}</td>
                      <td style={{ ...RS.td, padding: '7px 10px', fontSize: 11, color: '#78716C' }}>{r.count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
              <p style={{ fontSize: 11, color: '#78716C', margin: 0 }}>
                Showing hours {page * PER_PAGE + 1}–{Math.min((page + 1) * PER_PAGE, total)} of {total}
              </p>
              <div style={{ display: 'flex', gap: 6 }}>
                <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                  style={{ padding: '4px 12px', borderRadius: 8, border: '1px solid #E7E5E4', background: page === 0 ? '#F9FAFB' : '#fff', fontSize: 11, cursor: page === 0 ? 'default' : 'pointer', fontFamily: 'var(--font)', color: page === 0 ? '#A8A29E' : '#1C1917' }}>
                  Prev
                </button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  const pg = totalPages <= 7 ? i : Math.max(0, Math.min(page - 3 + i, totalPages - 1));
                  return (
                    <button key={pg} onClick={() => setPage(pg)}
                      style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid', borderColor: page === pg ? '#16A34A' : '#E7E5E4', background: page === pg ? '#F0FDF4' : '#fff', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font)', color: page === pg ? '#16A34A' : '#1C1917', fontWeight: page === pg ? 700 : 400 }}>
                      {pg + 1}
                    </button>
                  );
                })}
                <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
                  style={{ padding: '4px 12px', borderRadius: 8, border: '1px solid #E7E5E4', background: page >= totalPages - 1 ? '#F9FAFB' : '#fff', fontSize: 11, cursor: page >= totalPages - 1 ? 'default' : 'pointer', fontFamily: 'var(--font)', color: page >= totalPages - 1 ? '#A8A29E' : '#1C1917' }}>
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

// ── Main Reports Page ─────────────────────────────────────────────────────────

export default function Reports({ profile }) {
  const today   = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const [stations,      setStations]      = useState([]);
  const [form,          setForm]          = useState({ stationId: '', from: weekAgo, to: today });
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState('');
  const [report,        setReport]        = useState(null);
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
    const to   = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    setForm(f => ({ ...f, from, to }));
  }

  async function generateReport(params = form) {
    if (!params.stationId || !params.from || !params.to) { setError('Please select a station and date range.'); return; }
    if (new Date(params.to) < new Date(params.from))     { setError('"To" date must be after "From" date.'); return; }
    setError('');
    setLoading(true);
    setReport(null);

    try {
      const station = stations.find(s => s.id === params.stationId) || { id: params.stationId, name: params.stationName || 'Unknown' };
      const isDemo  = params.stationId.startsWith('demo-');
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

      {/* ── Generator form (glass) ── */}
      <div className="report-generator" style={{ ...glass({ padding: '24px 28px' }), marginBottom: 20, animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.05s both' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 18px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={16} color="#16A34A" /> Generate New Report
        </h2>

        {/* Quick presets */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#78716C', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quick range:</span>
          {DATE_PRESETS.map(p => (
            <button key={p.days} onClick={() => applyPreset(p.days)} style={{
              padding: '5px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.5)',
              background: 'rgba(255,255,255,0.35)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              color: '#57534E', fontFamily: 'var(--font)', transition: 'background 0.2s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.55)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.35)'}
            >{p.label}</button>
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
              display: 'flex', alignItems: 'center', gap: 8,
              boxShadow: '0 2px 16px rgba(22,163,74,0.3)', fontFamily: 'var(--font)',
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

      {/* ── Inline Report Output ── */}
      {report && (
        <div style={{ animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) both' }}>
          {/* Actions bar (glass, hidden on print) */}
          <div className="no-print" style={{ ...glass({ padding: '12px 20px', marginBottom: 16, borderRadius: 14 }), display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: '#57534E' }}>
              {report.station.name} · {fmtDate(report.from)} – {fmtDate(report.to)} · {report.readings.length} raw readings
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
