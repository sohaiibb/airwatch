import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
  ComposedChart, Scatter, Line as RLine,
} from 'recharts';
import {
  Activity, AlertTriangle, TrendingUp, TrendingDown, Download,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Search, GitBranch,
} from 'lucide-react';
import { getStations, getDemoStations, getDemoHistory, getDemoDaily, getDemoReadings, getReadingsHistory } from '../lib/supabase';
import { glass, glassInner, getAqiLevel, POLLUTANTS, NCEC_STANDARDS, formatTime, formatDate } from '../lib/utils';

const PAGE_SIZE = 20;

// ─── Threshold colour for a cell value ───
const CELL_THRESHOLDS = {
  pm25: { yellow: 35,  red: 55 },
  pm10: { yellow: 250, red: 340 },
  so2:  { red: 441 },
  no2:  { red: 200 },
  o3:   { red: 157 },
  co:   { red: 40000 },
};
function cellColor(key, value) {
  if (value == null) return 'var(--text-muted)';
  const t = CELL_THRESHOLDS[key];
  if (!t) return 'var(--text)';
  if (value >= t.red)                       return '#DC2626';
  if (t.yellow != null && value >= t.yellow) return '#CA8A04';
  return '#16A34A';
}
function cellBg(key, value) {
  const c = cellColor(key, value);
  if (c === '#DC2626') return 'rgba(220,38,38,0.07)';
  if (c === '#CA8A04') return 'rgba(202,138,4,0.07)';
  return 'transparent';
}

// ─── Aggregation ───
function aggregate(rows, mode) {
  if (mode === 'raw') return rows;
  const bucketKey = ts => {
    const d = new Date(ts);
    if (mode === '1min')   return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
    if (mode === 'hourly') return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
    if (mode === '24h')    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  const groups = {};
  rows.forEach(r => {
    const k = bucketKey(r.timestamp);
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });
  const KEYS = [...POLLUTANTS.map(p => p.key), 'aqi', 'temperature', 'humidity', 'wind_speed', 'wind_direction'];
  return Object.values(groups).map(grp => {
    const result = { timestamp: grp[0].timestamp, count: grp.length };
    KEYS.forEach(key => {
      const vals = grp.map(r => r[key]).filter(v => v != null && !isNaN(Number(v))).map(Number);
      result[key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
    return result;
  });
}

// ─── Full timestamp formatter (table) ───
function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

// ─── Glass Tooltip ───
const GlassTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ ...glass({ borderRadius: 10, padding: '8px 12px' }), boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
      <p style={{ color: 'var(--text-muted)', fontSize: 10, margin: 0, marginBottom: 4, fontFamily: 'var(--font-mono)' }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color || p.stroke, fontSize: 12, margin: '1px 0', fontWeight: 600 }}>
          {p.name}: <span style={{ fontFamily: 'var(--font-mono)' }}>{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}</span>
        </p>
      ))}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Canvas / SVG Export Engine ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// Nice round axis ticks
function computeAxisTicks(min, max, count = 8) {
  const range = max - min;
  if (range <= 0) return [min || 0, 1];
  const rawStep = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = norm < 1.5 ? mag : norm < 3.5 ? 2 * mag : norm < 7.5 ? 5 * mag : 10 * mag;
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let t = start; t <= max + step * 0.01; t = parseFloat((t + step).toFixed(10))) {
    ticks.push(t);
    if (ticks.length > 20) break;
  }
  if (!ticks.length) ticks.push(0);
  return ticks;
}

// X-axis tick label based on time range
function fmtXTick(ts, rangeHours) {
  const d = new Date(ts);
  const mo = d.toLocaleString('en', { month: 'short' });
  if (rangeHours <= 48)
    return `${d.getDate()} ${mo} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  return `${d.getDate()} ${mo}`;
}

// Short date for subtitle / footer
function fmtPubDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Date+time subtitle range
function fmtSubtitleRange(fromTs, toTs) {
  const f = ts => {
    if (!ts) return '—';
    const d = new Date(ts);
    const mo = d.toLocaleString('en', { month: 'short' });
    return `${d.getDate()} ${mo} ${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };
  return `${f(fromTs)} — ${f(toTs)}`;
}

// Filename builder  — AirWatch_PM25_12Apr2026_13Apr2026.ext
function buildFilename(tag, fromTs, toTs, ext) {
  const fmt = ts => {
    if (!ts) return 'na';
    const d = new Date(ts);
    return `${String(d.getDate()).padStart(2,'0')}${d.toLocaleString('en',{month:'short'})}${d.getFullYear()}`;
  };
  return `AirWatch_${tag}_${fmt(fromTs)}_${fmt(toTs)}.${ext}`;
}

// XML escaping for SVG text
function escXML(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Tick label formatter (for y axis)
function fmtTick(v) {
  if (v >= 10000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'k';
  if (v % 1 === 0) return String(v);
  return v.toFixed(1);
}

// ─── Constants shared across draw functions ───
const EXP_W = 2400, EXP_H = 1400;
const PL = 155, PR = 2330, PT = 148, PB = 1215;
const PW = PR - PL, PH = PB - PT;

// ─── Common canvas setup: background + title + grid + axes helper ───
function _canvasBase(ctx, { title, subtitle }) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, EXP_W, EXP_H);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 36px Arial';
  ctx.fillText(title, EXP_W / 2, 58);

  ctx.fillStyle = '#666666';
  ctx.font = '22px Arial';
  ctx.fillText(subtitle, EXP_W / 2, 100);
}

function _drawHGrid(ctx, yTicks, toY) {
  yTicks.forEach(t => {
    const y = toY(t);
    ctx.save();
    ctx.strokeStyle = '#e0e0e0'; ctx.lineWidth = 1; ctx.setLineDash([5,5]);
    ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(PR, y); ctx.stroke();
    ctx.restore();
  });
}

function _drawVGrid(ctx, xIdxs, toX) {
  xIdxs.forEach(i => {
    const x = toX(i);
    ctx.save();
    ctx.strokeStyle = '#e0e0e0'; ctx.lineWidth = 1; ctx.setLineDash([5,5]);
    ctx.beginPath(); ctx.moveTo(x, PT); ctx.lineTo(x, PB); ctx.stroke();
    ctx.restore();
  });
}

function _drawPlotBorder(ctx) {
  ctx.strokeStyle = '#cccccc'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
  ctx.strokeRect(PL, PT, PW, PH);
}

function _drawYAxis(ctx, yTicks, toY, yLabel) {
  // Tick numbers
  ctx.fillStyle = '#333333'; ctx.font = '16px Arial'; ctx.textAlign = 'right';
  yTicks.forEach(t => ctx.fillText(fmtTick(t), PL - 10, toY(t) + 5));
  // Rotated label
  ctx.save();
  ctx.translate(32, PT + PH / 2); ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center'; ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 20px Arial';
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
}

function _drawXAxis(ctx, data, xIdxs, toX, rangeHours) {
  ctx.fillStyle = '#333333'; ctx.font = '15px Arial';
  xIdxs.forEach(i => {
    if (!data[i]) return;
    const x = toX(i);
    const label = fmtXTick(data[i].timestamp, rangeHours);
    ctx.save();
    ctx.translate(x, PB + 18); ctx.rotate(-Math.PI / 4);
    ctx.textAlign = 'right'; ctx.fillText(label, 0, 0);
    ctx.restore();
  });
  ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 20px Arial'; ctx.textAlign = 'center';
  ctx.fillText('Date & Time', PL + PW / 2, PB + 105);
}

function _drawFooter(ctx, fromTs, toTs) {
  const fY = EXP_H - 22;
  ctx.fillStyle = '#999999'; ctx.font = '14px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('Hills and Field AirWatch Monitoring Dashboard', PL, fY);
  ctx.textAlign = 'right';
  ctx.fillText(`Period: ${fmtPubDate(fromTs)} — ${fmtPubDate(toTs)}`, PR, fY);
}

function _getXIdxs(n) {
  const maxTicks = 14;
  const step = Math.max(1, Math.round(n / maxTicks));
  const idxs = [];
  for (let i = 0; i < n; i += step) idxs.push(i);
  if (idxs.length && idxs[idxs.length - 1] !== n - 1) idxs.push(n - 1);
  return idxs;
}

// ─── Draw single-pollutant chart onto ctx ───
function drawExportChart(ctx, opts) {
  const { title, subtitle, dataKey, color, unit, data, showNcec, ncecLimit, ncecLabel } = opts;
  _canvasBase(ctx, { title, subtitle });

  const vals = data.map(d => d[dataKey]).filter(v => v != null && !isNaN(v)).map(Number);
  const dataMax = vals.length ? Math.max(...vals) : 10;
  const yDomain = Math.max(dataMax, showNcec && ncecLimit ? ncecLimit : 0) * 1.2 || 10;
  const yTicks = computeAxisTicks(0, yDomain, 8);
  const yMax = yTicks[yTicks.length - 1];

  const toY = v => PT + PH - (v / yMax) * PH;
  const toX = i => PL + (data.length > 1 ? (i / (data.length - 1)) * PW : PW / 2);
  const rangeMs = data.length > 1 ? new Date(data[data.length-1].timestamp) - new Date(data[0].timestamp) : 86400000;
  const rangeHours = rangeMs / 3600000;
  const xIdxs = _getXIdxs(data.length);

  _drawHGrid(ctx, yTicks, toY);
  _drawVGrid(ctx, xIdxs, toX);

  // NCEC shaded area (above line = exceedance zone)
  if (showNcec && ncecLimit != null && ncecLimit <= yMax) {
    const ny = toY(ncecLimit);
    ctx.fillStyle = 'rgba(239,68,68,0.07)';
    ctx.fillRect(PL, PT, PW, Math.max(0, ny - PT));
  }

  // Data line (clipped)
  if (vals.length >= 2) {
    ctx.save();
    ctx.beginPath(); ctx.rect(PL, PT, PW, PH); ctx.clip();
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.setLineDash([]);
    ctx.beginPath();
    let first = true;
    data.forEach((d, i) => {
      const v = d[dataKey];
      if (v == null || isNaN(v)) { first = true; return; }
      const x = toX(i), y = toY(Number(v));
      first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      first = false;
    });
    ctx.stroke();
    if (vals.length < 50) {
      ctx.fillStyle = color;
      data.forEach((d, i) => {
        const v = d[dataKey]; if (v == null || isNaN(v)) return;
        ctx.beginPath(); ctx.arc(toX(i), toY(Number(v)), 5, 0, Math.PI * 2); ctx.fill();
      });
    }
    ctx.restore();
  }

  // NCEC dashed line + label
  if (showNcec && ncecLimit != null && ncecLimit <= yMax) {
    const ny = toY(ncecLimit);
    ctx.save();
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2; ctx.setLineDash([10, 6]);
    ctx.beginPath(); ctx.moveTo(PL, ny); ctx.lineTo(PR, ny); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#ef4444'; ctx.font = '15px Arial'; ctx.textAlign = 'left';
    ctx.fillText(ncecLabel || '', PR + 8, ny + 5);
  }

  _drawPlotBorder(ctx);
  _drawYAxis(ctx, yTicks, toY, `Concentration (${unit})`);
  _drawXAxis(ctx, data, xIdxs, toX, rangeHours);

  // Legend
  const legendY = PB + 150;
  const legendItems = [
    { label: `${title.replace(' Concentration', '')} Measured`, color, dashed: false },
    ...(showNcec && ncecLimit != null ? [{ label: 'NCEC Standard', color: '#ef4444', dashed: true }] : []),
  ];
  const iW = 240;
  let lx = EXP_W / 2 - (legendItems.length * iW) / 2;
  legendItems.forEach(item => {
    ctx.save();
    ctx.strokeStyle = item.color; ctx.lineWidth = 2.5;
    ctx.setLineDash(item.dashed ? [8,5] : []);
    ctx.beginPath(); ctx.moveTo(lx, legendY); ctx.lineTo(lx + 32, legendY); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#333333'; ctx.font = '16px Arial'; ctx.textAlign = 'left';
    ctx.fillText(item.label, lx + 40, legendY + 5);
    lx += iW;
  });

  _drawFooter(ctx, data[0]?.timestamp, data[data.length-1]?.timestamp);
}

// ─── Draw multi-pollutant overlay chart onto ctx ───
function drawOverlayChart(ctx, opts) {
  const { title, subtitle, activePollutants, data } = opts;
  _canvasBase(ctx, { title, subtitle });

  let allMax = 0;
  activePollutants.forEach(p => data.forEach(d => {
    const v = d[p.key]; if (v != null && !isNaN(v)) allMax = Math.max(allMax, Number(v));
  }));
  const yTicks = computeAxisTicks(0, allMax * 1.2 || 10, 8);
  const yMax = yTicks[yTicks.length - 1];
  const toY = v => PT + PH - (v / yMax) * PH;
  const toX = i => PL + (data.length > 1 ? (i / (data.length - 1)) * PW : PW / 2);
  const rangeMs = data.length > 1 ? new Date(data[data.length-1].timestamp) - new Date(data[0].timestamp) : 86400000;
  const rangeHours = rangeMs / 3600000;
  const xIdxs = _getXIdxs(data.length);

  _drawHGrid(ctx, yTicks, toY);
  _drawVGrid(ctx, xIdxs, toX);

  // Data lines (clipped)
  ctx.save();
  ctx.beginPath(); ctx.rect(PL, PT, PW, PH); ctx.clip();
  activePollutants.forEach(p => {
    ctx.strokeStyle = p.color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.setLineDash([]);
    ctx.beginPath();
    let first = true;
    data.forEach((d, i) => {
      const v = d[p.key]; if (v == null || isNaN(v)) { first = true; return; }
      const x = toX(i), y = toY(Number(v));
      first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      first = false;
    });
    ctx.stroke();
  });
  ctx.restore();

  _drawPlotBorder(ctx);
  _drawYAxis(ctx, yTicks, toY, 'Concentration (µg/m³)');
  _drawXAxis(ctx, data, xIdxs, toX, rangeHours);

  // Legend
  const legendY = PB + 150;
  const iW = 190;
  let lx = EXP_W / 2 - (activePollutants.length * iW) / 2;
  activePollutants.forEach(p => {
    ctx.save();
    ctx.strokeStyle = p.color; ctx.lineWidth = 2.5; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(lx, legendY); ctx.lineTo(lx + 32, legendY); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#333333'; ctx.font = '16px Arial'; ctx.textAlign = 'left';
    ctx.fillText(p.name, lx + 40, legendY + 5);
    lx += iW;
  });

  _drawFooter(ctx, data[0]?.timestamp, data[data.length-1]?.timestamp);
}

// ─── Draw correlation scatter chart onto ctx ───
function drawCorrChart(ctx, opts) {
  const { title, subtitle, xParam, yParam, points, trendData, rValue } = opts;
  _canvasBase(ctx, { title, subtitle });

  if (!points.length) { return; }

  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xPad = (xMax - xMin) * 0.08 || 1, yPad = (yMax - yMin) * 0.08 || 1;
  const xDom = [xMin - xPad, xMax + xPad];
  const yDom = [yMin - yPad, yMax + yPad];

  const toX = v => PL + ((v - xDom[0]) / (xDom[1] - xDom[0])) * PW;
  const toY = v => PT + PH - ((v - yDom[0]) / (yDom[1] - yDom[0])) * PH;

  const xTicks = computeAxisTicks(xDom[0], xDom[1], 8);
  const yTicks = computeAxisTicks(yDom[0], yDom[1], 8);

  // Grid
  yTicks.filter(t => t >= yDom[0] && t <= yDom[1]).forEach(t => {
    const y = toY(t);
    ctx.save(); ctx.strokeStyle = '#e0e0e0'; ctx.lineWidth = 1; ctx.setLineDash([5,5]);
    ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(PR, y); ctx.stroke(); ctx.restore();
  });
  xTicks.filter(t => t >= xDom[0] && t <= xDom[1]).forEach(t => {
    const x = toX(t);
    ctx.save(); ctx.strokeStyle = '#e0e0e0'; ctx.lineWidth = 1; ctx.setLineDash([5,5]);
    ctx.beginPath(); ctx.moveTo(x, PT); ctx.lineTo(x, PB); ctx.stroke(); ctx.restore();
  });

  // Scatter points (clipped)
  ctx.save();
  ctx.beginPath(); ctx.rect(PL, PT, PW, PH); ctx.clip();
  points.forEach(p => {
    const c = p.aqi == null ? '#94a3b8' : p.aqi <= 50 ? '#16A34A' : p.aqi <= 100 ? '#CA8A04' : p.aqi <= 150 ? '#EA580C' : p.aqi <= 200 ? '#DC2626' : '#7C3AED';
    ctx.fillStyle = c + 'cc';
    ctx.beginPath(); ctx.arc(toX(p.x), toY(p.y), 5, 0, Math.PI * 2); ctx.fill();
  });
  // Trend line
  if (trendData.length === 2) {
    ctx.strokeStyle = '#0d9488'; ctx.lineWidth = 2; ctx.setLineDash([8,5]);
    ctx.beginPath();
    ctx.moveTo(toX(trendData[0].x), toY(trendData[0].y));
    ctx.lineTo(toX(trendData[1].x), toY(trendData[1].y));
    ctx.stroke();
  }
  ctx.restore();

  _drawPlotBorder(ctx);

  // Y tick labels
  ctx.fillStyle = '#333333'; ctx.font = '16px Arial'; ctx.textAlign = 'right';
  yTicks.filter(t => t >= yDom[0] && t <= yDom[1]).forEach(t => ctx.fillText(fmtTick(t), PL - 10, toY(t) + 5));

  // Y-axis label
  ctx.save();
  ctx.translate(32, PT + PH / 2); ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center'; ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 20px Arial';
  ctx.fillText(`${yParam.name} (${yParam.unit})`, 0, 0);
  ctx.restore();

  // X tick labels
  ctx.fillStyle = '#333333'; ctx.font = '15px Arial';
  xTicks.filter(t => t >= xDom[0] && t <= xDom[1]).forEach(t => {
    const x = toX(t);
    ctx.save();
    ctx.translate(x, PB + 18); ctx.rotate(-Math.PI / 4); ctx.textAlign = 'right';
    ctx.fillText(fmtTick(t), 0, 0);
    ctx.restore();
  });

  // X-axis label
  ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 20px Arial'; ctx.textAlign = 'center';
  ctx.fillText(`${xParam.name} (${xParam.unit})`, PL + PW / 2, PB + 105);

  // AQI legend
  const legendY = PB + 148;
  const aqiItems = [
    ['#16A34A','Good (0–50)'], ['#CA8A04','Moderate (51–100)'], ['#EA580C','Sensitive (101–150)'],
    ['#DC2626','Unhealthy (151–200)'], ['#7C3AED','Very Unhealthy (>200)'], ['#94a3b8','Unknown'],
  ];
  const iW = 280;
  let lx = EXP_W / 2 - (aqiItems.length * iW) / 2;
  ctx.font = '15px Arial';
  aqiItems.forEach(([c, l]) => {
    ctx.fillStyle = c + 'cc';
    ctx.beginPath(); ctx.arc(lx + 8, legendY, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#333333'; ctx.textAlign = 'left';
    ctx.fillText(l, lx + 22, legendY + 5);
    lx += iW;
  });

  // Footer
  const fY = EXP_H - 22;
  ctx.fillStyle = '#999999'; ctx.font = '14px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('Hills and Field AirWatch Monitoring Dashboard', PL, fY);
  ctx.textAlign = 'right';
  ctx.fillText(`Generated: ${new Date().toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}`, PR, fY);
}

// ─── Build canvas from options ───
function buildCanvas(opts) {
  const canvas = document.createElement('canvas');
  canvas.width = EXP_W; canvas.height = EXP_H;
  const ctx = canvas.getContext('2d');
  if (opts.type === 'overlay') drawOverlayChart(ctx, opts);
  else if (opts.type === 'corr') drawCorrChart(ctx, opts);
  else drawExportChart(ctx, opts);
  return canvas;
}

// ─── PNG export ───
async function doExportPNG(opts, filename) {
  const canvas = buildCanvas(opts);
  const a = document.createElement('a');
  a.download = filename;
  a.href = canvas.toDataURL('image/png');
  a.click();
}

// ─── PDF export (jsPDF, landscape, actual pixel size) ───
async function doExportPDF(opts, filename) {
  const canvas = buildCanvas(opts);
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [EXP_W, EXP_H] });
  pdf.setProperties({ title: opts.title || 'AirWatch', author: 'Hills and Field' });
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, EXP_W, EXP_H);
  pdf.save(filename);
}

// ─── SVG export — builds a true vector SVG from data ───
function doExportSVG(opts, filename) {
  const svgStr = buildSVGString(opts);
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.download = filename;
  a.href = url;
  a.click();
  URL.revokeObjectURL(url);
}

function buildSVGString(opts) {
  if (opts.type === 'overlay') return buildOverlaySVG(opts);
  if (opts.type === 'corr') return buildCorrSVG(opts);
  return buildSingleSVG(opts);
}

function _svgHeader(title, subtitle) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${EXP_W}" height="${EXP_H}" viewBox="0 0 ${EXP_W} ${EXP_H}">`,
    `<style>text{font-family:Arial,sans-serif;}</style>`,
    `<rect width="${EXP_W}" height="${EXP_H}" fill="#ffffff"/>`,
    `<text x="${EXP_W/2}" y="58" text-anchor="middle" font-size="36" font-weight="bold" fill="#1a1a1a">${escXML(title)}</text>`,
    `<text x="${EXP_W/2}" y="100" text-anchor="middle" font-size="22" fill="#666666">${escXML(subtitle)}</text>`,
  ].join('\n');
}

function _svgGrid(yTicks, toY, xIdxs, toX) {
  const lines = [];
  yTicks.forEach(t => {
    const y = toY(t).toFixed(1);
    lines.push(`<line x1="${PL}" y1="${y}" x2="${PR}" y2="${y}" stroke="#e0e0e0" stroke-width="1" stroke-dasharray="5,5"/>`);
  });
  xIdxs.forEach(i => {
    const x = toX(i).toFixed(1);
    lines.push(`<line x1="${x}" y1="${PT}" x2="${x}" y2="${PB}" stroke="#e0e0e0" stroke-width="1" stroke-dasharray="5,5"/>`);
  });
  return lines.join('\n');
}

function _svgBorder() {
  return `<rect x="${PL}" y="${PT}" width="${PW}" height="${PH}" fill="none" stroke="#cccccc" stroke-width="1.5"/>`;
}

function _svgYAxis(yTicks, toY, yLabel) {
  const lines = [];
  yTicks.forEach(t => {
    const y = toY(t).toFixed(1);
    lines.push(`<text x="${PL - 10}" y="${(Number(y)+5).toFixed(1)}" text-anchor="end" font-size="16" fill="#333333">${escXML(fmtTick(t))}</text>`);
  });
  const cy = (PT + PH / 2).toFixed(1);
  lines.push(`<text x="32" y="${cy}" text-anchor="middle" font-size="20" font-weight="bold" fill="#1a1a1a" transform="rotate(-90,32,${cy})">${escXML(yLabel)}</text>`);
  return lines.join('\n');
}

function _svgXAxis(data, xIdxs, toX, rangeHours) {
  const lines = [];
  xIdxs.forEach(i => {
    if (!data[i]) return;
    const x = toX(i).toFixed(1);
    const label = fmtXTick(data[i].timestamp, rangeHours);
    lines.push(`<text x="${x}" y="${PB+18}" text-anchor="end" font-size="15" fill="#333333" transform="rotate(-45,${x},${PB+18})">${escXML(label)}</text>`);
  });
  lines.push(`<text x="${(PL+PW/2).toFixed(1)}" y="${PB+105}" text-anchor="middle" font-size="20" font-weight="bold" fill="#1a1a1a">Date &amp; Time</text>`);
  return lines.join('\n');
}

function _svgFooter(fromTs, toTs) {
  const fY = EXP_H - 22;
  return [
    `<text x="${PL}" y="${fY}" font-size="14" fill="#999999">${escXML('Hills and Field AirWatch Monitoring Dashboard')}</text>`,
    `<text x="${PR}" y="${fY}" text-anchor="end" font-size="14" fill="#999999">${escXML(`Period: ${fmtPubDate(fromTs)} — ${fmtPubDate(toTs)}`)}</text>`,
  ].join('\n');
}

function buildSingleSVG(opts) {
  const { title, subtitle, dataKey, color, unit, data, showNcec, ncecLimit, ncecLabel } = opts;
  const vals = data.map(d => d[dataKey]).filter(v => v != null && !isNaN(v)).map(Number);
  const dataMax = vals.length ? Math.max(...vals) : 10;
  const yDomain = Math.max(dataMax, showNcec && ncecLimit ? ncecLimit : 0) * 1.2 || 10;
  const yTicks = computeAxisTicks(0, yDomain, 8);
  const yMax = yTicks[yTicks.length - 1];
  const toY = v => PT + PH - (v / yMax) * PH;
  const toX = i => PL + (data.length > 1 ? (i / (data.length - 1)) * PW : PW / 2);
  const rangeMs = data.length > 1 ? new Date(data[data.length-1].timestamp) - new Date(data[0].timestamp) : 86400000;
  const rangeHours = rangeMs / 3600000;
  const xIdxs = _getXIdxs(data.length);

  // Data path
  const pathParts = [];
  data.forEach((d, i) => {
    const v = d[dataKey]; if (v == null || isNaN(v)) return;
    const x = toX(i).toFixed(1), y = toY(Number(v)).toFixed(1);
    pathParts.push(pathParts.length === 0 ? `M${x},${y}` : `L${x},${y}`);
  });

  const legendY = PB + 150;
  const legendItems = [
    { label: `${title.replace(' Concentration', '')} Measured`, color, dashed: false },
    ...(showNcec && ncecLimit != null ? [{ label: 'NCEC Standard', color: '#ef4444', dashed: true }] : []),
  ];
  const iW = 240;
  let lx = EXP_W / 2 - (legendItems.length * iW) / 2;

  const parts = [
    _svgHeader(title, subtitle),
    `<defs><clipPath id="pc"><rect x="${PL}" y="${PT}" width="${PW}" height="${PH}"/></clipPath></defs>`,
    _svgGrid(yTicks, toY, xIdxs, toX),
    showNcec && ncecLimit != null && ncecLimit <= yMax
      ? `<rect x="${PL}" y="${PT}" width="${PW}" height="${Math.max(0,toY(ncecLimit)-PT).toFixed(1)}" fill="rgba(239,68,68,0.07)"/>`
      : '',
    pathParts.length ? `<path d="${pathParts.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" clip-path="url(#pc)"/>` : '',
    showNcec && ncecLimit != null && ncecLimit <= yMax
      ? `<line x1="${PL}" y1="${toY(ncecLimit).toFixed(1)}" x2="${PR}" y2="${toY(ncecLimit).toFixed(1)}" stroke="#ef4444" stroke-width="2" stroke-dasharray="10,6"/>
         <text x="${PR+8}" y="${(toY(ncecLimit)+5).toFixed(1)}" font-size="15" fill="#ef4444">${escXML(ncecLabel||'')}</text>`
      : '',
    _svgBorder(),
    _svgYAxis(yTicks, toY, `Concentration (${unit})`),
    _svgXAxis(data, xIdxs, toX, rangeHours),
    legendItems.map(item => {
      const x = lx;
      lx += iW;
      return `<line x1="${x}" y1="${legendY}" x2="${x+32}" y2="${legendY}" stroke="${item.color}" stroke-width="2.5"${item.dashed?' stroke-dasharray="8,5"':''}/>
              <text x="${x+40}" y="${legendY+5}" font-size="16" fill="#333333">${escXML(item.label)}</text>`;
    }).join('\n'),
    _svgFooter(data[0]?.timestamp, data[data.length-1]?.timestamp),
    '</svg>',
  ];
  return parts.join('\n');
}

function buildOverlaySVG(opts) {
  const { title, subtitle, activePollutants, data } = opts;
  let allMax = 0;
  activePollutants.forEach(p => data.forEach(d => {
    const v = d[p.key]; if (v != null && !isNaN(v)) allMax = Math.max(allMax, Number(v));
  }));
  const yTicks = computeAxisTicks(0, allMax * 1.2 || 10, 8);
  const yMax = yTicks[yTicks.length - 1];
  const toY = v => PT + PH - (v / yMax) * PH;
  const toX = i => PL + (data.length > 1 ? (i / (data.length - 1)) * PW : PW / 2);
  const rangeMs = data.length > 1 ? new Date(data[data.length-1].timestamp) - new Date(data[0].timestamp) : 86400000;
  const rangeHours = rangeMs / 3600000;
  const xIdxs = _getXIdxs(data.length);

  const legendY = PB + 150;
  const iW = 190;
  let lx = EXP_W / 2 - (activePollutants.length * iW) / 2;

  const parts = [
    _svgHeader(title, subtitle),
    `<defs><clipPath id="pc"><rect x="${PL}" y="${PT}" width="${PW}" height="${PH}"/></clipPath></defs>`,
    _svgGrid(yTicks, toY, xIdxs, toX),
    activePollutants.map(p => {
      const pathParts = [];
      data.forEach((d, i) => {
        const v = d[p.key]; if (v == null || isNaN(v)) return;
        pathParts.push(pathParts.length === 0 ? `M${toX(i).toFixed(1)},${toY(Number(v)).toFixed(1)}` : `L${toX(i).toFixed(1)},${toY(Number(v)).toFixed(1)}`);
      });
      return pathParts.length ? `<path d="${pathParts.join(' ')}" fill="none" stroke="${p.color}" stroke-width="2.5" stroke-linejoin="round" clip-path="url(#pc)"/>` : '';
    }).join('\n'),
    _svgBorder(),
    _svgYAxis(yTicks, toY, 'Concentration (µg/m³)'),
    _svgXAxis(data, xIdxs, toX, rangeHours),
    activePollutants.map(p => {
      const x = lx; lx += iW;
      return `<line x1="${x}" y1="${legendY}" x2="${x+32}" y2="${legendY}" stroke="${p.color}" stroke-width="2.5"/>
              <text x="${x+40}" y="${legendY+5}" font-size="16" fill="#333333">${escXML(p.name)}</text>`;
    }).join('\n'),
    _svgFooter(data[0]?.timestamp, data[data.length-1]?.timestamp),
    '</svg>',
  ];
  return parts.join('\n');
}

function buildCorrSVG(opts) {
  const { title, subtitle, xParam, yParam, points, trendData } = opts;
  if (!points.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="${EXP_W}" height="${EXP_H}"><rect width="${EXP_W}" height="${EXP_H}" fill="#fff"/><text x="${EXP_W/2}" y="${EXP_H/2}" text-anchor="middle" font-family="Arial" font-size="24" fill="#999">No data</text></svg>`;

  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const xPad = (Math.max(...xs) - Math.min(...xs)) * 0.08 || 1;
  const yPad = (Math.max(...ys) - Math.min(...ys)) * 0.08 || 1;
  const xDom = [Math.min(...xs) - xPad, Math.max(...xs) + xPad];
  const yDom = [Math.min(...ys) - yPad, Math.max(...ys) + yPad];
  const toX = v => PL + ((v - xDom[0]) / (xDom[1] - xDom[0])) * PW;
  const toY = v => PT + PH - ((v - yDom[0]) / (yDom[1] - yDom[0])) * PH;
  const xTicks = computeAxisTicks(xDom[0], xDom[1], 8);
  const yTicks = computeAxisTicks(yDom[0], yDom[1], 8);

  const legendY = PB + 148;
  const aqiItems = [['#16A34A','Good'],['#CA8A04','Moderate'],['#EA580C','Sensitive'],['#DC2626','Unhealthy'],['#7C3AED','Very Unhealthy'],['#94a3b8','Unknown']];
  const iW = 270;
  let lx = EXP_W / 2 - (aqiItems.length * iW) / 2;

  const parts = [
    _svgHeader(title, subtitle),
    `<defs>
      <clipPath id="pc"><rect x="${PL}" y="${PT}" width="${PW}" height="${PH}"/></clipPath>
    </defs>`,
    yTicks.filter(t => t >= yDom[0] && t <= yDom[1]).map(t => `<line x1="${PL}" y1="${toY(t).toFixed(1)}" x2="${PR}" y2="${toY(t).toFixed(1)}" stroke="#e0e0e0" stroke-width="1" stroke-dasharray="5,5"/>`).join('\n'),
    xTicks.filter(t => t >= xDom[0] && t <= xDom[1]).map(t => `<line x1="${toX(t).toFixed(1)}" y1="${PT}" x2="${toX(t).toFixed(1)}" y2="${PB}" stroke="#e0e0e0" stroke-width="1" stroke-dasharray="5,5"/>`).join('\n'),
    `<g clip-path="url(#pc)">`,
    points.map(p => {
      const c = p.aqi == null ? '#94a3b8' : p.aqi <= 50 ? '#16A34A' : p.aqi <= 100 ? '#CA8A04' : p.aqi <= 150 ? '#EA580C' : p.aqi <= 200 ? '#DC2626' : '#7C3AED';
      return `<circle cx="${toX(p.x).toFixed(1)}" cy="${toY(p.y).toFixed(1)}" r="5" fill="${c}" fill-opacity="0.8"/>`;
    }).join('\n'),
    trendData.length === 2
      ? `<line x1="${toX(trendData[0].x).toFixed(1)}" y1="${toY(trendData[0].y).toFixed(1)}" x2="${toX(trendData[1].x).toFixed(1)}" y2="${toY(trendData[1].y).toFixed(1)}" stroke="#0d9488" stroke-width="2" stroke-dasharray="8,5"/>`
      : '',
    '</g>',
    _svgBorder(),
    yTicks.filter(t => t >= yDom[0] && t <= yDom[1]).map(t => `<text x="${PL-10}" y="${(toY(t)+5).toFixed(1)}" text-anchor="end" font-size="16" fill="#333333">${escXML(fmtTick(t))}</text>`).join('\n'),
    `<text x="32" y="${(PT+PH/2).toFixed(1)}" text-anchor="middle" font-size="20" font-weight="bold" fill="#1a1a1a" transform="rotate(-90,32,${(PT+PH/2).toFixed(1)})">${escXML(`${yParam.name} (${yParam.unit})`)}</text>`,
    xTicks.filter(t => t >= xDom[0] && t <= xDom[1]).map(t => `<text x="${toX(t).toFixed(1)}" y="${PB+18}" text-anchor="end" font-size="15" fill="#333333" transform="rotate(-45,${toX(t).toFixed(1)},${PB+18})">${escXML(fmtTick(t))}</text>`).join('\n'),
    `<text x="${(PL+PW/2).toFixed(1)}" y="${PB+105}" text-anchor="middle" font-size="20" font-weight="bold" fill="#1a1a1a">${escXML(`${xParam.name} (${xParam.unit})`)}</text>`,
    aqiItems.map(([c, l]) => {
      const x = lx; lx += iW;
      return `<circle cx="${x+8}" cy="${legendY}" r="7" fill="${c}" fill-opacity="0.8"/>
              <text x="${x+22}" y="${legendY+5}" font-size="15" fill="#333333">${escXML(l)}</text>`;
    }).join('\n'),
    `<text x="${PL}" y="${EXP_H-22}" font-size="14" fill="#999999">${escXML('Hills and Field AirWatch Monitoring Dashboard')}</text>`,
    `<text x="${PR}" y="${EXP_H-22}" text-anchor="end" font-size="14" fill="#999999">${escXML(`Generated: ${new Date().toLocaleString('en-GB', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}`)}</text>`,
    '</svg>',
  ];
  return parts.join('\n');
}

// ─── Unified export dispatcher ───
async function runExport(fmt, opts) {
  const fromTs = opts.fromTs ?? opts.data?.[0]?.timestamp ?? null;
  const toTs   = opts.toTs   ?? opts.data?.[opts.data?.length-1]?.timestamp ?? null;
  const filename = buildFilename(opts.filenameTag || 'Chart', fromTs, toTs, fmt);

  if (fmt === 'png') await doExportPNG(opts, filename);
  else if (fmt === 'pdf') await doExportPDF(opts, filename);
  else doExportSVG(opts, filename);
}

// ─── Export hook (no hidden DOM, no html2canvas) ───
function useChartExport() {
  const [dlOpen, setDlOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const optsRef = useRef(null);

  function triggerExport(fmt, getOpts) {
    setDlOpen(false);
    optsRef.current = { fmt, getOpts };
    setExporting(true);
  }

  useEffect(() => {
    if (!exporting || !optsRef.current) return;
    let alive = true;
    const { fmt, getOpts } = optsRef.current;
    (async () => {
      try { await runExport(fmt, getOpts()); }
      finally { if (alive) setExporting(false); }
    })();
    return () => { alive = false; };
  }, [exporting]);

  return { dlOpen, setDlOpen, exporting, triggerExport };
}

// ─── Download dropdown UI ───
function DlButton({ dlOpen, setDlOpen, onExport, exporting, label = 'Export' }) {
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setDlOpen(o => !o)} disabled={exporting} style={{
        ...glassInner({ padding: '4px 10px', borderRadius: 8 }),
        border: 'none', cursor: exporting ? 'wait' : 'pointer',
        display: 'flex', alignItems: 'center', gap: 4,
        fontSize: 10, fontWeight: 600, color: '#3B82F6', fontFamily: 'var(--font)',
        opacity: exporting ? 0.6 : 1,
      }}>
        <Download size={11} />{exporting ? 'Exporting…' : label}
      </button>
      {dlOpen && (
        <div style={{
          position: 'absolute', right: 0, top: '110%', zIndex: 200,
          ...glass({ padding: '4px', borderRadius: 10 }),
          minWidth: 190, boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
        }}>
          {[
            { fmt: 'png', label: 'Download PNG (300 DPI)' },
            { fmt: 'pdf', label: 'Download PDF' },
            { fmt: 'svg', label: 'Download SVG' },
          ].map(({ fmt, label: lbl }) => (
            <button key={fmt} onClick={() => onExport(fmt)} style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px',
              borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 11,
              fontFamily: 'var(--font)', color: 'var(--text)', background: 'transparent', transition: 'background 0.15s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.5)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >{lbl}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Single Gas Chart Card ───
function GasChart({ pollutant, allData, stationName }) {
  const { key, name, unit, color, threshold } = pollutant;

  const [chartRange, setChartRange] = useState('24h');
  const [showNcec, setShowNcec] = useState(true);
  const [ncecStdIdx, setNcecStdIdx] = useState(0);
  const { dlOpen, setDlOpen, exporting, triggerExport } = useChartExport();

  const ncecStds = (NCEC_STANDARDS[key]?.standards) || [];
  const ncecStd  = ncecStds[ncecStdIdx] || null;
  const ncecLimit = ncecStd?.limit ?? threshold;
  const ncecLabel = ncecStd
    ? `NCEC ${ncecStd.period}: ${ncecLimit} ${unit}`
    : `NCEC: ${threshold} ${unit}`;

  const chartData = useMemo(() => {
    const hours = { '1h':1,'6h':6,'12h':12,'24h':24,'7d':168,'30d':720 }[chartRange] || 24;
    const cutoff = allData.length
      ? new Date(allData[allData.length - 1].timestamp).getTime() - hours * 3600000
      : Date.now() - hours * 3600000;
    return allData
      .filter(r => new Date(r.timestamp).getTime() >= cutoff)
      .map(r => ({ ...r, time: hours <= 24 ? formatTime(r.timestamp) : formatDate(r.timestamp) }));
  }, [allData, chartRange]);

  const values  = chartData.map(d => d[key]).filter(v => v != null);
  const current = values.length ? values[values.length - 1] : null;
  const avg     = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const min     = values.length ? Math.min(...values) : null;
  const maxVal  = values.length ? Math.max(...values) : null;
  const over    = current != null && current > threshold;
  const prevAvg = values.length > 4 ? values.slice(0, Math.floor(values.length / 2)).reduce((a, b) => a + b, 0) / Math.floor(values.length / 2) : null;
  const trend   = avg && prevAvg ? (avg > prevAvg ? 'up' : 'down') : null;
  const trendPct = avg && prevAvg ? Math.abs(((avg - prevAvg) / prevAvg) * 100).toFixed(0) : null;

  const fromTs = chartData[0]?.timestamp;
  const toTs   = chartData[chartData.length - 1]?.timestamp;

  const getExportOpts = () => ({
    type: 'single',
    title: `${name} Concentration`,
    subtitle: fmtSubtitleRange(fromTs, toTs),
    dataKey: key, color, unit, data: chartData,
    showNcec, ncecLimit, ncecLabel,
    filenameTag: key.toUpperCase(),
    fromTs, toTs,
  });

  return (
    <div style={{ ...glass({ padding: '16px 18px' }), animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) both', position: 'relative' }}>

      {/* ── Control bar ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
        <div style={{ ...glassInner({ padding: '2px 3px', borderRadius: 9 }), display: 'flex', gap: 1 }}>
          {['1h','6h','12h','24h','7d','30d'].map(t => (
            <button key={t} onClick={() => setChartRange(t)} style={{
              padding: '3px 7px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 600, fontFamily: 'var(--mono)',
              background: chartRange === t ? '#0d9488' : 'transparent',
              color: chartRange === t ? '#fff' : 'var(--text-faint)',
              transition: 'all 0.15s',
            }}>{t}</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 10, color: 'var(--text-muted)', userSelect: 'none' }}>
            <input type="checkbox" checked={showNcec} onChange={e => setShowNcec(e.target.checked)} style={{ cursor: 'pointer', accentColor: '#DC2626' }} />
            NCEC
          </label>
          {showNcec && ncecStds.length > 1 && (
            <select value={ncecStdIdx} onChange={e => setNcecStdIdx(Number(e.target.value))} style={{
              fontSize: 9, padding: '2px 5px', borderRadius: 6, cursor: 'pointer',
              border: '1px solid var(--glass-inner-border)', background: 'var(--glass-inner-bg)',
              color: 'var(--text-muted)', fontFamily: 'var(--mono)',
            }}>
              {ncecStds.map((s, i) => <option key={i} value={i}>{s.period}: {s.limit}</option>)}
            </select>
          )}
          <DlButton dlOpen={dlOpen} setDlOpen={setDlOpen} exporting={exporting}
            onExport={fmt => triggerExport(fmt, getExportOpts)} />
        </div>
      </div>

      {/* ── Chart header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--text)' }}>{name}</h3>
            {over && <AlertTriangle size={14} color="#DC2626" />}
          </div>
          {showNcec && <p style={{ fontSize: 10, color: 'var(--text-faint)', margin: 0 }}>{ncecLabel}</p>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: over ? '#DC2626' : color, margin: 0, lineHeight: 1 }}>
            {current != null ? current.toFixed(1) : '—'}
          </p>
          <p style={{ fontSize: 10, color: 'var(--text-faint)', margin: '2px 0 0' }}>{unit}</p>
          {trend && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', color: trend === 'up' ? '#DC2626' : '#16A34A', marginTop: 2 }}>
              {trend === 'up' ? <TrendingUp size={10} /> : <TrendingDown size={10} />}{trendPct}%
            </span>
          )}
        </div>
      </div>

      {/* ── Screen chart ── */}
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
          <defs>
            <linearGradient id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={color} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" />
          <XAxis dataKey="time" tick={{ fill: 'var(--text-faint)', fontSize: 9, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 9, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} domain={[0, 'auto']} />
          <Tooltip content={<GlassTooltip />} />
          {showNcec && (
            <ReferenceLine y={ncecLimit} stroke="#DC262680" strokeDasharray="4 4"
              label={{ value: 'NCEC', position: 'right', fontSize: 9, fill: '#DC2626' }} />
          )}
          <Area type="monotone" dataKey={key} stroke={color} fill={`url(#grad-${key})`} strokeWidth={2} dot={false} name={name} />
        </AreaChart>
      </ResponsiveContainer>

      {/* ── Stats row ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, padding: '6px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.25)' }}>
        {[{ label: 'Min', value: min }, { label: 'Avg', value: avg }, { label: 'Max', value: maxVal }, { label: 'NCEC', value: ncecLimit }].map((s, i) => (
          <div key={i} style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 9, color: 'var(--text-faint)', margin: 0, fontWeight: 600, textTransform: 'uppercase' }}>{s.label}</p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: s.label === 'Max' && s.value > threshold ? '#DC2626' : 'var(--text)', margin: '1px 0 0' }}>
              {s.value != null ? (typeof s.value === 'number' ? s.value.toFixed(1) : s.value) : '—'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}


// ─── Sort arrow ───
function SortArrow({ col, sortKey, sortDir }) {
  if (sortKey !== col) return <span style={{ color: '#D6D3D1', marginLeft: 3, fontSize: 9 }}>⇅</span>;
  return sortDir === 'asc'
    ? <ChevronUp size={11} style={{ marginLeft: 2, verticalAlign: 'middle' }} />
    : <ChevronDown size={11} style={{ marginLeft: 2, verticalAlign: 'middle' }} />;
}

// ─── Math helpers ───
function pearsonR(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const dx = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0));
  const dy = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0));
  return dx && dy ? num / (dx * dy) : 0;
}
function linReg(xs, ys) {
  const n = xs.length;
  if (n < 2) return { m: 0, b: 0 };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const m = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  return { m, b: my - m * mx };
}
function rInterpret(r) {
  const abs = Math.abs(r);
  const sign = r > 0 ? 'positive' : 'negative';
  if (abs >= 0.7) return `Strong ${sign} correlation`;
  if (abs >= 0.4) return `Moderate ${sign} correlation`;
  if (abs >= 0.2) return `Weak ${sign} correlation`;
  return 'No significant correlation';
}

const CORR_PARAMS = [
  { key: 'pm25', name: 'PM₂.₅', unit: 'µg/m³', color: '#3B82F6' },
  { key: 'pm10', name: 'PM₁₀', unit: 'µg/m³', color: '#8B5CF6' },
  { key: 'so2',  name: 'SO₂',  unit: 'µg/m³', color: '#F59E0B' },
  { key: 'no2',  name: 'NO₂',  unit: 'µg/m³', color: '#06B6D4' },
  { key: 'o3',   name: 'O₃',   unit: 'µg/m³', color: '#EC4899' },
  { key: 'co',   name: 'CO',   unit: 'µg/m³', color: '#10B981' },
  { key: 'temperature', name: 'Temp', unit: '°C', color: '#EF4444' },
  { key: 'humidity',    name: 'RH',   unit: '%',  color: '#0EA5E9' },
  { key: 'wind_speed',  name: 'Wind Speed', unit: 'm/s', color: '#A78BFA' },
  { key: 'wind_direction', name: 'Wind Dir', unit: '°', color: '#F97316' },
];
const CORR_PRESETS = [
  { label: 'Wind vs PM₂.₅', x: 'wind_speed', y: 'pm25' },
  { label: 'Temp vs O₃',    x: 'temperature', y: 'o3' },
  { label: 'RH vs PM₂.₅',  x: 'humidity', y: 'pm25' },
  { label: 'WD vs PM₁₀',   x: 'wind_direction', y: 'pm10' },
];
function aqiDotColor(aqi) {
  if (aqi == null) return '#94a3b8';
  if (aqi <= 50)  return '#16A34A';
  if (aqi <= 100) return '#CA8A04';
  if (aqi <= 150) return '#EA580C';
  if (aqi <= 200) return '#DC2626';
  return '#7C3AED';
}

function CorrelationChart({ data, stationName }) {
  const [xKey, setXKey] = useState('wind_speed');
  const [yKey, setYKey] = useState('pm25');
  const { dlOpen, setDlOpen, exporting, triggerExport } = useChartExport();

  const xParam = CORR_PARAMS.find(p => p.key === xKey) || CORR_PARAMS[0];
  const yParam = CORR_PARAMS.find(p => p.key === yKey) || CORR_PARAMS[1];

  const points = useMemo(() => (
    data.filter(r => r[xKey] != null && r[yKey] != null)
      .map(r => ({ x: Number(r[xKey]), y: Number(r[yKey]), aqi: r.aqi != null ? Number(r.aqi) : null }))
  ), [data, xKey, yKey]);

  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const r = points.length >= 2 ? pearsonR(xs, ys) : 0;
  const { m, b } = points.length >= 2 ? linReg(xs, ys) : { m: 0, b: 0 };
  const xMin = xs.length ? Math.min(...xs) : 0, xMax = xs.length ? Math.max(...xs) : 1;
  const trendData = xs.length >= 2 ? [{ x: xMin, y: m * xMin + b }, { x: xMax, y: m * xMax + b }] : [];
  const rColor = Math.abs(r) >= 0.7 ? '#16A34A' : Math.abs(r) >= 0.4 ? '#F59E0B' : '#94a3b8';

  const selStyle = (active) => ({
    padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
    fontSize: 11, fontWeight: 600, fontFamily: 'var(--font)',
    background: active ? '#0d9488' : 'var(--glass-inner-bg)',
    color: active ? '#fff' : 'var(--text-muted)',
    transition: 'all 0.15s',
  });

  const CustomDot = (props) => {
    const { cx, cy, payload } = props;
    return <circle cx={cx} cy={cy} r={3} fill={aqiDotColor(payload.aqi)} fillOpacity={0.75} stroke="none" />;
  };

  const getExportOpts = () => ({
    type: 'corr',
    title: `Pollutant Correlation: ${xParam.name} vs ${yParam.name}`,
    subtitle: `Pearson R = ${r.toFixed(3)} · ${rInterpret(r)}`,
    xParam, yParam, points, trendData, rValue: r,
    filenameTag: `Corr_${xKey}_vs_${yKey}`,
    fromTs: null, toTs: null,
  });

  return (
    <div style={{ ...glass({ padding: '20px 24px' }), marginTop: 20, animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) both' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 3px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <GitBranch size={16} color="#0d9488" /> Correlation Analysis
          </h3>
          <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: 0 }}>Scatter plot of parameter relationships</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {CORR_PRESETS.map(p => (
            <button key={p.label} onClick={() => { setXKey(p.x); setYKey(p.y); }} style={selStyle(xKey === p.x && yKey === p.y)}>
              {p.label}
            </button>
          ))}
          <DlButton dlOpen={dlOpen} setDlOpen={setDlOpen} exporting={exporting}
            onExport={fmt => triggerExport(fmt, getExportOpts)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>X:</span>
          <select value={xKey} onChange={e => setXKey(e.target.value)} style={{ padding: '5px 9px', borderRadius: 8, fontSize: 12, color: 'var(--text)', background: 'var(--glass-inner-bg)', border: '1px solid var(--glass-inner-border)', outline: 'none', fontFamily: 'var(--font)' }}>
            {CORR_PARAMS.map(p => <option key={p.key} value={p.key}>{p.name} ({p.unit})</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Y:</span>
          <select value={yKey} onChange={e => setYKey(e.target.value)} style={{ padding: '5px 9px', borderRadius: 8, fontSize: 12, color: 'var(--text)', background: 'var(--glass-inner-bg)', border: '1px solid var(--glass-inner-border)', outline: 'none', fontFamily: 'var(--font)' }}>
            {CORR_PARAMS.map(p => <option key={p.key} value={p.key}>{p.name} ({p.unit})</option>)}
          </select>
        </div>
        {points.length >= 2 && (
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <p style={{ fontSize: 10, color: 'var(--text-faint)', margin: 0, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Pearson R</p>
            <p style={{ fontSize: 22, fontWeight: 700, margin: 0, fontFamily: 'var(--mono)', color: rColor, lineHeight: 1 }}>{r.toFixed(3)}</p>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '2px 0 0' }}>{rInterpret(r)}</p>
          </div>
        )}
      </div>

      {points.length < 2 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-faint)', fontSize: 13 }}>
          Not enough data points — select a longer time range
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
            <XAxis dataKey="x" type="number" domain={['auto', 'auto']} name={xParam.name}
              label={{ value: `${xParam.name} (${xParam.unit})`, position: 'insideBottom', offset: -10, fill: 'var(--text-muted)', fontSize: 11 }}
              tick={{ fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'var(--mono)' }}
              axisLine={false} tickLine={false} />
            <YAxis dataKey="y" type="number" domain={['auto', 'auto']} name={yParam.name}
              label={{ value: `${yParam.name} (${yParam.unit})`, angle: -90, position: 'insideLeft', offset: 10, fill: 'var(--text-muted)', fontSize: 11 }}
              tick={{ fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'var(--mono)' }}
              axisLine={false} tickLine={false} />
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload || {};
              return (
                <div style={{ ...glass({ padding: '8px 12px', borderRadius: 10 }), boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
                  <p style={{ fontSize: 11, color: 'var(--text)', margin: 0 }}>{xParam.name}: <strong style={{ fontFamily: 'var(--mono)' }}>{typeof d.x === 'number' ? d.x.toFixed(2) : d.x}</strong></p>
                  <p style={{ fontSize: 11, color: 'var(--text)', margin: '2px 0 0' }}>{yParam.name}: <strong style={{ fontFamily: 'var(--mono)' }}>{typeof d.y === 'number' ? d.y.toFixed(2) : d.y}</strong></p>
                  {d.aqi != null && <p style={{ fontSize: 10, color: aqiDotColor(d.aqi), margin: '2px 0 0' }}>AQI: {Math.round(d.aqi)}</p>}
                </div>
              );
            }} />
            <Scatter data={points} shape={<CustomDot />} />
            {trendData.length === 2 && (
              <RLine data={trendData} dataKey="y" dot={false} stroke="#0d9488" strokeWidth={2} strokeDasharray="6 3" type="linear" isAnimationActive={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}

      <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-faint)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Dot color = AQI:</span>
        {[['#16A34A','Good (0-50)'],['#CA8A04','Moderate (51-100)'],['#EA580C','USG (101-150)'],['#DC2626','Unhealthy (151-200)'],['#7C3AED','Very Unhealthy (200+)'],['#94a3b8','Unknown']].map(([c, l]) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══ Charts Page ═══
export default function Charts({ profile }) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isPhone, setIsPhone]   = useState(window.innerWidth < 480);

  useEffect(() => {
    const handle = () => { setIsMobile(window.innerWidth < 768); setIsPhone(window.innerWidth < 480); };
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, []);

  const { stationId } = useParams();
  const [stations, setStations]       = useState([]);
  const [selIdx, setSelIdx]           = useState(0);
  const [timeRange, setTimeRange]     = useState('24h');
  const [allData, setAllData]         = useState([]);
  const [overlayKeys, setOverlayKeys] = useState(['pm25', 'pm10', 'o3']);

  // Multi-overlay export
  const overlayExport = useChartExport();

  // Table state
  const [aggMode, setAggMode] = useState('raw');
  const [sortKey, setSortKey] = useState('timestamp');
  const [sortDir, setSortDir] = useState('desc');
  const [filter, setFilter]   = useState('');
  const [page, setPage]       = useState(0);

  useEffect(() => {
    async function load() {
      try {
        const st = await getStations();
        if (st.length > 0) setStations(st);
        else throw new Error('No stations');
      } catch { setStations(getDemoStations()); }
    }
    load();
  }, []);

  useEffect(() => {
    if (stationId && stations.length) {
      const idx = stations.findIndex(s => s.id === stationId);
      if (idx >= 0) setSelIdx(idx);
    }
  }, [stationId, stations]);

  useEffect(() => {
    if (!stations.length) return;
    const sid = stations[selIdx]?.id;
    if (!sid) return;
    if (sid.startsWith('demo-')) {
      setAllData(getDemoHistory(sid, 720));
      setPage(0);
    } else {
      getReadingsHistory(sid, 720).then(hist => {
        setAllData(hist || []);
        setPage(0);
      });
    }
  }, [selIdx, stations]);

  useEffect(() => { setPage(0); }, [aggMode, filter, sortKey, sortDir]);

  const station = stations[selIdx] || {};

  const data = useMemo(() => {
    const hours = { '1h':1,'6h':6,'12h':12,'24h':24,'7d':168,'30d':720 }[timeRange] || 24;
    const cutoff = allData.length
      ? new Date(allData[allData.length - 1].timestamp).getTime() - hours * 3600000
      : Date.now() - hours * 3600000;
    return allData
      .filter(r => new Date(r.timestamp).getTime() >= cutoff)
      .map(r => ({ ...r, time: hours <= 24 ? formatTime(r.timestamp) : formatDate(r.timestamp) }));
  }, [allData, timeRange]);

  function toggleOverlay(key) {
    setOverlayKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }
  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  const tableRows = useMemo(() => {
    let rows = aggregate(data, aggMode);
    if (filter.trim()) {
      const q = filter.toLowerCase();
      rows = rows.filter(r => Object.values(r).some(v => v != null && String(v).toLowerCase().includes(q)));
    }
    rows = [...rows].sort((a, b) => {
      const av = a[sortKey] ?? '', bv = b[sortKey] ?? '';
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [data, aggMode, filter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE));
  const pageRows   = tableRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const showCount  = aggMode !== 'raw';

  function exportCSV() {
    if (!data.length) return;
    const rows = aggregate(data, aggMode);
    const pollutantHeaders = POLLUTANTS.map(p => `${p.name} (${p.unit})`);
    const headers = ['Timestamp', ...(showCount ? ['Count'] : []), ...pollutantHeaders, 'Temp (°C)', 'Humidity (%)', 'Wind Speed (m/s)', 'Wind Dir (°)'];
    const keys    = ['timestamp', ...(showCount ? ['count'] : []), ...POLLUTANTS.map(p => p.key), 'temperature', 'humidity', 'wind_speed', 'wind_direction'];
    const csv = [
      headers.join(','),
      ...rows.map(r => keys.map(k => {
        const v = r[k];
        if (k === 'timestamp') return `"${fmtTs(v)}"`;
        return v != null ? (typeof v === 'number' ? v.toFixed(2) : v) : '';
      }).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `${station.name?.replace(/\s+/g, '_') || 'station'}_${timeRange}_${aggMode}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const toggleBtn = (active, color = 'var(--text)') => ({
    padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
    background: active ? 'rgba(255,255,255,0.7)' : 'transparent',
    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
    fontSize: 11, fontWeight: active ? 700 : 500,
    color: active ? color : 'var(--text-faint)',
    transition: 'all 0.2s', fontFamily: 'var(--font)',
  });

  const thStyle = (col) => ({
    padding: '8px 10px', textAlign: 'left', borderBottom: '2px solid rgba(255,255,255,0.4)',
    color: sortKey === col ? 'var(--text)' : 'var(--text-muted)',
    fontWeight: 700, fontSize: 10, whiteSpace: 'nowrap',
    cursor: 'pointer', userSelect: 'none',
    background: sortKey === col ? 'rgba(255,255,255,0.25)' : 'transparent',
    transition: 'background 0.15s',
  });

  const activePollutants = POLLUTANTS.filter(p => overlayKeys.includes(p.key));
  const overlayFromTs = data[0]?.timestamp, overlayToTs = data[data.length - 1]?.timestamp;

  const getOverlayExportOpts = () => ({
    type: 'overlay',
    title: 'Multi-Pollutant Overlay',
    subtitle: fmtSubtitleRange(overlayFromTs, overlayToTs),
    activePollutants, data,
    filenameTag: 'MultiPollutant',
    fromTs: overlayFromTs, toTs: overlayToTs,
  });

  return (
    <div style={{ width: '100%' }}>

      {/* Header: Station selector + Time range */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12, flexDirection: isMobile ? 'column' : 'row' }}>
        <div style={{ ...glassInner({ padding: '4px 6px', borderRadius: 12 }), display: 'flex', gap: 3, overflowX: 'auto' }}>
          {stations.map((s, i) => (
            <button key={s.id} onClick={() => setSelIdx(i)} style={{
              padding: '6px 12px', borderRadius: 9, border: 'none', cursor: 'pointer',
              background: selIdx === i ? 'rgba(255,255,255,0.65)' : 'transparent',
              boxShadow: selIdx === i ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
              fontSize: 11, fontWeight: selIdx === i ? 700 : 500, color: selIdx === i ? 'var(--text)' : 'var(--text-muted)',
              whiteSpace: 'nowrap', transition: 'all 0.2s', fontFamily: 'var(--font)',
            }}>{s.name}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ ...glassInner({ padding: '3px 4px', borderRadius: 10 }), display: 'flex', gap: 2 }}>
            {['1h', '6h', '12h', '24h', '7d', '30d'].map(t => (
              <button key={t} onClick={() => setTimeRange(t)} style={{
                padding: isMobile ? '8px 10px' : '5px 10px', minHeight: isMobile ? 44 : undefined,
                borderRadius: 7, border: 'none', cursor: 'pointer',
                fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)',
                background: timeRange === t ? 'rgba(255,255,255,0.7)' : 'transparent',
                color: timeRange === t ? 'var(--text)' : 'var(--text-faint)',
                boxShadow: timeRange === t ? '0 1px 3px rgba(0,0,0,0.05)' : 'none',
                transition: 'all 0.2s',
              }}>{t}</button>
            ))}
          </div>
          <button onClick={exportCSV} style={{
            ...glassInner({ padding: '6px 12px', borderRadius: 10 }),
            border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 11, fontWeight: 600, color: '#3B82F6', transition: 'background 0.2s', fontFamily: 'var(--font)',
          }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.5)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
          >
            <Download size={12} />Export CSV
          </button>
        </div>
      </div>

      {/* Gas charts grid */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 14, marginBottom: 16 }}>
        {POLLUTANTS.map(p => (
          <GasChart key={p.key} pollutant={p} allData={allData} stationName={station.name || '—'} />
        ))}
      </div>

      {/* Multi-pollutant overlay */}
      <div style={{ ...glass({ padding: '20px 22px', marginBottom: 16 }), animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.3s both' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Multi-Pollutant Overlay</h2>
            <p style={{ color: 'var(--text-faint)', fontSize: 11, margin: '2px 0 0' }}>Compare pollutants on one chart — click to toggle</p>
          </div>
          <DlButton dlOpen={overlayExport.dlOpen} setDlOpen={overlayExport.setDlOpen}
            exporting={overlayExport.exporting}
            onExport={fmt => overlayExport.triggerExport(fmt, getOverlayExportOpts)} />
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {POLLUTANTS.map(p => (
            <button key={p.key} onClick={() => toggleOverlay(p.key)} style={{
              padding: '4px 12px', borderRadius: 8, border: `1.5px solid ${overlayKeys.includes(p.key) ? p.color : 'rgba(255,255,255,0.4)'}`,
              background: overlayKeys.includes(p.key) ? `${p.color}15` : 'transparent',
              cursor: 'pointer', fontSize: 11, fontWeight: 600, color: overlayKeys.includes(p.key) ? p.color : 'var(--text-faint)',
              transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font)',
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: overlayKeys.includes(p.key) ? p.color : '#D6D3D1' }} />
              {p.name}
            </button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={isMobile ? 200 : 300}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" />
            <XAxis dataKey="time" tick={{ fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
            <Tooltip content={<GlassTooltip />} />
            {POLLUTANTS.filter(p => overlayKeys.includes(p.key)).map(p => (
              <Line key={p.key} type="monotone" dataKey={p.key} stroke={p.color} strokeWidth={2} dot={false} name={p.name} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Correlation Analysis */}
      <CorrelationChart data={aggregate(data, 'hourly')} stationName={station.name || '—'} />

      {/* Data Table */}
      <div style={{ ...glass({ padding: '20px 22px' }), animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.4s both' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Data Table</h2>
            <div style={{ ...glassInner({ padding: '3px 4px', borderRadius: 9 }), display: 'flex', gap: 2 }}>
              {[{ id: 'raw', label: 'Raw' }, { id: '1min', label: '1-Min Avg' }, { id: 'hourly', label: 'Hourly Avg' }, { id: '24h', label: '24-Hr Avg' }].map(m => (
                <button key={m.id} onClick={() => setAggMode(m.id)} style={toggleBtn(aggMode === m.id)}>{m.label}</button>
              ))}
            </div>
          </div>
          <div style={{ position: 'relative' }}>
            <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }} />
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter readings…"
              style={{ paddingLeft: 28, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 9, border: '1px solid rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.35)', backdropFilter: 'blur(8px)', fontSize: 11, color: 'var(--text)', fontFamily: 'var(--font)', outline: 'none', width: 190 }} />
          </div>
        </div>

        <div data-scroll-x style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', width: '100%' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)', minWidth: 800 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle('timestamp'), position: 'sticky', left: 0, zIndex: 2, background: sortKey === 'timestamp' ? 'rgba(241,245,249,0.97)' : 'rgba(248,250,251,0.97)' }} onClick={() => handleSort('timestamp')}>
                  Timestamp <SortArrow col="timestamp" sortKey={sortKey} sortDir={sortDir} />
                </th>
                {showCount && <th style={thStyle('count')} onClick={() => handleSort('count')}># <SortArrow col="count" sortKey={sortKey} sortDir={sortDir} /></th>}
                {POLLUTANTS.map(p => (
                  <th key={p.key} style={thStyle(p.key)} onClick={() => handleSort(p.key)}>
                    {p.name}<span style={{ color: 'var(--text-faint)', fontWeight: 400, marginLeft: 2 }}>{p.unit}</span>
                    <SortArrow col={p.key} sortKey={sortKey} sortDir={sortDir} />
                  </th>
                ))}
                {[{ key: 'temperature', label: 'Temp', unit: '°C' }, { key: 'humidity', label: 'Humidity', unit: '%' }, { key: 'wind_speed', label: 'Wind', unit: 'm/s' }].map(col => (
                  <th key={col.key} style={thStyle(col.key)} onClick={() => handleSort(col.key)}>
                    {col.label}<span style={{ color: 'var(--text-faint)', fontWeight: 400, marginLeft: 2 }}>{col.unit}</span>
                    <SortArrow col={col.key} sortKey={sortKey} sortDir={sortDir} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr><td colSpan={99} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-faint)', fontFamily: 'var(--font)' }}>No readings match your filter.</td></tr>
              ) : pageRows.map((row, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? 'rgba(255,255,255,0.15)' : 'transparent' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'rgba(255,255,255,0.15)' : 'transparent'}
                >
                  <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: 'var(--text-mid)', position: 'sticky', left: 0, zIndex: 1, background: 'inherit' }}>{fmtTs(row.timestamp)}</td>
                  {showCount && <td style={{ padding: '6px 10px', color: 'var(--text-muted)', textAlign: 'center' }}>{row.count}</td>}
                  {POLLUTANTS.map(p => {
                    const v = row[p.key];
                    return (
                      <td key={p.key} style={{ padding: '6px 10px', color: cellColor(p.key, v), fontWeight: cellColor(p.key, v) !== 'var(--text)' && cellColor(p.key, v) !== 'var(--text-muted)' ? 700 : 400, background: cellBg(p.key, v), transition: 'background 0.15s' }}>
                        {v != null ? v.toFixed(1) : '—'}
                      </td>
                    );
                  })}
                  <td style={{ padding: '6px 10px', color: 'var(--text)' }}>{row.temperature != null ? row.temperature.toFixed(1) : '—'}</td>
                  <td style={{ padding: '6px 10px', color: 'var(--text)' }}>{row.humidity    != null ? row.humidity.toFixed(0)    : '—'}</td>
                  <td style={{ padding: '6px 10px', color: 'var(--text)' }}>{row.wind_speed  != null ? row.wind_speed.toFixed(1)  : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font)' }}>
            {tableRows.length === 0 ? 'No readings' : `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, tableRows.length)} of ${tableRows.length} ${aggMode === 'raw' ? 'readings' : 'periods'}`}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => setPage(0)} disabled={page === 0}
              style={{ ...glassInner({ padding: '4px 8px', borderRadius: 7 }), border: 'none', cursor: page === 0 ? 'default' : 'pointer', fontSize: 10, color: page === 0 ? '#D6D3D1' : 'var(--text-mid)', fontFamily: 'var(--font)' }}>«</button>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              style={{ ...glassInner({ padding: '4px 7px', borderRadius: 7 }), border: 'none', cursor: page === 0 ? 'default' : 'pointer', color: page === 0 ? '#D6D3D1' : 'var(--text-mid)', display: 'flex', alignItems: 'center' }}><ChevronLeft size={13} /></button>
            {isPhone
              ? <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', padding: '0 6px' }}>{page + 1} / {totalPages}</span>
              : Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const offset = Math.max(0, Math.min(page - 2, totalPages - 5));
                  const pg = offset + i;
                  return (
                    <button key={pg} onClick={() => setPage(pg)} style={{
                      width: 28, height: 28, borderRadius: 7, border: 'none', cursor: 'pointer',
                      background: pg === page ? 'rgba(255,255,255,0.7)' : 'transparent',
                      boxShadow: pg === page ? '0 1px 3px rgba(0,0,0,0.07)' : 'none',
                      fontSize: 11, fontWeight: pg === page ? 700 : 400, color: pg === page ? 'var(--text)' : 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                    }}>{pg + 1}</button>
                  );
                })
            }
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              style={{ ...glassInner({ padding: '4px 7px', borderRadius: 7 }), border: 'none', cursor: page >= totalPages - 1 ? 'default' : 'pointer', color: page >= totalPages - 1 ? '#D6D3D1' : 'var(--text-mid)', display: 'flex', alignItems: 'center' }}><ChevronRight size={13} /></button>
            <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
              style={{ ...glassInner({ padding: '4px 8px', borderRadius: 7 }), border: 'none', cursor: page >= totalPages - 1 ? 'default' : 'pointer', fontSize: 10, color: page >= totalPages - 1 ? '#D6D3D1' : 'var(--text-mid)', fontFamily: 'var(--font)' }}>»</button>
          </div>
        </div>
      </div>

    </div>
  );
}
