import { useState, useEffect, useRef } from 'react';
import { FileText, Download, Loader2, Clock, Trash2, Printer, Eye } from 'lucide-react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import { applyPlugin } from 'jspdf-autotable';
applyPlugin(jsPDF);
import { supabase, getStations } from '../lib/supabase';
import { glass, glassInner, generateDemoHistory } from '../lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Constants & helpers
// ─────────────────────────────────────────────────────────────────────────────

const TEAL      = '#0d9488';
const TEAL_DARK = '#0f766e';
const TEAL_SOFT = '#f0fdfa';
const TEAL_MID  = '#ccfbf1';

const COLS = [
  { key: 'pm25',          label: 'PM₂.₅',   pdfLabel: 'PM2.5', unit: 'µg/m³', dp: 1 },
  { key: 'pm10',          label: 'PM₁₀',    pdfLabel: 'PM10',  unit: 'µg/m³', dp: 1 },
  { key: 'so2',           label: 'SO₂',     pdfLabel: 'SO2',   unit: 'µg/m³', dp: 1 },
  { key: 'no2',           label: 'NO₂',     pdfLabel: 'NO2',   unit: 'µg/m³', dp: 1 },
  { key: 'o3',            label: 'O₃',      pdfLabel: 'O3',    unit: 'µg/m³', dp: 1 },
  { key: 'co',            label: 'CO',      pdfLabel: 'CO',    unit: 'µg/m³', dp: 0 },
  { key: 'temperature',   label: 'Temp',    pdfLabel: 'Temp',  unit: '°C',    dp: 1 },
  { key: 'humidity',      label: 'RH',      pdfLabel: 'RH',    unit: '%',     dp: 1 },
  { key: 'wind_speed',    label: 'WS',      pdfLabel: 'WS',    unit: 'm/s',   dp: 1 },
  { key: 'wind_direction',label: 'WD',      pdfLabel: 'WD',    unit: '°',     dp: 0 },
];

const PARAM_GROUPS = [
  { label: 'Air Quality',    keys: ['pm25', 'pm10', 'so2', 'no2', 'o3', 'co'] },
  { label: 'Meteorological', keys: ['temperature', 'humidity', 'wind_speed', 'wind_direction'] },
];

const AVG_PERIODS = [
  { id: '1min',  label: '1-Min'  },
  { id: '15min', label: '15-Min' },
  { id: '1hour', label: '1-Hour' },
  { id: '8hour', label: '8-Hour' },
  { id: '24hour', label: '24-Hour' },
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
function fmtHourLabel(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}
function fmtDayLabel(isoStr) {
  return new Date(isoStr).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}
function fmtRowLabel(ts, avgPeriod) {
  return avgPeriod === '24hour' ? fmtDayLabel(ts) : fmtHourLabel(ts);
}

function avgPeriodLabel(period) {
  switch (period) {
    case '1min':  return '1-minute averages';
    case '15min': return '15-minute averages';
    case '8hour': return '8-hour averages';
    case '24hour': return 'Daily averages';
    default:       return 'Hourly averages';
  }
}
function avgPeriodTitle(period) {
  switch (period) {
    case '1min':  return '1-Minute Averaged Data';
    case '15min': return '15-Minute Averaged Data';
    case '8hour': return '8-Hour Averaged Data';
    case '24hour': return 'Daily Averaged Data';
    default:       return 'Hourly Averaged Data';
  }
}
function avgPeriodUnit(period) {
  switch (period) {
    case '1min':  return 'min. intervals';
    case '15min': return '15-min intervals';
    case '8hour': return '8-hr periods';
    case '24hour': return 'days';
    default:       return 'hours';
  }
}
function calcExpected(spanHours, avgPeriod) {
  switch (avgPeriod) {
    case '1min':  return Math.max(1, Math.round(spanHours * 60));
    case '15min': return Math.max(1, Math.round(spanHours * 4));
    case '8hour': return Math.max(1, Math.round(spanHours / 8));
    case '24hour': return Math.max(1, Math.round(spanHours / 24));
    default:       return Math.max(1, Math.round(spanHours));
  }
}

// ── Aggregation ───────────────────────────────────────────────────────────────
function avgBucket(recs) {
  const row = {};
  COLS.forEach(c => {
    const vals = recs.map(r => r[c.key]).filter(v => v != null && !isNaN(Number(v))).map(Number);
    row[c.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });
  return row;
}

function build1MinRows(readings) {
  const buckets = {};
  readings.forEach(r => {
    const d = new Date(r.timestamp);
    d.setSeconds(0, 0);
    const key = d.toISOString();
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(r);
  });
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([iso, recs]) => ({ timestamp: iso, ...avgBucket(recs) }));
}

function build15MinRows(readings) {
  const buckets = {};
  readings.forEach(r => {
    const d = new Date(r.timestamp);
    d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
    const key = d.toISOString();
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(r);
  });
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([iso, recs]) => ({ timestamp: iso, ...avgBucket(recs) }));
}

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
    .map(([iso, recs]) => ({ timestamp: iso, ...avgBucket(recs) }));
}

function build8HourRows(readings) {
  const buckets = {};
  readings.forEach(r => {
    const d = new Date(r.timestamp);
    d.setHours(Math.floor(d.getHours() / 8) * 8, 0, 0, 0);
    const key = d.toISOString();
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(r);
  });
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([iso, recs]) => ({ timestamp: iso, ...avgBucket(recs) }));
}

function buildDailyRows(readings) {
  const buckets = {};
  readings.forEach(r => {
    const key = r.timestamp.slice(0, 10);
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(r);
  });
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, recs]) => ({ timestamp: day + 'T00:00:00.000Z', ...avgBucket(recs) }));
}

function buildRows(readings, avgPeriod) {
  switch (avgPeriod) {
    case '1min':   return build1MinRows(readings);
    case '15min':  return build15MinRows(readings);
    case '8hour':  return build8HourRows(readings);
    case '24hour': return buildDailyRows(readings);
    default:       return buildHourlyRows(readings);
  }
}

// ── Statistical analysis ──────────────────────────────────────────────────────
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
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── CSV export ────────────────────────────────────────────────────────────────
function exportCSV(rows, stationName, fromStr, toStr, activeCols, avgPeriod) {
  const daily   = avgPeriod === '24hour';
  const headers = ['Date/Time', ...activeCols.map(c => `${c.label} (${c.unit})`)];
  const lines   = [headers.join(',')];
  rows.forEach(r => {
    const label = daily ? fmtDayLabel(r.timestamp) : fmtHourLabel(r.timestamp);
    const vals  = activeCols.map(c => r[c.key] != null ? Number(r[c.key]).toFixed(c.dp) : '');
    lines.push([`"${label}"`, ...vals].join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `${stationName.replace(/\s+/g,'_')}_${fromStr}_${toStr}.csv`;
  a.click();
}

// ── Excel export ──────────────────────────────────────────────────────────────
function exportExcel(rows, stationName, fromStr, toStr, activeCols, avgPeriod) {
  const daily   = avgPeriod === '24hour';
  const headers = ['Date/Time', ...activeCols.map(c => `${c.label} (${c.unit})`)];
  const data    = rows.map(r => {
    const label = daily ? fmtDayLabel(r.timestamp) : fmtHourLabel(r.timestamp);
    return [label, ...activeCols.map(c => r[c.key] != null ? +Number(r[c.key]).toFixed(c.dp) : null)];
  });
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = [{ wch: 22 }, ...activeCols.map(() => ({ wch: 10 }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  XLSX.writeFile(wb, `${stationName.replace(/\s+/g,'_')}_${fromStr}_${toStr}.xlsx`);
}

// ── PDF export (jsPDF + autoTable) ───────────────────────────────────────────
function exportPDF(rows, readings, station, fromISO, toISO, generatedAt, activeCols, avgPeriod) {
  const stationName = station.name || 'Unknown';
  const daily     = avgPeriod === '24hour';
  const doc       = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW        = doc.internal.pageSize.getWidth();
  const PH        = doc.internal.pageSize.getHeight();
  const ML = 15, MR = 15, MT = 15;
  const CW        = PW - ML - MR;
  const TEAL_RGB  = [13, 148, 136];
  const GRAY      = [100, 100, 100];
  const BLACK     = [28, 25, 23];

  const fromStr = fromISO.slice(0, 10);
  const toStr   = toISO.slice(0, 10);
  const filename = `AirWatch_${stationName.replace(/\s+/g,'_')}_${fromStr}_${toStr}.pdf`;

  function addFooters() {
    const total = doc.internal.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      const y = PH - 8;
      doc.setFontSize(7);
      doc.setTextColor(...GRAY);
      doc.text('Hills and Field Company Limited', ML, y);
      doc.text(`Page ${i} of ${total}`, PW / 2, y, { align: 'center' });
      doc.text(`Station: ${stationName}  |  Period: ${fromStr} – ${toStr}`, PW - MR, y, { align: 'right' });
    }
  }

  // ── Page 1 header ─────────────────────────────────────────────────────────
  let y = MT;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BLACK);
  doc.text('Air Quality Monitoring Report', ML, y);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAY);
  const genLines = [
    'Generated',
    fmtDT(generatedAt),
    'Hills and Field AirWatch Monitoring Dashboard',
  ];
  genLines.forEach((line, i) => {
    doc.text(line, PW - MR, MT + i * 4, { align: 'right' });
  });

  y += 6;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BLACK);
  doc.text(`Station: ${stationName}`, ML, y);
  y += 5;

  if (station.latitude != null && station.longitude != null) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY);
    doc.text(`Coordinates: ${Number(station.latitude).toFixed(4)}°N, ${Number(station.longitude).toFixed(4)}°E`, ML, y);
    y += 5;
  }

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAY);
  doc.text(`Period: ${fmtDT(fromISO)}  —  ${fmtDT(toISO)}`, ML, y);
  y += 6;

  doc.setDrawColor(...TEAL_RGB);
  doc.setLineWidth(0.6);
  doc.line(ML, y, PW - MR, y);
  y += 5;

  // ── Summary line ──────────────────────────────────────────────────────────
  const spanHours = (new Date(toISO) - new Date(fromISO)) / 3600000;
  const expected  = calcExpected(spanHours, avgPeriod);
  const capPct    = Math.min(100, Math.round((rows.length / expected) * 100));

  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `Data Points: ${readings.length}   |   Period: ${rows.length} ${avgPeriodUnit(avgPeriod)}   |   Data Capture: ${capPct}%   |   Averaging: ${avgPeriodLabel(avgPeriod)}`,
    ML, y
  );
  y += 7;

  // ── Data table ────────────────────────────────────────────────────────────
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BLACK);
  doc.text(avgPeriodTitle(avgPeriod), ML, y);
  y += 4;

  const dateColWidth = daily ? 26 : 38;
  const dataColWidth = Math.max(10, Math.floor((CW - dateColWidth) / activeCols.length));
  const colStylesDyn = { 0: { cellWidth: dateColWidth, halign: 'left' } };
  activeCols.forEach((_, i) => { colStylesDyn[i + 1] = { cellWidth: dataColWidth, halign: 'right' }; });

  const dataHead = [['Date / Time', ...activeCols.map(c => `${c.pdfLabel}\n${c.unit}`)]];
  const dataBody = rows.map(r => [
    fmtRowLabel(r.timestamp, avgPeriod),
    ...activeCols.map(c => r[c.key] != null ? Number(r[c.key]).toFixed(c.dp) : '—'),
  ]);

  doc.autoTable({
    head:      dataHead,
    body:      dataBody,
    startY:    y,
    margin:    { left: ML, right: MR, bottom: 14 },
    tableWidth: CW,
    styles:          { fontSize: 7, cellPadding: 1.8, overflow: 'linebreak', valign: 'middle', textColor: [...BLACK] },
    headStyles:      { fillColor: TEAL_RGB, textColor: [255,255,255], fontStyle: 'bold', fontSize: 7, halign: 'center' },
    columnStyles:    colStylesDyn,
    alternateRowStyles: { fillColor: [240, 253, 250] },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        doc.setFillColor(...TEAL_RGB);
        doc.rect(0, 0, PW, 5, 'F');
      }
    },
  });

  // ── Statistical Analysis table ────────────────────────────────────────────
  const statsY = doc.lastAutoTable.finalY + 10;

  // Per-column stats
  const colStats = activeCols.map(c => {
    const vals = readings.map(r => r[c.key]).filter(v => v != null && !isNaN(Number(v))).map(Number);
    if (!vals.length) return { c, mean: null, min: null, max: null, sd: null, p98v: null };
    const sorted = [...vals].sort((a, b) => a - b);
    const mean   = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd     = vals.length > 1
      ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length)
      : null;
    const p98idx = Math.ceil(0.98 * sorted.length) - 1;
    return { c, mean, min: sorted[0], max: sorted[sorted.length - 1], sd, p98v: sorted[Math.max(0, Math.min(p98idx, sorted.length - 1))] };
  });

  // Rows = statistics, Columns = parameters
  const statsHead = [['Statistic', ...activeCols.map(c => c.pdfLabel)]];
  const statsBody = [
    ['Mean',    ...colStats.map(({ c, mean })  => mean  != null ? mean.toFixed(c.dp)  : '—')],
    ['Min',     ...colStats.map(({ c, min })   => min   != null ? min.toFixed(c.dp)   : '—')],
    ['Max',     ...colStats.map(({ c, max })   => max   != null ? max.toFixed(c.dp)   : '—')],
    ['Std Dev', ...colStats.map(({ c, sd })    => sd    != null ? sd.toFixed(c.dp)    : '—')],
    ['P98',     ...colStats.map(({ c, p98v })  => p98v  != null ? p98v.toFixed(c.dp)  : '—')],
  ];

  const needsNewPage = statsY + 50 > PH - 20;
  if (needsNewPage) doc.addPage();
  const sY = needsNewPage ? MT : statsY;

  // "Statistical Analysis" label — flush against the data table
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...TEAL_RGB);
  doc.text('Statistical Analysis  (based on all raw readings)', ML, sY);

  // Use IDENTICAL column widths as the data table above
  const statsColStyles = { 0: { cellWidth: dateColWidth, fontStyle: 'bold', halign: 'left' } };
  activeCols.forEach((_, i) => { statsColStyles[i + 1] = { cellWidth: dataColWidth, halign: 'right' }; });

  doc.autoTable({
    head:      statsHead,
    body:      statsBody,
    startY:    sY + 3,
    margin:    { left: ML, right: MR, bottom: 14 },
    tableWidth: CW,
    styles:          { fontSize: 7, cellPadding: 1.8, textColor: [...BLACK] },
    headStyles:      { fillColor: TEAL_RGB, textColor: [255,255,255], fontStyle: 'bold', fontSize: 7, halign: 'center' },
    columnStyles:    statsColStyles,
    alternateRowStyles: { fillColor: [240, 253, 250] },
  });

  addFooters();
  doc.save(filename);
}

// ─────────────────────────────────────────────────────────────────────────────
// ReportView — clean white, printable
// ─────────────────────────────────────────────────────────────────────────────

function ReportView({ station, fromISO, toISO, readings, generatedAt, avgPeriod, activeCols }) {
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

  const spanHours = (new Date(toISO) - new Date(fromISO)) / 3600000;
  const tableRows = buildRows(readings, avgPeriod);
  const expected  = calcExpected(spanHours, avgPeriod);
  const capPct    = Math.min(100, Math.round((tableRows.length / expected) * 100));

  const thStyle = {
    padding: '7px 9px',
    background: TEAL,
    color: '#fff',
    fontWeight: 700,
    fontSize: 12,
    textAlign: 'left',
    fontFamily: 'Instrument Sans, sans-serif',
    whiteSpace: 'nowrap',
    borderBottom: `2px solid ${TEAL_DARK}`,
  };
  const tdStyle = (i) => ({
    padding: '5px 9px',
    fontSize: 12,
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
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 5px', letterSpacing: '-0.01em', color: '#1C1917' }}>
              Air Quality Monitoring Report
            </h2>
            <p style={{ fontSize: 12, color: '#57534E', margin: '0 0 2px' }}>Station: <strong>{station.name}</strong></p>
            {station.latitude != null && station.longitude != null && (
              <p style={{ fontSize: 11, color: '#78716C', margin: '0 0 2px' }}>
                Coordinates: {Number(station.latitude).toFixed(4)}°N, {Number(station.longitude).toFixed(4)}°E
              </p>
            )}
            <p style={{ fontSize: 11, color: '#78716C', margin: 0 }}>
              Period: {fmtDT(fromISO)} — {fmtDT(toISO)}
            </p>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 24 }}>
            <p style={{ fontSize: 10, color: '#78716C', margin: '0 0 2px' }}>Generated</p>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#1C1917', margin: 0, fontFamily: 'DM Mono, monospace' }}>
              {fmtDT(generatedAt)}
            </p>
            <p style={{ fontSize: 10, color: '#78716C', margin: '4px 0 0' }}>Hills and Field AirWatch Monitoring Dashboard</p>
          </div>
        </div>
      </div>

      {/* ── 2. Summary Row ── */}
      <div style={{ display: 'flex', gap: 24, marginBottom: 18, padding: '10px 14px', background: TEAL_SOFT, border: `1px solid ${TEAL_MID}`, borderRadius: 8, flexWrap: 'wrap' }}>
        {[
          { label: 'Data Points',   value: readings.length },
          { label: `Period (${avgPeriodUnit(avgPeriod)})`, value: tableRows.length },
          { label: 'Data Capture',  value: `${capPct}%` },
          { label: 'Averaging',     value: avgPeriodLabel(avgPeriod) },
        ].map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#57534E' }}>{s.label}:</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#1C1917', fontFamily: 'DM Mono, monospace' }}>{s.value}</span>
            {i < 3 && <span style={{ color: '#D6D3D1', marginLeft: 10 }}>|</span>}
          </div>
        ))}
      </div>

      {/* ── 3 + 4. Data Table + Statistical Analysis (shared scroll, matched columns) ── */}
      {(() => {
        const statsPerCol = activeCols.map(c => ({ c, s: calcStats(readings, c.key) }));
        const statRows = [
          { label: 'Mean',    fn: ({ c, s }) => fmt(s.mean, c.dp) },
          { label: 'Min',     fn: ({ c, s }) => fmt(s.min,  c.dp) },
          { label: 'Max',     fn: ({ c, s }) => fmt(s.max,  c.dp) },
          { label: 'Std Dev', fn: ({ c, s }) => fmt(s.sd,   c.dp) },
          { label: 'P98',     fn: ({ c, s }) => fmt(s.p98,  c.dp) },
        ];
        // Shared colgroup: first col fixed width, rest equal
        const colGroup = (
          <colgroup>
            <col style={{ width: 140 }} />
            {activeCols.map(c => <col key={c.key} />)}
          </colgroup>
        );
        return (
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 12, fontWeight: 700, margin: '0 0 8px', color: '#1C1917', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 4, height: 13, background: TEAL, borderRadius: 2, display: 'inline-block' }} />
              {avgPeriodTitle(avgPeriod)}
              <span style={{ fontSize: 10, fontWeight: 400, color: '#78716C' }}>({tableRows.length} {avgPeriodUnit(avgPeriod)})</span>
            </h3>

            <div className="pb" style={{ overflowX: 'auto' }}>
              {/* Data rows table */}
              <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', minWidth: 500 }}>
                {colGroup}
                <thead>
                  <tr>
                    <th style={{ ...thStyle, width: 140 }}>Date / Time</th>
                    {activeCols.map(c => (
                      <th key={c.key} style={{ ...thStyle, textAlign: 'right' }}>
                        {c.label}<br />
                        <span style={{ fontSize: 9, fontWeight: 400, opacity: 0.85 }}>{c.unit}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.length === 0 ? (
                    <tr>
                      <td colSpan={activeCols.length + 1} style={{ ...tdStyle(0), textAlign: 'center', padding: '28px', color: '#A8A29E' }}>
                        No data for this period
                      </td>
                    </tr>
                  ) : tableRows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ ...tdStyle(i), fontWeight: 500, whiteSpace: 'nowrap', color: '#374151' }}>
                        {fmtRowLabel(r.timestamp, avgPeriod)}
                      </td>
                      {activeCols.map(c => (
                        <td key={c.key} style={{ ...tdStyle(i), textAlign: 'right' }}>
                          {fmt(r[c.key], c.dp)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Divider label */}
              <div style={{ padding: '5px 9px', background: TEAL_SOFT, borderTop: `2px solid ${TEAL}`, borderBottom: `1px solid ${TEAL_MID}`, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 3, height: 10, background: TEAL, borderRadius: 2, display: 'inline-block' }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#1C1917' }}>Statistical Analysis</span>
                <span style={{ fontSize: 10, color: '#78716C' }}>(based on all raw readings)</span>
              </div>

              {/* Stats table — same colgroup = perfectly aligned columns */}
              <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
                {colGroup}
                <thead>
                  <tr>
                    <th style={{ ...thStyle, width: 140 }}>Statistic</th>
                    {activeCols.map(c => (
                      <th key={c.key} style={{ ...thStyle, textAlign: 'right' }}>
                        {c.label}<br />
                        <span style={{ fontSize: 9, fontWeight: 400, opacity: 0.85 }}>{c.unit}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {statRows.map((row, i) => (
                    <tr key={row.label} style={{ background: i % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                      <td style={{ padding: '7px 9px', fontSize: 12, fontWeight: 700, color: '#1C1917', fontFamily: 'Instrument Sans, sans-serif', borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' }}>{row.label}</td>
                      {statsPerCol.map(({ c, s }) => (
                        <td key={c.key} style={{ padding: '7px 9px', fontSize: 12, fontFamily: 'DM Mono, monospace', borderBottom: '1px solid #f0f0f0', color: '#1C1917', textAlign: 'right' }}>
                          {row.fn({ c, s })}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ── 5. Footer ── */}
      <div style={{ borderTop: `1px solid #e5e7eb`, paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#1C1917', margin: '0 0 2px' }}>Hills and Field Company Limited</p>
          <p style={{ fontSize: 10, color: '#78716C', margin: 0 }}>
            Report generated: {fmtDT(generatedAt)} · Hills and Field AirWatch Monitoring Dashboard
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

  const [stations,        setStations]       = useState([]);
  const [stationId,       setStationId]      = useState('');
  const [fromDT,          setFromDT]         = useState(toLocalInput(dayAgo));
  const [toDT,            setToDT]           = useState(toLocalInput(now));
  const [selectedPreset,  setSelectedPreset] = useState(24);
  const [avgPeriod,       setAvgPeriod]      = useState('1hour');
  const [selectedParams,  setSelectedParams] = useState(new Set(COLS.map(c => c.key)));
  const [loading,         setLoading]        = useState(false);
  const [loadingCount,    setLoadingCount]   = useState(0);
  const [error,           setError]          = useState('');
  const [report,          setReport]         = useState(null);
  const [recentReports,   setRecentReports]  = useState([]);

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
    const t    = new Date();
    const f    = new Date(t - hours * 3600000);
    const tStr = toLocalInput(t);
    const fStr = toLocalInput(f);
    setToDT(tStr);
    setFromDT(fStr);
    setSelectedPreset(hours);
    triggerPreview(fStr, tStr);
  }

  async function loadData(fromDTVal, toDTVal) {
    if (!stationId) { setError('Please select a station.'); return null; }
    const fromISO = new Date(fromDTVal).toISOString();
    const toISO   = new Date(toDTVal).toISOString();
    if (new Date(toDTVal) <= new Date(fromDTVal)) { setError('"To" must be after "From".'); return null; }
    setError('');
    setLoading(true);
    setLoadingCount(0);
    let readings;
    try {
      const isDemo = stationId.startsWith('demo-');
      if (isDemo) {
        const hours = Math.max(1, Math.ceil((new Date(toDTVal) - new Date(fromDTVal)) / 3600000));
        readings = generateDemoHistory(Math.min(hours, 720));
      } else {
        // Chunked fetch — PostgREST caps at 1,000 rows per request.
        // Loop with .range() until we get fewer than CHUNK rows (means we're done).
        const CHUNK = 1000;
        let all = [], offset = 0;
        while (true) {
          const { data, error: fetchErr } = await supabase
            .from('readings')
            .select('*')
            .eq('station_id', stationId)
            .gte('timestamp', fromISO)
            .lte('timestamp', toISO)
            .order('timestamp', { ascending: true })
            .range(offset, offset + CHUNK - 1);
          if (fetchErr) throw new Error(fetchErr.message);
          if (!data || data.length === 0) break;
          all = all.concat(data);
          setLoadingCount(all.length);
          if (data.length < CHUNK) break;
          offset += CHUNK;
        }
        readings = all;
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

  async function triggerPreview(fromDTVal, toDTVal) {
    const readings = await loadData(fromDTVal, toDTVal);
    if (!readings) return;
    const station = stations.find(s => s.id === stationId) || { name: 'Unknown' };
    const r = {
      station,
      fromISO:      new Date(fromDTVal).toISOString(),
      toISO:        new Date(toDTVal).toISOString(),
      readings,
      generatedAt:  new Date().toISOString(),
      avgPeriod,
      selectedParams: [...selectedParams],
    };
    setReport(r);
    saveHistory(station, readings.length);
    setTimeout(() => document.getElementById('aw-report')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  async function handlePreview() {
    await triggerPreview(fromDT, toDT);
  }

  function saveHistory(station, count) {
    const entry   = { id: Date.now(), stationId, stationName: station.name, fromDT, toDT, readingCount: count, generatedAt: new Date().toISOString() };
    const updated = [entry, ...recentReports].slice(0, 8);
    setRecentReports(updated);
    localStorage.setItem('aw_reports_v2', JSON.stringify(updated));
  }

  function getExportContext() {
    const curAvgPeriod = report?.avgPeriod || avgPeriod;
    const curParams    = report ? new Set(report.selectedParams) : selectedParams;
    const activeCols   = COLS.filter(c => curParams.has(c.key));
    return { curAvgPeriod, activeCols };
  }

  async function handleCSV() {
    const readings = report?.readings || await loadData(fromDT, toDT);
    if (!readings) return;
    const station  = stations.find(s => s.id === stationId) || { name: 'Unknown' };
    const { curAvgPeriod, activeCols } = getExportContext();
    const rows = buildRows(readings, curAvgPeriod);
    exportCSV(rows, station.name, fromDT.slice(0, 10), toDT.slice(0, 10), activeCols, curAvgPeriod);
  }

  async function handleExcel() {
    const readings = report?.readings || await loadData(fromDT, toDT);
    if (!readings) return;
    const station  = stations.find(s => s.id === stationId) || { name: 'Unknown' };
    const { curAvgPeriod, activeCols } = getExportContext();
    const rows = buildRows(readings, curAvgPeriod);
    exportExcel(rows, station.name, fromDT.slice(0, 10), toDT.slice(0, 10), activeCols, curAvgPeriod);
  }

  async function handlePDF() {
    const readings = report?.readings || await loadData(fromDT, toDT);
    if (!readings) return;
    const station  = stations.find(s => s.id === stationId) || { name: 'Unknown' };
    const fromISO  = new Date(fromDT).toISOString();
    const toISO    = new Date(toDT).toISOString();
    const { curAvgPeriod, activeCols } = getExportContext();
    const rows  = buildRows(readings, curAvgPeriod);
    const genAt = report?.generatedAt || new Date().toISOString();
    try {
      exportPDF(rows, readings, station, fromISO, toISO, genAt, activeCols, curAvgPeriod);
    } catch (err) {
      console.error('PDF generation failed:', err);
      setError('PDF generation failed: ' + (err?.message || String(err)));
    }
  }

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
  const pillBtn = (active) => ({
    padding: '4px 12px', borderRadius: 7,
    border: active ? `1px solid ${TEAL}` : '1px solid rgba(255,255,255,0.55)',
    background: active ? TEAL : 'rgba(255,255,255,0.38)',
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
    color: active ? '#fff' : '#44403C',
    fontFamily: 'var(--font)', transition: 'all 0.15s',
  });

  const reportActiveCols = report
    ? COLS.filter(c => new Set(report.selectedParams).has(c.key))
    : COLS.filter(c => selectedParams.has(c.key));

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
        <div style={{ display: 'flex', gap: 7, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#A8A29E', textTransform: 'uppercase', letterSpacing: '0.07em', minWidth: 56 }}>Presets:</span>
          {PRESETS.map(p => {
            const isActive = selectedPreset === p.hours;
            return (
              <button key={p.hours} onClick={() => applyPreset(p.hours)}
                style={pillBtn(isActive)}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.6)'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.38)'; }}
              >{p.label}</button>
            );
          })}
        </div>

        {/* Averaging period */}
        <div style={{ display: 'flex', gap: 7, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#A8A29E', textTransform: 'uppercase', letterSpacing: '0.07em', minWidth: 56 }}>Averaging:</span>
          {AVG_PERIODS.map(p => {
            const isActive = avgPeriod === p.id;
            return (
              <button key={p.id} onClick={() => setAvgPeriod(p.id)}
                style={pillBtn(isActive)}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.6)'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.38)'; }}
              >{p.label}</button>
            );
          })}
        </div>

        {/* Parameter selector */}
        <div style={{ marginBottom: 16, padding: '12px 14px', background: 'rgba(255,255,255,0.28)', border: '1px solid rgba(255,255,255,0.48)', borderRadius: 10 }}>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#A8A29E', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Parameters:</span>
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {PARAM_GROUPS.map(group => (
              <div key={group.label} style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#57534E' }}>{group.label}</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => setSelectedParams(prev => new Set([...prev, ...group.keys]))}
                      style={{ fontSize: 10, color: TEAL, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--font)', fontWeight: 600 }}
                    >Select All</button>
                    <span style={{ color: '#D6D3D1', fontSize: 10 }}>·</span>
                    <button
                      onClick={() => setSelectedParams(prev => { const next = new Set(prev); group.keys.forEach(k => next.delete(k)); return next; })}
                      style={{ fontSize: 10, color: '#78716C', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--font)', fontWeight: 600 }}
                    >Deselect All</button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px' }}>
                  {group.keys.map(key => {
                    const col     = COLS.find(c => c.key === key);
                    const checked = selectedParams.has(key);
                    return (
                      <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11, color: '#44403C', fontFamily: 'var(--font)', userSelect: 'none' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => {
                            setSelectedParams(prev => {
                              const next = new Set(prev);
                              e.target.checked ? next.add(key) : next.delete(key);
                              return next;
                            });
                          }}
                          style={{ accentColor: TEAL, cursor: 'pointer', width: 13, height: 13 }}
                        />
                        {col?.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
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
            <input type="datetime-local" value={fromDT} max={toDT}
              onChange={e => { setFromDT(e.target.value); setSelectedPreset(null); }}
              style={inputSt} />
          </div>
          <div>
            <label style={labelSt}>To (date &amp; time)</label>
            <input type="datetime-local" value={toDT} min={fromDT}
              onChange={e => { setToDT(e.target.value); setSelectedPreset(null); }}
              style={inputSt} />
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={handlePreview} disabled={loading} style={actionBtn(true)}>
            {loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Eye size={14} />}
            {loading ? `Loading… ${loadingCount > 0 ? loadingCount.toLocaleString() + ' rows' : ''}` : 'Preview Report'}
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
                    setSelectedPreset(null);
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
              <button onClick={handlePDF} style={{ ...actionBtn(true), padding: '7px 16px' }}>
                <Printer size={13} />Download PDF
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
              avgPeriod={report.avgPeriod}
              activeCols={reportActiveCols}
            />
          </div>
        </div>
      )}
    </div>
  );
}
