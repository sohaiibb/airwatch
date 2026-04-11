import { useState, useEffect } from 'react';
import { FileText, Download, Calendar, CheckCircle, XCircle, AlertTriangle, Loader2, Clock, Trash2 } from 'lucide-react';
import { getStations, getReadingsByDateRange } from '../lib/supabase';
import { glass, glassInner, POLLUTANTS, getAqiLevel, generateDemoHistory } from '../lib/utils';

const REPORT_TYPES = [
  { id: 'daily',   label: 'Daily Summary' },
  { id: 'weekly',  label: 'Weekly Summary' },
  { id: 'monthly', label: 'Monthly NCEC Compliance' },
];

function calcStats(readings, key) {
  const vals = readings.map(r => r[key]).filter(v => v != null && !isNaN(Number(v))).map(Number);
  if (!vals.length) return { avg: null, min: null, max: null };
  return {
    avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    min: Math.min(...vals),
    max: Math.max(...vals),
  };
}

function fmtN(v, d = 1) { return v != null ? Number(v).toFixed(d) : '—'; }
function fmtDate(s) { return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }

function buildReportHTML({ station, from, to, type, stats, aqiStats, readingCount, generatedAt }) {
  const typeMeta = REPORT_TYPES.find(t => t.id === type) || REPORT_TYPES[0];
  const aqiLvl = getAqiLevel(Math.round(aqiStats.avg || 0));
  const overallCompliant = stats.every(s => s.avg == null || s.avg <= s.threshold);

  const rows = stats.map(p => {
    const avg = p.avg != null ? fmtN(p.avg) : '—';
    const min = p.min != null ? fmtN(p.min) : '—';
    const max = p.max != null ? fmtN(p.max) : '—';
    const compliant = p.avg == null || p.avg <= p.threshold;
    const statusHtml = p.avg == null
      ? `<span style="color:#A8A29E;">No data</span>`
      : compliant
        ? `<span style="color:#16A34A;font-weight:700;">✓ Compliant</span>`
        : `<span style="color:#DC2626;font-weight:700;">✗ Exceeded</span>`;
    return `
      <tr style="background:${compliant ? '#fff' : '#FEF2F2'}">
        <td style="padding:9px 12px;border-bottom:1px solid #E7E5E4;font-weight:600;">${p.name}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #E7E5E4;color:#57534E;">${p.unit}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #E7E5E4;font-family:monospace;">${avg}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #E7E5E4;font-family:monospace;">${min}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #E7E5E4;font-family:monospace;">${max}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #E7E5E4;font-family:monospace;color:#57534E;">${fmtN(p.threshold, 0)}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #E7E5E4;">${statusHtml}</td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Air Quality Report — ${station.name} — ${fmtDate(from)} to ${fmtDate(to)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1C1917; background: #fff; padding: 48px 56px; font-size: 13px; }
  @media print { body { padding: 28px 36px; } .no-print { display: none !important; } }
  h1 { font-size: 22px; font-weight: 700; color: #1C1917; }
  h2 { font-size: 14px; font-weight: 700; color: #1C1917; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #16A34A; color: #fff; padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
  .section { margin-bottom: 32px; }
  .pill { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #E7E5E4; color: #78716C; font-size: 11px; display: flex; justify-content: space-between; }
  .print-btn { position: fixed; bottom: 32px; right: 32px; background: #16A34A; color: #fff; border: none; border-radius: 12px; padding: 12px 24px; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 20px rgba(22,163,74,0.35); display: flex; align-items: center; gap: 8px; }
  .print-btn:hover { background: #15803D; }
</style>
</head>
<body>

<!-- Print button (hidden on print) -->
<button class="print-btn no-print" onclick="window.print()">
  <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/></svg>
  Save as PDF
</button>

<!-- Header -->
<div class="section" style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:20px;border-bottom:3px solid #16A34A;">
  <div>
    <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#16A34A;text-transform:uppercase;margin-bottom:6px;">Hills and Field Company Limited</div>
    <h1>${typeMeta.label}</h1>
    <div style="color:#57534E;font-size:13px;margin-top:6px;">${station.name} &nbsp;·&nbsp; ${fmtDate(from)} – ${fmtDate(to)}</div>
  </div>
  <div style="text-align:right;">
    <div style="font-size:11px;color:#A8A29E;margin-bottom:4px;">Overall Compliance</div>
    <div style="font-size:18px;font-weight:700;color:${overallCompliant ? '#16A34A' : '#DC2626'}">
      ${overallCompliant ? '✓ Compliant' : '✗ Non-Compliant'}
    </div>
    <div style="font-size:10px;color:#A8A29E;margin-top:2px;">Per NCEC Executive Regulation</div>
  </div>
</div>

<!-- Summary boxes -->
<div class="section" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:24px;">
  ${[
    { label: 'Avg AQI', value: fmtN(aqiStats.avg, 0), sub: aqiLvl.label, color: aqiLvl.color },
    { label: 'Min AQI', value: fmtN(aqiStats.min, 0), sub: 'Best reading', color: '#16A34A' },
    { label: 'Max AQI', value: fmtN(aqiStats.max, 0), sub: 'Worst reading', color: '#DC2626' },
    { label: 'Data Points', value: readingCount, sub: 'Total readings', color: '#3B82F6' },
  ].map(b => `
    <div style="border:1px solid #E7E5E4;border-radius:10px;padding:14px 16px;border-top:3px solid ${b.color}">
      <div style="font-size:10px;color:#78716C;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">${b.label}</div>
      <div style="font-size:26px;font-weight:700;font-family:monospace;color:#1C1917;line-height:1;">${b.value}</div>
      <div style="font-size:11px;color:${b.color};font-weight:600;margin-top:3px;">${b.sub}</div>
    </div>`).join('')}
</div>

<!-- Pollutants table -->
<div class="section" style="margin-top:28px;">
  <h2>Pollutant Concentrations vs. NCEC Standards</h2>
  <table>
    <thead>
      <tr>
        <th>Pollutant</th><th>Unit</th><th>Average</th><th>Minimum</th><th>Maximum</th><th>NCEC Limit</th><th>Status</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="margin-top:8px;font-size:10px;color:#78716C;">
    Thresholds based on NCEC Executive Regulation on Air Quality Standards (Royal Decree M/165, 2019).
    CO threshold is 1-hour average; PM2.5/PM10 are 24-hour averages; SO₂, NO₂, O₃ are 1-hour averages.
  </div>
</div>

<!-- Meteorological summary -->
<div class="section">
  <h2>Meteorological Conditions</h2>
  <table>
    <thead>
      <tr><th>Parameter</th><th>Unit</th><th>Average</th><th>Minimum</th><th>Maximum</th></tr>
    </thead>
    <tbody>
      ${[
        { label: 'Temperature', key: 'temperature', unit: '°C' },
        { label: 'Relative Humidity', key: 'humidity', unit: '%' },
        { label: 'Wind Speed', key: 'wind_speed', unit: 'm/s' },
      ].map(m => {
        const s = calcStats([], m.key); // placeholder, overridden below
        return `<tr style="background:#fff">
          <td style="padding:9px 12px;border-bottom:1px solid #E7E5E4;font-weight:600;">${m.label}</td>
          <td style="padding:9px 12px;border-bottom:1px solid #E7E5E4;color:#57534E;">${m.unit}</td>
          <td style="padding:9px 12px;border-bottom:1px solid #E7E5E4;font-family:monospace;">METAVG_${m.key}</td>
          <td style="padding:9px 12px;border-bottom:1px solid #E7E5E4;font-family:monospace;">METMIN_${m.key}</td>
          <td style="padding:9px 12px;border-bottom:1px solid #E7E5E4;font-family:monospace;">METMAX_${m.key}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>
</div>

<!-- Footer -->
<div class="footer">
  <div>
    <strong>Hills and Field Company Limited</strong> · NCEC Type A Environmental Consultancy<br/>
    Report generated: ${new Date(generatedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
  </div>
  <div style="text-align:right;">
    Data source: AirWatch Monitoring Platform<br/>
    Station: ${station.name}
  </div>
</div>

</body>
</html>`;
}

// Build HTML with actual met stats substituted in
function buildReport(params) {
  const { readings, ...rest } = params;
  const metStats = ['temperature', 'humidity', 'wind_speed'].reduce((acc, key) => {
    acc[key] = calcStats(readings, key);
    return acc;
  }, {});

  let html = buildReportHTML(rest);
  ['temperature', 'humidity', 'wind_speed'].forEach(key => {
    const s = metStats[key];
    html = html
      .replace(`METAVG_${key}`, fmtN(s.avg))
      .replace(`METMIN_${key}`, fmtN(s.min))
      .replace(`METMAX_${key}`, fmtN(s.max));
  });
  return html;
}

// ═══ Reports Page ═══
export default function Reports({ profile }) {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const [stations, setStations] = useState([]);
  const [form, setForm] = useState({ stationId: '', from: weekAgo, to: today, type: 'weekly' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recentReports, setRecentReports] = useState([]);

  useEffect(() => {
    getStations().then(st => {
      if (st.length) {
        setStations(st);
        setForm(f => ({ ...f, stationId: st[0].id }));
      } else {
        // Demo mode
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

  async function generateReport(params = form) {
    if (!params.stationId || !params.from || !params.to) {
      setError('Please select a station and date range.');
      return;
    }
    if (new Date(params.to) < new Date(params.from)) {
      setError('"To" date must be after "From" date.');
      return;
    }
    setError('');
    setLoading(true);

    try {
      const station = stations.find(s => s.id === params.stationId) || { name: params.stationName || 'Unknown' };
      const isDemo = params.stationId.startsWith('demo-');

      let readings;
      if (isDemo) {
        const hours = Math.max(1, Math.ceil((new Date(params.to) - new Date(params.from)) / 3600000));
        readings = generateDemoHistory(Math.min(hours, 720));
      } else {
        readings = await getReadingsByDateRange(params.stationId, params.from + 'T00:00:00', params.to + 'T23:59:59');
      }

      const stats = POLLUTANTS.map(p => ({ ...p, ...calcStats(readings, p.key) }));
      const aqiStats = calcStats(readings, 'aqi');
      const generatedAt = new Date().toISOString();

      const html = buildReport({ station, from: params.from, to: params.to, type: params.type, stats, aqiStats, readingCount: readings.length, generatedAt, readings });

      const win = window.open('', '_blank', 'width=900,height=700');
      if (win) {
        win.document.write(html);
        win.document.close();
      }

      const entry = {
        id: Date.now(),
        stationId: params.stationId,
        stationName: station.name,
        from: params.from,
        to: params.to,
        type: params.type,
        readingCount: readings.length,
        generatedAt,
      };
      const updated = [entry, ...recentReports].slice(0, 8);
      setRecentReports(updated);
      localStorage.setItem('airwatch_reports', JSON.stringify(updated));
    } catch (e) {
      console.error(e);
      setError('Failed to generate report. Please try again.');
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
    transition: 'border-color 0.2s, box-shadow 0.2s',
  };
  const labelStyle = { fontSize: 11, fontWeight: 700, color: '#78716C', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6, display: 'block' };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Page header */}
      <div style={{ marginBottom: 24, animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) both' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.02em' }}>Reports</h1>
        <p style={{ color: '#78716C', fontSize: 13, margin: 0 }}>Generate NCEC compliance and air quality summary reports for Hills and Field clients.</p>
      </div>

      {/* Report generator form */}
      <div style={{ ...glass({ padding: '24px 28px' }), marginBottom: 20, animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.05s both' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={16} color="#16A34A" />Generate New Report
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
          {/* Station */}
          <div>
            <label style={labelStyle}>Station</label>
            <select
              value={form.stationId}
              onChange={e => setForm(f => ({ ...f, stationId: e.target.value }))}
              style={inputStyle}
            >
              {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {/* Date from */}
          <div>
            <label style={labelStyle}>From</label>
            <input
              type="date" value={form.from} max={form.to || today}
              onChange={e => setForm(f => ({ ...f, from: e.target.value }))}
              style={inputStyle}
            />
          </div>
          {/* Date to */}
          <div>
            <label style={labelStyle}>To</label>
            <input
              type="date" value={form.to} min={form.from} max={today}
              onChange={e => setForm(f => ({ ...f, to: e.target.value }))}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'flex-end' }}>
          {/* Report type */}
          <div>
            <label style={labelStyle}>Report Type</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {REPORT_TYPES.map(t => (
                <button key={t.id} onClick={() => setForm(f => ({ ...f, type: t.id }))} style={{
                  padding: '9px 16px', borderRadius: 10, border: '1px solid',
                  borderColor: form.type === t.id ? '#16A34A' : 'rgba(255,255,255,0.5)',
                  background: form.type === t.id ? 'rgba(22,163,74,0.1)' : 'rgba(255,255,255,0.35)',
                  color: form.type === t.id ? '#16A34A' : '#57534E',
                  fontSize: 12, fontWeight: form.type === t.id ? 700 : 500,
                  cursor: 'pointer', transition: 'all 0.2s', fontFamily: 'var(--font)',
                }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Generate button */}
          <button
            onClick={() => generateReport()}
            disabled={loading || !form.stationId}
            style={{
              padding: '10px 28px', borderRadius: 12, border: 'none',
              background: loading ? 'rgba(22,163,74,0.5)' : 'linear-gradient(135deg, #16A34A, #15803D)',
              color: '#fff', fontSize: 13, fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              boxShadow: '0 2px 16px rgba(22,163,74,0.3)', fontFamily: 'var(--font)',
              transition: 'opacity 0.2s',
            }}
          >
            {loading ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={15} />}
            {loading ? 'Generating…' : 'Generate Report'}
          </button>
        </div>

        {error && (
          <div style={{ ...glassInner({ padding: '8px 14px', marginTop: 14, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)' }), display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={13} color="#DC2626" />
            <span style={{ fontSize: 12, color: '#DC2626' }}>{error}</span>
          </div>
        )}

        <div style={{ ...glassInner({ padding: '10px 14px', marginTop: 16 }), display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <FileText size={13} color="#78716C" style={{ marginTop: 1, flexShrink: 0 }} />
          <p style={{ fontSize: 11, color: '#78716C', margin: 0, lineHeight: 1.5 }}>
            Reports open in a new tab with a <strong>Save as PDF</strong> button. Includes AQI summary, all pollutant averages,
            NCEC compliance status, and meteorological conditions. Data is sourced directly from the Supabase readings table.
          </p>
        </div>
      </div>

      {/* Recent reports */}
      {recentReports.length > 0 && (
        <div style={{ ...glass({ padding: '20px 24px' }), animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.1s both' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={15} color="#78716C" />Recent Reports
            </h2>
            <button onClick={clearHistory} style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8,
              border: 'none', background: 'rgba(220,38,38,0.07)', color: '#DC2626',
              fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)',
            }}>
              <Trash2 size={11} />Clear History
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recentReports.map((r, i) => {
              const typeMeta = REPORT_TYPES.find(t => t.id === r.type) || REPORT_TYPES[0];
              return (
                <div key={r.id} style={{
                  ...glassInner({ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }),
                  animation: `glassIn 0.4s cubic-bezier(.16,1,.3,1) ${i * 0.04}s both`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <FileText size={16} color="#16A34A" />
                    </div>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: '#1C1917' }}>{r.stationName}</p>
                      <p style={{ fontSize: 11, color: '#78716C', margin: '2px 0 0' }}>
                        {typeMeta.label} &nbsp;·&nbsp; {fmtDate(r.from)} – {fmtDate(r.to)}
                        &nbsp;·&nbsp; {r.readingCount} readings
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 10, color: '#A8A29E', fontFamily: 'var(--mono)' }}>
                      {new Date(r.generatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <button
                      onClick={() => generateReport({ stationId: r.stationId, stationName: r.stationName, from: r.from, to: r.to, type: r.type })}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8,
                        border: '1px solid rgba(22,163,74,0.3)', background: 'rgba(22,163,74,0.08)',
                        color: '#16A34A', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)',
                        transition: 'background 0.2s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(22,163,74,0.15)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(22,163,74,0.08)'}
                    >
                      <Download size={12} />Download
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
