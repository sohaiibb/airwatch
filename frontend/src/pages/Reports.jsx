import { useState, useEffect, useRef } from 'react';
import { FileText, Download, Loader2, Clock, Trash2, Printer, Eye } from 'lucide-react';
import * as XLSX from 'xlsx';
import { getStations, getReadingsByDateRange } from '../lib/supabase';
import { glass, glassInner, generateDemoHistory } from '../lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Constants & helpers
// ─────────────────────────────────────────────────────────────────────────────

const TEAL      = '#0d9488';
const TEAL_DARK = '#0f766e';
const TEAL_SOFT = '#f0fdfa';
const TEAL_MID  = '#ccfbf1';

const COLS = [
  { key: 'pm25',          label: 'PM₂.₅',   unit: 'µg/m³', dp: 1 },
  { key: 'pm10',          label: 'PM₁₀',    unit: 'µg/m³', dp: 1 },
  { key: 'so2',           label: 'SO₂',     unit: 'µg/m³', dp: 1 },
  { key: 'no2',           label: 'NO₂',     unit: 'µg/m³', dp: 1 },
  { key: 'o3',            label: 'O₃',      unit: 'µg/m³', dp: 1 },
  { key: 'co',            label: 'CO',      unit: 'µg/m³', dp: 0 },
  { key: 'temperature',   label: 'Temp',    unit: '°C',    dp: 1 },
  { key: 'humidity',      label: 'RH',      unit: '%',     dp: 1 },
  { key: 'wind_speed',    label: 'WS',      unit: 'm/s',   dp: 1 },
  { key: 'wind_direction',label: 'WD',      unit: '°',     dp: 0 },
];

function fmt(v, dp = 1) {
  if (v == null || isNaN(Number(v))) return '—';
  return Number(v).toFixed(dp);
}

function fmtDateShort(s) {
  return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDT(s) {
  return new Date(s).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}
// For the hourly row label: "12 Apr 2026  14:00"
function fmtHourLabel(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}
// For the daily row label: "12 Apr 2026"
function fmtDayLabel(isoStr) {
  return new Date(isoStr).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// ── Hourly aggregation ───────────────────────────────────────────────────────
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
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([iso, recs]) => {
      const row = { timestamp: iso, n: recs.length };
      COLS.forEach(c => {
        const vals = recs.map(r => r[c.key]).filter(v => v != null && !isNaN(Number(v))).map(Number);
        row[c.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      });
      return row;
    });
}

// ── Daily aggregation ────────────────────────────────────────────────────────
function buildDailyRows(readings) {
  const buckets = {};
  readings.forEach(r => {
    const key = r.timestamp.slice(0, 10);
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(r);
  });
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, recs]) => {
      const row = { timestamp: day + 'T00:00:00.000Z', n: recs.length };
      COLS.forEach(c => {
        const vals = recs.map(r => r[c.key]).filter(v => v != null && !isNaN(Number(v))).map(Number);
        row[c.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      });
      return row;
    });
}

// ── Descriptive statistics ────────────────────────────────────────────────────
function stdDev(vals) {
  if (vals.length < 2) return null;
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length);
}
function p98(sorted) {
  if (!sorted.length) return null;
  const idx = Math.ceil(0.98 * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}
function calcStats(readings, key) {
  const vals = readings.map(r => r[key]).filter(v => v != null && !isNaN(Number(v))).map(Number);
  if (!vals.length) return { n: 0, mean: null, min: null, max: null, sd: null, p98: null };
  const sorted = [...vals].sort((a, b) => a - b);
  return {
    n: vals.length,
    mean: vals.reduce((a, b) => a + b, 0) / vals.length,
    min:  sorted[0],
    max:  sorted[sorted.length - 1],
    sd:   stdDev(vals),
    p98:  p98(sorted),
  };
}

// ── Preset ranges ─────────────────────────────────────────────────────────────
const PRESETS = [
  { label: 'Last 1 Hour',   hours: 1 },
  { label: 'Last 6 Hours',  hours: 6 },
  { label: 'Last 24 Hours', hours: 24 },
  { label: 'Last 7 Days',   hours: 168 },
  { label: 'Last 30 Days',  hours: 720 },
];

function toLocalInput(d) {
  // Returns "YYYY-MM-DDTHH:MM" for datetime-local input
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── CSV export ────────────────────────────────────────────────────────────────
function exportCSV(rows, stationName, fromStr, toStr, isDaily) {
  const headers = ['Date/Time', ...COLS.map(c => `${c.label} (${c.unit})`), 'N'];
  const lines   = [headers.join(',')];
  rows.forEach(r => {
    const label = isDaily ? fmtDayLabel(r.timestamp) : fmtHourLabel(r.timestamp);
    const vals  = COLS.map(c => r[c.key] != null ? Number(r[c.key]).toFixed(c.dp) : '');
    lines.push([`"${label}"`, ...vals, r.n].join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `${stationName.replace(/\s+/g,'_')}_${fromStr}_${toStr}.csv`;
  a.click();
}

// ── Excel export ──────────────────────────────────────────────────────────────
function exportExcel(rows, stationName, fromStr, toStr, isDaily) {
  const headers = ['Date/Time', ...COLS.map(c => `${c.label} (${c.unit})`), 'N'];
  const data    = rows.map(r => {
    const label = isDaily ? fmtDayLabel(r.timestamp) : fmtHourLabel(r.timestamp);
    return [label, ...COLS.map(c => r[c.key] != null ? +Number(r[c.key]).toFixed(c.dp) : null), r.n];
  });
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  // Column widths
  ws['!cols'] = [{ wch: 22 }, ...COLS.map(() => ({ wch: 10 })), { wch: 5 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  XLSX.writeFile(wb, `${stationName.replace(/\s+/g,'_')}_${fromStr}_${toStr}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ReportView — clean white, printable
// ─────────────────────────────────────────────────────────────────────────────

function ReportView({ station, fromISO, toISO, readings, generatedAt }) {
  const printStyleRef = useRef(null);

  useEffect(() => {
    const style       = document.createElement('style');
    style.id          = 'airwatch-print-css';
    style.textContent = `
      @media print {
        aside, nav, .report-generator, .no-print { display: none !important; }
        html, body { background: #fff !important; margin: 0; padding: 0; font-size: 9pt; }
        main { margin-left: 0 !important; padding: 0 !important; max-width: 100% !important; }
        #aw-report { max-width: 100% !important; padding: 0 !important; }
        #aw-report * { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; box-shadow: none !important; }
        .pb { page-break-before: always; break-before: page; }
        table { width: 100% !important; border-collapse: collapse; }
        th, td { font-size: 8pt !important; padding: 4px 6px !important; }
        @page { size: A4 landscape; margin: 12mm 10mm; }
      }
    `;
    document.head.appendChild(style);
    printStyleRef.current = style;
    return () => { if (printStyleRef.current) printStyleRef.current.remove(); };
  }, []);

  const spanHours  = (new Date(toISO) - new Date(fromISO)) / 3600000;
  const isDaily    = spanHours > 7 * 24;
  const tableRows  = isDaily ? buildDailyRows(readings) : buildHourlyRows(readings);
  const expected   = isDaily
    ? Math.max(1, Math.round(spanHours / 24))
    : Math.max(1, Math.round(spanHours));
  const capPct     = Math.min(100, Math.round((tableRows.length / expected) * 100));

  const thStyle = {
    padding: '7px 9px',
    background: TEAL,
    color: '#fff',
    fontWeight: 700,
    fontSize: 10,
    textAlign: 'left',
    fontFamily: 'Instrument Sans, sans-serif',
    whiteSpace: 'nowrap',
    borderBottom: `2px solid ${TEAL_DARK}`,
  };
  const tdStyle = (i) => ({
    padding: '5px 9px',
    fontSize: 10,
    fontFamily: 'DM Mono, monospace',
    borderBottom: '1px solid #f0f0f0',
    background: i % 2 === 0 ? '#ffffff' : '#f9fafb',
    color: '#1a1a1a',
  });

  return (
    <div id="aw-report" style={{ fontFamily: 'Instrument Sans, sans-serif', color: '#1C1917', background: '#fff', maxWidth: 1080, margin: '0 auto' }}>

      {/* ── 1. Header ── */}
      <div style={{ padding: '20px 0 14px', marginBottom: 16, borderBottom: `3px solid ${TEAL}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: TEAL, textTransform: 'uppercase', margin: '0 0 4px' }}>
              Hills and Field Company Limited
            </p>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 5px', letterSpacing: '-0.01em', color: '#1C1917' }}>
              Air Quality Monitoring Report
            </h2>
            <p style={{ fontSize: 12, color: '#57534E', margin: '0 0 2px' }}>Station: <strong>{station.name}</strong></p>
            <p style={{ fontSize: 11, color: '#78716C', margin: 0 }}>
              Period: {fmtDT(fromISO)} — {fmtDT(toISO)}
            </p>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 24 }}>
            <p style={{ fontSize: 10, color: '#78716C', margin: '0 0 2px' }}>Generated</p>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#1C1917', margin: 0, fontFamily: 'DM Mono, monospace' }}>
              {fmtDT(generatedAt)}
            </p>
            <p style={{ fontSize: 10, color: '#78716C', margin: '4px 0 0' }}>AirWatch Monitoring Platform</p>
          </div>
        </div>
      </div>

      {/* ── 2. Summary Row ── */}
      <div style={{ display: 'flex', gap: 24, marginBottom: 18, padding: '10px 14px', background: TEAL_SOFT, border: `1px solid ${TEAL_MID}`, borderRadius: 8 }}>
        {[
          { label: 'Data Points',   value: readings.length },
          { label: isDaily ? 'Period (days)' : 'Period (hours)', value: `${tableRows.length} ${isDaily ? 'days' : 'hours'}` },
          { label: 'Data Capture',  value: `${capPct}%` },
          { label: 'Averaging',     value: isDaily ? 'Daily averages' : 'Hourly averages' },
        ].map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#57534E' }}>{s.label}:</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#1C1917', fontFamily: 'DM Mono, monospace' }}>{s.value}</span>
            {i < 3 && <span style={{ color: '#D6D3D1', marginLeft: 10 }}>|</span>}
          </div>
        ))}
      </div>

      {/* ── 3. Data Table ── */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 12, fontWeight: 700, margin: '0 0 10px', color: '#1C1917', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 4, height: 13, background: TEAL, borderRadius: 2, display: 'inline-block' }} />
          {isDaily ? 'Daily Averaged Data' : 'Hourly Averaged Data'}
          <span style={{ fontSize: 10, fontWeight: 400, color: '#78716C' }}>({tableRows.length} {isDaily ? 'days' : 'hours'})</span>
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, minWidth: 140 }}>Date / Time</th>
                {COLS.map(c => (
                  <th key={c.key} style={{ ...thStyle, textAlign: 'right', minWidth: 68 }}>
                    {c.label}<br />
                    <span style={{ fontSize: 8, fontWeight: 400, opacity: 0.85 }}>{c.unit}</span>
                  </th>
                ))}
                <th style={{ ...thStyle, textAlign: 'right', minWidth: 36 }}>N</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.length === 0 ? (
                <tr>
                  <td colSpan={COLS.length + 2} style={{ ...tdStyle(0), textAlign: 'center', padding: '28px', color: '#A8A29E' }}>
                    No data for this period
                  </td>
                </tr>
              ) : tableRows.map((r, i) => (
                <tr key={i}>
                  <td style={{ ...tdStyle(i), fontWeight: 500, whiteSpace: 'nowrap', color: '#374151' }}>
                    {isDaily ? fmtDayLabel(r.timestamp) : fmtHourLabel(r.timestamp)}
                  </td>
                  {COLS.map(c => (
                    <td key={c.key} style={{ ...tdStyle(i), textAlign: 'right' }}>
                      {fmt(r[c.key], c.dp)}
                    </td>
                  ))}
                  <td style={{ ...tdStyle(i), textAlign: 'right', color: '#A8A29E', fontSize: 9 }}>{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 4. Descriptive Statistics ── */}
      <div className="pb" style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 12, fontWeight: 700, margin: '0 0 10px', color: '#1C1917', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 4, height: 13, background: TEAL, borderRadius: 2, display: 'inline-block' }} />
          Descriptive Statistics
          <span style={{ fontSize: 10, fontWeight: 400, color: '#78716C' }}>(based on all raw readings)</span>
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Parameter', 'Unit', 'N', 'Mean', 'Min', 'Max', 'Std Dev', 'P98'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COLS.map((c, i) => {
              const s = calcStats(readings, c.key);
              return (
                <tr key={c.key} style={{ background: i % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                  <td style={{ padding: '7px 9px', fontSize: 11, fontWeight: 700, color: '#1C1917', fontFamily: 'Instrument Sans, sans-serif', borderBottom: '1px solid #f0f0f0' }}>{c.label}</td>
                  <td style={{ padding: '7px 9px', fontSize: 10, color: '#57534E', fontFamily: 'DM Mono, monospace', borderBottom: '1px solid #f0f0f0' }}>{c.unit}</td>
                  <td style={{ padding: '7px 9px', fontSize: 10, fontFamily: 'DM Mono, monospace', borderBottom: '1px solid #f0f0f0', color: '#1C1917' }}>{s.n || '—'}</td>
                  <td style={{ padding: '7px 9px', fontSize: 10, fontFamily: 'DM Mono, monospace', borderBottom: '1px solid #f0f0f0', color: '#1C1917' }}>{fmt(s.mean, c.dp)}</td>
                  <td style={{ padding: '7px 9px', fontSize: 10, fontFamily: 'DM Mono, monospace', borderBottom: '1px solid #f0f0f0', color: '#1C1917' }}>{fmt(s.min, c.dp)}</td>
                  <td style={{ padding: '7px 9px', fontSize: 10, fontFamily: 'DM Mono, monospace', borderBottom: '1px solid #f0f0f0', color: '#1C1917' }}>{fmt(s.max, c.dp)}</td>
                  <td style={{ padding: '7px 9px', fontSize: 10, fontFamily: 'DM Mono, monospace', borderBottom: '1px solid #f0f0f0', color: '#1C1917' }}>{fmt(s.sd, c.dp)}</td>
                  <td style={{ padding: '7px 9px', fontSize: 10, fontFamily: 'DM Mono, monospace', borderBottom: '1px solid #f0f0f0', color: '#1C1917' }}>{fmt(s.p98, c.dp)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── 5. Footer ── */}
      <div style={{ borderTop: `1px solid #e5e7eb`, paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#1C1917', margin: '0 0 2px' }}>Hills and Field Company Limited</p>
          <p style={{ fontSize: 10, color: '#78716C', margin: 0 }}>
            Report generated: {fmtDT(generatedAt)} · Data source: AirWatch Monitoring Platform
          </p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 20 }}>
          <p style={{ fontSize: 10, color: '#57534E', margin: '0 0 1px' }}>Station: <strong>{station.name}</strong></p>
          <p style={{ fontSize: 10, color: '#78716C', margin: 0 }}>Period: {fmtDateShort(fromISO)} – {fmtDateShort(toISO)}</p>
        </div>
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Reports Page
// ─────────────────────────────────────────────────────────────────────────────

export default function Reports({ profile }) {
  const now     = new Date();
  const dayAgo  = new Date(now - 86400000);

  const [stations,      setStations]      = useState([]);
  const [stationId,     setStationId]     = useState('');
  const [fromDT,        setFromDT]        = useState(toLocalInput(dayAgo));
  const [toDT,          setToDT]          = useState(toLocalInput(now));
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState('');
  const [report,        setReport]        = useState(null);
  const [recentReports, setRecentReports] = useState([]);

  useEffect(() => {
    getStations().then(st => {
      if (st.length) {
        setStations(st);
        setStationId(st[0].id);
      } else {
        const demo = [
          { id: 'demo-1', name: 'Al Khobar Central' },
          { id: 'demo-2', name: 'Dammam Industrial' },
          { id: 'demo-3', name: 'Dhahran Tech Valley' },
        ];
        setStations(demo);
        setStationId(demo[0].id);
      }
    });
    try {
      const saved = JSON.parse(localStorage.getItem('aw_reports_v2') || '[]');
      setRecentReports(saved);
    } catch {}
  }, []);

  function applyPreset(hours) {
    const t = new Date();
    const f = new Date(t - hours * 3600000);
    setToDT(toLocalInput(t));
    setFromDT(toLocalInput(f));
  }

  async function loadData() {
    if (!stationId) { setError('Please select a station.'); return null; }
    const fromISO = new Date(fromDT).toISOString();
    const toISO   = new Date(toDT).toISOString();
    if (new Date(toDT) <= new Date(fromDT)) { setError('"To" must be after "From".'); return null; }
    setError('');
    setLoading(true);
    let readings;
    try {
      const isDemo = stationId.startsWith('demo-');
      if (isDemo) {
        const hours = Math.max(1, Math.ceil((new Date(toDT) - new Date(fromDT)) / 3600000));
        readings = generateDemoHistory(Math.min(hours, 720));
      } else {
        readings = await getReadingsByDateRange(stationId, fromISO, toISO);
      }
    } catch (e) {
      console.error(e);
      setError('Failed to load data. Please try again.');
      setLoading(false);
      return null;
    }
    setLoading(false);
    return readings;
  }

  async function handlePreview() {
    const readings = await loadData();
    if (!readings) return;
    const station = stations.find(s => s.id === stationId) || { name: 'Unknown' };
    const r = {
      station,
      fromISO:     new Date(fromDT).toISOString(),
      toISO:       new Date(toDT).toISOString(),
      readings,
      generatedAt: new Date().toISOString(),
    };
    setReport(r);
    saveHistory(station, readings.length);
    setTimeout(() => document.getElementById('aw-report')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  function saveHistory(station, count) {
    const entry   = { id: Date.now(), stationId, stationName: station.name, fromDT, toDT, readingCount: count, generatedAt: new Date().toISOString() };
    const updated = [entry, ...recentReports].slice(0, 8);
    setRecentReports(updated);
    localStorage.setItem('aw_reports_v2', JSON.stringify(updated));
  }

  async function handleCSV() {
    const readings = report?.readings || await loadData();
    if (!readings) return;
    const station  = stations.find(s => s.id === stationId) || { name: 'Unknown' };
    const fromISO  = new Date(fromDT).toISOString();
    const toISO    = new Date(toDT).toISOString();
    const isDaily  = (new Date(toDT) - new Date(fromDT)) / 3600000 > 7 * 24;
    const rows     = isDaily ? buildDailyRows(readings) : buildHourlyRows(readings);
    const fStr     = fromDT.slice(0, 10);
    const tStr     = toDT.slice(0, 10);
    exportCSV(rows, station.name, fStr, tStr, isDaily);
  }

  async function handleExcel() {
    const readings = report?.readings || await loadData();
    if (!readings) return;
    const station = stations.find(s => s.id === stationId) || { name: 'Unknown' };
    const fromISO = new Date(fromDT).toISOString();
    const toISO   = new Date(toDT).toISOString();
    const isDaily = (new Date(toDT) - new Date(fromDT)) / 3600000 > 7 * 24;
    const rows    = isDaily ? buildDailyRows(readings) : buildHourlyRows(readings);
    const fStr    = fromDT.slice(0, 10);
    const tStr    = toDT.slice(0, 10);
    exportExcel(rows, station.name, fStr, tStr, isDaily);
  }

  async function handlePDF() {
    if (!report) { await handlePreview(); }
    setTimeout(() => window.print(), 300);
  }

  // Style helpers
  const inputSt = {
    width: '100%', padding: '8px 11px', borderRadius: 9,
    border: '1px solid rgba(255,255,255,0.5)',
    background: 'rgba(255,255,255,0.35)', backdropFilter: 'blur(8px)',
    fontSize: 12, color: '#1C1917', fontFamily: 'var(--font)', outline: 'none',
  };
  const labelSt = {
    fontSize: 10, fontWeight: 700, color: '#78716C',
    letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5, display: 'block',
  };
  const actionBtn = (primary) => ({
    display: 'flex', alignItems: 'center', gap: 7,
    padding: '9px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
    fontFamily: 'var(--font)', fontSize: 12, fontWeight: 700,
    transition: 'opacity 0.2s',
    ...(primary
      ? { background: `linear-gradient(135deg, ${TEAL}, ${TEAL_DARK})`, color: '#fff', boxShadow: `0 2px 14px ${TEAL}40` }
      : { background: 'rgba(255,255,255,0.45)', color: '#1C1917', border: '1px solid rgba(255,255,255,0.6)' }),
  });

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>

      {/* Page title */}
      <div style={{ marginBottom: 22, animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) both' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 3px', letterSpacing: '-0.02em' }}>Reports</h1>
        <p style={{ color: '#78716C', fontSize: 13, margin: 0 }}>
          Export monitoring data as PDF, CSV, or Excel for archiving and EIA reporting.
        </p>
      </div>

      {/* ── Generator form (glass) ── */}
      <div className="report-generator" style={{ ...glass({ padding: '22px 26px' }), marginBottom: 20, animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.05s both' }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 18px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={15} color={TEAL} /> Export Data
        </h2>

        {/* Presets */}
        <div style={{ display: 'flex', gap: 7, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#A8A29E', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Presets:</span>
          {PRESETS.map(p => (
            <button key={p.hours} onClick={() => applyPreset(p.hours)} style={{
              padding: '4px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.55)',
              background: 'rgba(255,255,255,0.38)', fontSize: 11, fontWeight: 600,
              cursor: 'pointer', color: '#44403C', fontFamily: 'var(--font)',
              transition: 'background 0.15s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.6)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.38)'}
            >{p.label}</button>
          ))}
        </div>

        {/* Station + date-time inputs */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 14, marginBottom: 18 }}>
          <div>
            <label style={labelSt}>Station</label>
            <select value={stationId} onChange={e => setStationId(e.target.value)} style={inputSt}>
              {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelSt}>From (date &amp; time)</label>
            <input type="datetime-local" value={fromDT} max={toDT} onChange={e => setFromDT(e.target.value)} style={inputSt} />
          </div>
          <div>
            <label style={labelSt}>To (date &amp; time)</label>
            <input type="datetime-local" value={toDT} min={fromDT} onChange={e => setToDT(e.target.value)} style={inputSt} />
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={handlePreview} disabled={loading} style={actionBtn(true)}>
            {loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Eye size={14} />}
            {loading ? 'Loading…' : 'Preview Report'}
          </button>

          <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.4)', margin: '0 4px' }} />

          <button onClick={handleCSV} disabled={loading} style={actionBtn(false)}>
            <Download size={13} />CSV
          </button>
          <button onClick={handleExcel} disabled={loading} style={actionBtn(false)}>
            <Download size={13} />Excel
          </button>
          <button onClick={handlePDF} disabled={loading} style={actionBtn(false)}>
            <Printer size={13} />PDF
          </button>
        </div>

        {error && (
          <div style={{ ...glassInner({ padding: '7px 13px', marginTop: 13, background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.2)' }), display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#DC2626' }}>⚠ {error}</span>
          </div>
        )}
      </div>

      {/* ── Recent exports ── */}
      {recentReports.length > 0 && !report && (
        <div style={{ ...glass({ padding: '18px 22px' }), marginBottom: 20, animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.1s both' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
              <Clock size={14} color="#78716C" /> Recent Exports
            </h2>
            <button onClick={() => { setRecentReports([]); localStorage.removeItem('aw_reports_v2'); }}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 7, border: 'none', background: 'rgba(220,38,38,0.07)', color: '#DC2626', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}>
              <Trash2 size={10} /> Clear
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {recentReports.map((r, i) => (
              <div key={r.id} style={{ ...glassInner({ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 10 }), animation: `glassIn 0.4s cubic-bezier(.16,1,.3,1) ${i * 0.04}s both` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <FileText size={14} color={TEAL} />
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>{r.stationName}</p>
                    <p style={{ fontSize: 10, color: '#78716C', margin: '1px 0 0', fontFamily: 'DM Mono, monospace' }}>
                      {r.fromDT?.slice(0, 16).replace('T', ' ')} — {r.toDT?.slice(0, 16).replace('T', ' ')} · {r.readingCount} readings
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setStationId(r.stationId);
                    setFromDT(r.fromDT);
                    setToDT(r.toDT);
                  }}
                  style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${TEAL}40`, background: `${TEAL}0d`, color: TEAL, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Report preview (clean white) ── */}
      {report && (
        <div style={{ animation: 'glassIn 0.4s cubic-bezier(.16,1,.3,1) both' }}>
          {/* Preview toolbar (hidden on print) */}
          <div className="no-print" style={{ ...glass({ padding: '11px 18px', marginBottom: 14, borderRadius: 12 }), display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ fontSize: 12, fontWeight: 600, margin: 0, color: '#57534E' }}>
              Preview — {report.station.name} · {report.readings.length} raw readings
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => { setReport(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                style={{ padding: '7px 14px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#57534E', fontFamily: 'var(--font)' }}
              >
                ← Back
              </button>
              <button onClick={() => handleCSV()} style={{ ...actionBtn(false), padding: '7px 14px' }}>
                <Download size={12} />CSV
              </button>
              <button onClick={() => handleExcel()} style={{ ...actionBtn(false), padding: '7px 14px' }}>
                <Download size={12} />Excel
              </button>
              <button onClick={() => window.print()} style={{ ...actionBtn(true), padding: '7px 16px' }}>
                <Printer size={13} />Save as PDF
              </button>
            </div>
          </div>

          {/* Report — clean white container */}
          <div style={{ background: '#fff', border: '1px solid #E7E5E4', borderRadius: 12, padding: '28px 32px', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>
            <ReportView
              station={report.station}
              fromISO={report.fromISO}
              toISO={report.toISO}
              readings={report.readings}
              generatedAt={report.generatedAt}
            />
          </div>
        </div>
      )}
    </div>
  );
}
