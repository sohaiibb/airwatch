import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { glass, glassInner } from '../lib/utils';
import {
  Settings as SettingsIcon, Save, Mail, Bell, Shield, Database,
  User, Wifi, WifiOff, Copy, Check, ChevronDown, Trash2,
  RefreshCw, Download, AlertTriangle, Eye, EyeOff, MessageSquare,
  Plus, X, Clock, Loader2,
} from 'lucide-react';

const BACKEND = import.meta.env.VITE_BACKEND_URL || '';

const TIMEZONES = [
  { label: 'Asia/Riyadh (GMT+3)', value: 'Asia/Riyadh' },
  { label: 'UTC (GMT+0)', value: 'UTC' },
  { label: 'Europe/London (GMT+0/+1)', value: 'Europe/London' },
  { label: 'America/New_York (GMT-5/-4)', value: 'America/New_York' },
  { label: 'America/Los_Angeles (GMT-8/-7)', value: 'America/Los_Angeles' },
  { label: 'Asia/Dubai (GMT+4)', value: 'Asia/Dubai' },
  { label: 'Asia/Karachi (GMT+5)', value: 'Asia/Karachi' },
];

const NCEC_DEFAULTS = [
  { pollutant: 'CO',    period: '1-hour',  unit: 'µg/m³', ncec: 40000, key: 'co_1hr',    dbPollutant: 'co',   dbPeriod: '1-hour'  },
  { pollutant: 'CO',    period: '8-hour',  unit: 'µg/m³', ncec: 10000, key: 'co_8hr',    dbPollutant: 'co',   dbPeriod: '8-hour'  },
  { pollutant: 'NO₂',  period: '1-hour',  unit: 'µg/m³', ncec: 200,   key: 'no2_1hr',   dbPollutant: 'no2',  dbPeriod: '1-hour'  },
  { pollutant: 'NO₂',  period: '1-year',  unit: 'µg/m³', ncec: 100,   key: 'no2_1yr',   dbPollutant: 'no2',  dbPeriod: '1-year'  },
  { pollutant: 'SO₂',  period: '1-hour',  unit: 'µg/m³', ncec: 441,   key: 'so2_1hr',   dbPollutant: 'so2',  dbPeriod: '1-hour'  },
  { pollutant: 'SO₂',  period: '24-hour', unit: 'µg/m³', ncec: 217,   key: 'so2_24hr',  dbPollutant: 'so2',  dbPeriod: '24-hour' },
  { pollutant: 'SO₂',  period: '1-year',  unit: 'µg/m³', ncec: 65,    key: 'so2_1yr',   dbPollutant: 'so2',  dbPeriod: '1-year'  },
  { pollutant: 'O₃',   period: '8-hour',  unit: 'µg/m³', ncec: 157,   key: 'o3_8hr',    dbPollutant: 'o3',   dbPeriod: '8-hour'  },
  { pollutant: 'PM₁₀', period: '24-hour', unit: 'µg/m³', ncec: 340,   key: 'pm10_24hr', dbPollutant: 'pm10', dbPeriod: '24-hour' },
  { pollutant: 'PM₁₀', period: '1-year',  unit: 'µg/m³', ncec: 50,    key: 'pm10_1yr',  dbPollutant: 'pm10', dbPeriod: '1-year'  },
  { pollutant: 'PM₂.₅',period: '24-hour', unit: 'µg/m³', ncec: 35,    key: 'pm25_24hr', dbPollutant: 'pm25', dbPeriod: '24-hour' },
  { pollutant: 'PM₂.₅',period: '1-year',  unit: 'µg/m³', ncec: 15,    key: 'pm25_1yr',  dbPollutant: 'pm25', dbPeriod: '1-year'  },
];

// ── Reusable UI helpers ────────────────────────────────────────────────────────

function SectionCard({ title, icon: Icon, children, fullWidth = false, style = {} }) {
  return (
    <div style={{ ...glass({ padding: '24px' }), gridColumn: fullWidth ? '1 / -1' : undefined, animation: 'glassIn 0.4s ease both', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, paddingBottom: 14, borderBottom: '1px solid rgba(255,255,255,0.35)' }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(22,163,74,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={16} color="#16A34A" />
        </div>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-mid)', marginBottom: 5, letterSpacing: '0.02em' }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>{hint}</p>}
    </div>
  );
}

function Input({ value, onChange, type = 'text', placeholder, readOnly, disabled, style = {} }) {
  const [show, setShow] = useState(false);
  const isPass = type === 'password';
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={isPass && show ? 'text' : type}
        value={value ?? ''}
        onChange={e => onChange && onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={disabled}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: isPass ? '9px 36px 9px 12px' : '9px 12px',
          borderRadius: 10, border: '1px solid rgba(255,255,255,0.45)',
          background: readOnly || disabled ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.35)',
          fontSize: 13, fontFamily: 'var(--font)', color: readOnly ? 'var(--text-muted)' : 'var(--text)',
          outline: 'none', ...style,
        }}
      />
      {isPass && (
        <button type="button" onClick={() => setShow(s => !s)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-faint)' }}>
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      )}
    </div>
  );
}

function Select({ value, onChange, options, disabled }) {
  return (
    <div style={{ position: 'relative' }}>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        style={{ width: '100%', padding: '9px 32px 9px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.35)', fontSize: 13, fontFamily: 'var(--font)', color: 'var(--text)', outline: 'none', appearance: 'none' }}
      >
        {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
      </select>
      <ChevronDown size={13} color="#78716C" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
    </div>
  );
}

function Toggle({ value, onChange, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
      <span style={{ fontSize: 13, color: 'var(--text-mid)' }}>{label}</span>
      <button onClick={() => onChange(!value)} style={{ width: 40, height: 22, borderRadius: 11, border: 'none', background: value ? '#16A34A' : '#D6D3D1', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 3, left: value ? 20 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
      </button>
    </div>
  );
}

function SaveBtn({ onClick, status, label = 'Save' }) {
  return (
    <button onClick={onClick} disabled={status === 'saving'} style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 20, padding: '9px 20px', borderRadius: 10, border: 'none', background: status === 'saved' ? 'rgba(22,163,74,0.15)' : 'rgba(22,163,74,0.12)', color: '#16A34A', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font)', cursor: status === 'saving' ? 'default' : 'pointer', transition: 'background 0.2s' }}>
      {status === 'saving' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : status === 'saved' ? <Check size={14} /> : <Save size={14} />}
      {status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving…' : label}
    </button>
  );
}

function StatusBadge({ active }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: active ? 'rgba(22,163,74,0.12)' : 'rgba(234,88,12,0.10)', color: active ? '#16A34A' : '#EA580C', letterSpacing: '0.04em' }}>
      {active ? '● Active' : '● Not Configured'}
    </span>
  );
}

// ── Push Notifications Component ──────────────────────────────────────────────

function PushNotificationSection() {
  const [permission, setPermission] = useState(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState('');
  const [notifyExceed, setNotifyExceed] = useState(() => localStorage.getItem('aw-push-exceed') !== 'false');
  const [notifyWarning, setNotifyWarning] = useState(() => localStorage.getItem('aw-push-warning') === 'true');
  const [notifyCleared, setNotifyCleared] = useState(() => localStorage.getItem('aw-push-cleared') !== 'false');

  async function handleEnable() {
    if (!('Notification' in window)) { setTestMsg('Push notifications not supported in this browser.'); return; }
    const perm = await Notification.requestPermission();
    setPermission(perm);
    if (perm === 'granted') {
      localStorage.setItem('airwatch-push-enabled', '1');
      localStorage.removeItem('airwatch-push-dismissed');
      setTestMsg('Push notifications enabled!');
    } else {
      setTestMsg('Permission denied. Check browser settings.');
    }
  }

  async function handleTest() {
    if (permission !== 'granted') { setTestMsg('Enable push notifications first.'); return; }
    setTesting(true);
    try {
      new Notification('AirWatch Test', {
        body: 'Push notifications are working correctly.',
        icon: '/favicon.svg',
      });
      setTestMsg('Test notification sent!');
    } catch (e) {
      setTestMsg('Failed: ' + e.message);
    }
    setTesting(false);
    setTimeout(() => setTestMsg(''), 3000);
  }

  const enabled = permission === 'granted';
  const statusColor = enabled ? '#16A34A' : permission === 'denied' ? '#DC2626' : '#F59E0B';
  const statusLabel = enabled ? 'Enabled' : permission === 'denied' ? 'Blocked' : permission === 'unsupported' ? 'Not Supported' : 'Not Enabled';

  return (
    <div>
      {/* Status + enable */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, padding: '12px 16px', borderRadius: 12, background: enabled ? 'rgba(22,163,74,0.08)' : 'rgba(0,0,0,0.03)', border: `1px solid ${enabled ? 'rgba(22,163,74,0.2)' : 'var(--border)'}` }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: statusColor, boxShadow: enabled ? '0 0 8px rgba(22,163,74,0.4)' : 'none', flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: statusColor, margin: 0 }}>{statusLabel}</p>
          <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '2px 0 0' }}>
            {enabled ? 'Browser will receive real-time exceedance alerts' : 'Click Enable to get real-time alerts'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!enabled && permission !== 'unsupported' && (
            <button onClick={handleEnable} style={{ padding: '7px 16px', borderRadius: 9, border: 'none', background: '#0d9488', color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font)', cursor: 'pointer' }}>
              Enable Push
            </button>
          )}
          {enabled && (
            <button onClick={handleTest} disabled={testing} style={{ padding: '7px 16px', borderRadius: 9, border: 'none', background: 'rgba(13,148,136,0.12)', color: '#0d9488', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font)', cursor: testing ? 'not-allowed' : 'pointer', opacity: testing ? 0.6 : 1 }}>
              Send Test
            </button>
          )}
        </div>
      </div>

      {testMsg && (
        <p style={{ fontSize: 12, color: testMsg.includes('!') ? '#16A34A' : '#DC2626', margin: '-12px 0 16px', fontWeight: 500 }}>{testMsg}</p>
      )}

      {/* Notification preferences */}
      <div style={{ opacity: enabled ? 1 : 0.5, pointerEvents: enabled ? 'auto' : 'none' }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', margin: '0 0 12px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Notification Preferences</p>
        <Toggle value={notifyExceed} onChange={v => { setNotifyExceed(v); localStorage.setItem('aw-push-exceed', String(v)); }} label="Notify on NCEC exceedances (recommended)" />
        <Toggle value={notifyWarning} onChange={v => { setNotifyWarning(v); localStorage.setItem('aw-push-warning', String(v)); }} label="Notify at 80% of limit (early warning)" />
        <Toggle value={notifyCleared} onChange={v => { setNotifyCleared(v); localStorage.setItem('aw-push-cleared', String(v)); }} label="Notify when alert clears" />
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '16px 0 0', lineHeight: 1.5 }}>
        Push notifications require a modern browser (Chrome, Firefox, Edge). Safari on iOS 16.4+ is supported.
        Notifications are delivered directly to your browser — no SMS or email required.
      </p>
    </div>
  );
}

// ── Main Settings Component ────────────────────────────────────────────────────

export default function Settings({ profile }) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [stations, setStations] = useState([]);

  // General
  const [gen, setGen] = useState({ platformName: 'AirWatch', orgName: 'Hills and Field Company Limited', timezone: 'Asia/Riyadh', dateFormat: 'DD/MM/YYYY', defaultStation: '', refreshRate: '30' });
  const [genStatus, setGenStatus] = useState('');

  // Email
  const [emailProvider, setEmailProvider] = useState('gmail');
  const [emailConfig, setEmailConfig] = useState({ smtp_host: 'smtp.gmail.com', smtp_port: 587, smtp_user: '', smtp_pass: '', from_email: '', resend_api_key: '', custom_host: '', custom_port: 465, custom_user: '', custom_pass: '', custom_from: '', custom_encryption: 'TLS' });
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [emailStatus, setEmailStatus] = useState('');
  const [emailTestResult, setEmailTestResult] = useState(null);
  const [emailSaved, setEmailSaved] = useState(false);

  // Alert preferences
  const [prefs, setPrefs] = useState({ warning_threshold: 80, cooldown_hours: 1, escalation_hours: 4, daily_cap: 24, send_cleared: true, send_warning: true, batch_alerts: true });
  const [prefsStatus, setPrefsStatus] = useState('');

  // NCEC rules
  const [ncecRules, setNcecRules] = useState([]);
  const [ncecStatus, setNcecStatus] = useState('');
  const [customRuleForm, setCustomRuleForm] = useState({ show: false, pollutant: '', period: '', threshold: '', unit: 'µg/m³' });

  // Data stats
  const [dataStats, setDataStats] = useState(null);
  const [exportLoading, setExportLoading] = useState(false);

  // Backfill
  const [bf, setBf] = useState({ stationId: '', fromDate: '', toDate: '', loading: false, result: null });

  // Clear old data
  const [clearMonths, setClearMonths] = useState('12');
  const [clearLoading, setClearLoading] = useState(false);
  const [clearModal, setClearModal] = useState(false);
  const [clearResult, setClearResult] = useState(null);

  // User / password
  const [displayName, setDisplayName] = useState(profile?.full_name || '');
  const [nameStatus, setNameStatus] = useState('');
  const [pwForm, setPwForm] = useState({ show: false, newPw: '', confirmPw: '', loading: false, result: null });

  // API
  const [apiConnected, setApiConnected] = useState(null);
  const [copied, setCopied] = useState(false);

  // ── Init ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    // Stations
    const { data: st } = await supabase.from('stations').select('id,name').eq('is_active', true).order('name');
    setStations(st || []);

    // All settings
    const { data: rows } = await supabase.from('system_settings').select('key,value');
    if (rows) {
      const map = {};
      rows.forEach(r => { map[r.key] = r.value; });

      if (map.platform_settings) setGen(g => ({ ...g, ...map.platform_settings }));

      if (map.email_config) {
        const ec = map.email_config;
        setEmailProvider(ec.provider || 'gmail');
        setEmailConfig(cfg => ({ ...cfg, ...ec }));
        setEmailConfigured(!!ec.configured);
      }

      if (map.alert_preferences) setPrefs(p => ({ ...p, ...map.alert_preferences }));
    }

    // NCEC rules from alert_rules
    const { data: rules } = await supabase.from('alert_rules').select('*').is('station_id', null).order('pollutant');
    if (rules) setNcecRules(rules);

    // Data stats
    const { count } = await supabase.from('readings').select('id', { count: 'exact', head: true });
    const { data: earliest } = await supabase.from('readings').select('timestamp').order('timestamp', { ascending: true }).limit(1);
    const { data: latest } = await supabase.from('readings').select('timestamp').order('timestamp', { ascending: false }).limit(1);
    setDataStats({
      count: count || 0,
      earliest: earliest?.[0]?.timestamp,
      latest: latest?.[0]?.timestamp,
    });

    // API health
    if (BACKEND) {
      fetch(`${BACKEND}/api/health`).then(r => setApiConnected(r.ok)).catch(() => setApiConnected(false));
    }
  }

  // ── Settings save helpers ─────────────────────────────────────────────────

  async function saveSetting(key, value) {
    if (!BACKEND) {
      // fallback: write directly (will fail if no write policy, but try)
      await supabase.from('system_settings').upsert({ key, value });
      return;
    }
    await fetch(`${BACKEND}/api/settings/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  }

  async function saveGen() {
    setGenStatus('saving');
    try {
      await saveSetting('platform_settings', gen);
      setGenStatus('saved');
      setTimeout(() => setGenStatus(''), 2500);
    } catch { setGenStatus(''); }
  }

  async function saveEmail() {
    setEmailStatus('saving');
    const payload = { provider: emailProvider, configured: true, ...emailConfig };
    try {
      const r = await fetch(`${BACKEND}/api/alerts/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (r.ok) { setEmailConfigured(true); setEmailSaved(true); setEmailStatus('saved'); setTimeout(() => setEmailStatus(''), 2500); }
    } catch { setEmailStatus(''); }
  }

  async function testEmail() {
    setEmailTestResult(null);
    if (!stations[0]) return;
    try {
      const r = await fetch(`${BACKEND}/api/alerts/test?station_id=${stations[0].id}`, { method: 'POST' });
      const d = await r.json();
      setEmailTestResult({ ok: r.ok, msg: d.message || (r.ok ? 'Test email queued' : 'Failed') });
    } catch (e) { setEmailTestResult({ ok: false, msg: e.message }); }
  }

  async function savePrefs() {
    setPrefsStatus('saving');
    try {
      await saveSetting('alert_preferences', prefs);
      setPrefsStatus('saved');
      setTimeout(() => setPrefsStatus(''), 2500);
    } catch { setPrefsStatus(''); }
  }

  function getNcecRow(def) {
    return ncecRules.find(r => r.pollutant === def.dbPollutant && r.period === def.dbPeriod) || null;
  }

  async function saveNcecRule(ruleId, updates) {
    if (!BACKEND) return;
    await fetch(`${BACKEND}/api/alerts/rules/${ruleId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
  }

  async function handleNcecToggle(def, val) {
    const row = getNcecRow(def);
    if (!row) return;
    setNcecRules(rs => rs.map(r => r.id === row.id ? { ...r, enabled: val } : r));
    await saveNcecRule(row.id, { enabled: val });
  }

  async function handleNcecThreshold(def, val) {
    const row = getNcecRow(def);
    if (!row) return;
    const num = parseFloat(val);
    setNcecRules(rs => rs.map(r => r.id === row.id ? { ...r, threshold: isNaN(num) ? r.threshold : num } : r));
  }

  async function saveNcecAll() {
    setNcecStatus('saving');
    try {
      await Promise.all(ncecRules.filter(r => !r.station_id).map(r => saveNcecRule(r.id, { threshold: r.threshold, enabled: r.enabled })));
      setNcecStatus('saved');
      setTimeout(() => setNcecStatus(''), 2500);
    } catch { setNcecStatus(''); }
  }

  async function resetNcecDefaults() {
    const updated = [...ncecRules];
    for (const def of NCEC_DEFAULTS) {
      const row = updated.find(r => r.pollutant === def.dbPollutant && r.period === def.dbPeriod);
      if (row) {
        row.threshold = def.ncec;
        row.enabled = true;
        await saveNcecRule(row.id, { threshold: def.ncec, enabled: true });
      }
    }
    setNcecRules([...updated]);
  }

  async function addCustomRule() {
    if (!customRuleForm.pollutant || !customRuleForm.threshold) return;
    if (!BACKEND) return;
    const r = await fetch(`${BACKEND}/api/alerts/rules`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pollutant: customRuleForm.pollutant, period: customRuleForm.period || '24-hour', threshold: parseFloat(customRuleForm.threshold), warning_pct: 80 }) });
    const newRule = await r.json();
    setNcecRules(rs => [...rs, newRule]);
    setCustomRuleForm({ show: false, pollutant: '', period: '', threshold: '', unit: 'µg/m³' });
  }

  // ── Data management ────────────────────────────────────────────────────────

  async function exportAllData() {
    setExportLoading(true);
    const { data } = await supabase.from('readings').select('*').order('timestamp', { ascending: true });
    if (data) {
      const keys = Object.keys(data[0] || {});
      const csv = [keys.join(','), ...data.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(','))].join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = `airwatch-readings-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
    }
    setExportLoading(false);
  }

  async function startBackfill() {
    if (!bf.stationId || !bf.fromDate || !BACKEND) return;
    setBf(b => ({ ...b, loading: true, result: null }));
    try {
      const r = await fetch(`${BACKEND}/api/backfill/${bf.stationId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from_date: bf.fromDate, to_date: bf.toDate || undefined }) });
      const d = await r.json();
      setBf(b => ({ ...b, loading: false, result: d }));
    } catch (e) { setBf(b => ({ ...b, loading: false, result: { error: e.message } })); }
  }

  async function clearOldData() {
    setClearLoading(true);
    setClearModal(false);
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - parseInt(clearMonths));
    const { error, count } = await supabase.from('readings').delete({ count: 'exact' }).lt('timestamp', cutoff.toISOString());
    setClearResult(error ? { ok: false, msg: error.message } : { ok: true, msg: `${count ?? '?'} readings deleted` });
    setClearLoading(false);
    loadAll();
  }

  // ── User management ───────────────────────────────────────────────────────

  async function saveName() {
    setNameStatus('saving');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('profiles').update({ full_name: displayName }).eq('id', user.id);
    setNameStatus('saved');
    setTimeout(() => setNameStatus(''), 2500);
  }

  async function changePassword() {
    if (pwForm.newPw !== pwForm.confirmPw) { setPwForm(f => ({ ...f, result: { ok: false, msg: 'Passwords do not match' } })); return; }
    if (pwForm.newPw.length < 6) { setPwForm(f => ({ ...f, result: { ok: false, msg: 'Minimum 6 characters' } })); return; }
    setPwForm(f => ({ ...f, loading: true, result: null }));
    const { error } = await supabase.auth.updateUser({ password: pwForm.newPw });
    setPwForm(f => ({ ...f, loading: false, result: error ? { ok: false, msg: error.message } : { ok: true, msg: 'Password updated' }, newPw: '', confirmPw: '' }));
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  function copyUrl() {
    navigator.clipboard.writeText(BACKEND);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  const grid = { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20 };
  const twoCol = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };
  const row = { display: 'flex', alignItems: 'center', gap: 12 };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ width: '100%' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: isMobile ? 22 : 26, fontWeight: 800, letterSpacing: '-0.03em', margin: 0 }}>Settings</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Platform configuration and preferences</p>
      </div>

      <div style={grid}>

        {/* ── SECTION 1: General Settings ──────────────────────────────────── */}
        <SectionCard title="Platform Settings" icon={SettingsIcon}>
          <Field label="Platform Name">
            <Input value={gen.platformName} onChange={v => setGen(g => ({ ...g, platformName: v }))} />
          </Field>
          <Field label="Organization Name">
            <Input value={gen.orgName} onChange={v => setGen(g => ({ ...g, orgName: v }))} />
          </Field>
          <Field label="Timezone">
            <Select value={gen.timezone} onChange={v => setGen(g => ({ ...g, timezone: v }))} options={TIMEZONES} />
          </Field>
          <div style={twoCol}>
            <Field label="Date Format">
              <Select value={gen.dateFormat} onChange={v => setGen(g => ({ ...g, dateFormat: v }))} options={['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']} />
            </Field>
            <Field label="Data Refresh Rate">
              <Select value={gen.refreshRate} onChange={v => setGen(g => ({ ...g, refreshRate: v }))} options={[{ value: '5', label: '5 seconds' }, { value: '10', label: '10 seconds' }, { value: '30', label: '30 seconds' }, { value: '60', label: '1 minute' }, { value: '300', label: '5 minutes' }]} />
            </Field>
          </div>
          <Field label="Default Station">
            <Select value={gen.defaultStation} onChange={v => setGen(g => ({ ...g, defaultStation: v }))} options={[{ value: '', label: 'Auto (first station)' }, ...stations.map(s => ({ value: s.id, label: s.name }))]} />
          </Field>
          <SaveBtn onClick={saveGen} status={genStatus} />
        </SectionCard>

        {/* ── SECTION 2: Email Configuration ───────────────────────────────── */}
        <SectionCard title="Email Alerts Configuration" icon={Mail}>
          <div style={{ ...row, marginBottom: 18 }}>
            <StatusBadge active={emailConfigured} />
          </div>

          {/* Provider radio */}
          <Field label="Email Provider">
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {[['gmail', 'Gmail SMTP'], ['resend', 'Resend API'], ['custom', 'Custom SMTP']].map(([val, lbl]) => (
                <button key={val} onClick={() => setEmailProvider(val)} style={{ padding: '7px 14px', borderRadius: 20, border: `1.5px solid ${emailProvider === val ? '#16A34A' : 'rgba(255,255,255,0.5)'}`, background: emailProvider === val ? 'rgba(22,163,74,0.10)' : 'rgba(255,255,255,0.25)', color: emailProvider === val ? '#16A34A' : 'var(--text-mid)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font)', cursor: 'pointer' }}>
                  {lbl}
                </button>
              ))}
            </div>
          </Field>

          {emailProvider === 'gmail' && <>
            <div style={twoCol}>
              <Field label="SMTP Host"><Input value="smtp.gmail.com" readOnly /></Field>
              <Field label="Port"><Input value="587" readOnly /></Field>
            </div>
            <Field label="Gmail Address"><Input value={emailConfig.smtp_user} onChange={v => setEmailConfig(c => ({ ...c, smtp_user: v }))} placeholder="you@gmail.com" /></Field>
            <Field label="App Password" hint="Use Gmail App Password, not your regular password"><Input type="password" value={emailConfig.smtp_pass} onChange={v => setEmailConfig(c => ({ ...c, smtp_pass: v }))} placeholder="xxxx xxxx xxxx xxxx" /></Field>
            <Field label="From Email"><Input value={emailConfig.from_email} onChange={v => setEmailConfig(c => ({ ...c, from_email: v }))} placeholder="alerts@yourcompany.com" /></Field>
          </>}

          {emailProvider === 'resend' && <>
            <Field label="API Key" hint="Get your key from resend.com/api-keys"><Input type="password" value={emailConfig.resend_api_key} onChange={v => setEmailConfig(c => ({ ...c, resend_api_key: v }))} placeholder="re_..." /></Field>
            <Field label="From Email"><Input value={emailConfig.from_email} onChange={v => setEmailConfig(c => ({ ...c, from_email: v }))} placeholder="alerts@yourcompany.com" /></Field>
          </>}

          {emailProvider === 'custom' && <>
            <div style={twoCol}>
              <Field label="SMTP Host"><Input value={emailConfig.custom_host} onChange={v => setEmailConfig(c => ({ ...c, custom_host: v }))} placeholder="mail.server.com" /></Field>
              <Field label="Port"><Input type="number" value={emailConfig.custom_port} onChange={v => setEmailConfig(c => ({ ...c, custom_port: v }))} /></Field>
            </div>
            <div style={twoCol}>
              <Field label="Username"><Input value={emailConfig.custom_user} onChange={v => setEmailConfig(c => ({ ...c, custom_user: v }))} /></Field>
              <Field label="Password"><Input type="password" value={emailConfig.custom_pass} onChange={v => setEmailConfig(c => ({ ...c, custom_pass: v }))} /></Field>
            </div>
            <div style={twoCol}>
              <Field label="From Email"><Input value={emailConfig.custom_from} onChange={v => setEmailConfig(c => ({ ...c, custom_from: v }))} /></Field>
              <Field label="Encryption"><Select value={emailConfig.custom_encryption} onChange={v => setEmailConfig(c => ({ ...c, custom_encryption: v }))} options={['TLS', 'SSL', 'None']} /></Field>
            </div>
          </>}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 20 }}>
            <SaveBtn onClick={saveEmail} status={emailStatus} label="Save Configuration" />
            <button onClick={testEmail} disabled={!emailSaved && !emailConfigured} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 10, border: 'none', background: (!emailSaved && !emailConfigured) ? 'rgba(0,0,0,0.05)' : 'rgba(59,130,246,0.10)', color: (!emailSaved && !emailConfigured) ? 'var(--text-faint)' : '#3B82F6', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font)', cursor: (!emailSaved && !emailConfigured) ? 'default' : 'pointer' }}>
              <Mail size={14} /> Send Test
            </button>
          </div>
          {emailTestResult && (
            <p style={{ marginTop: 10, fontSize: 12, color: emailTestResult.ok ? '#16A34A' : '#DC2626', fontWeight: 600 }}>
              {emailTestResult.ok ? '✓' : '✗'} {emailTestResult.msg}
            </p>
          )}
          <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 12 }}>Alert detection runs every 5 minutes regardless of email configuration.</p>
        </SectionCard>

        {/* ── SECTION 3: Alert Preferences ─────────────────────────────────── */}
        <SectionCard title="Alert Preferences" icon={Bell}>
          <Field label={`Warning Threshold: ${prefs.warning_threshold}%`} hint="Alert me when pollutants reach this % of the NCEC limit">
            <input type="range" min={50} max={95} value={prefs.warning_threshold} onChange={e => setPrefs(p => ({ ...p, warning_threshold: +e.target.value }))} style={{ width: '100%', accentColor: '#16A34A' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
              <span>50%</span><span>95%</span>
            </div>
          </Field>
          <div style={twoCol}>
            <Field label="Alert Cooldown">
              <Select value={String(prefs.cooldown_hours)} onChange={v => setPrefs(p => ({ ...p, cooldown_hours: +v }))} options={[{ value: '1', label: 'Every hour' }, { value: '2', label: 'Every 2 hours' }, { value: '3', label: 'Every 3 hours' }, { value: '6', label: 'Every 6 hours' }]} />
            </Field>
            <Field label="Escalation After">
              <Select value={String(prefs.escalation_hours)} onChange={v => setPrefs(p => ({ ...p, escalation_hours: +v }))} options={[{ value: '2', label: '2 hours' }, { value: '4', label: '4 hours' }, { value: '6', label: '6 hours' }, { value: '8', label: '8 hours' }]} />
            </Field>
          </div>
          <Field label="Daily Email Cap" hint="Maximum notifications per station per day">
            <Input type="number" value={prefs.daily_cap} onChange={v => setPrefs(p => ({ ...p, daily_cap: +v }))} style={{ width: 100 }} />
          </Field>
          <Toggle value={prefs.send_cleared} onChange={v => setPrefs(p => ({ ...p, send_cleared: v }))} label="Send Cleared Notifications" />
          <Toggle value={prefs.send_warning} onChange={v => setPrefs(p => ({ ...p, send_warning: v }))} label="Send Warning Notifications" />
          <Toggle value={prefs.batch_alerts} onChange={v => setPrefs(p => ({ ...p, batch_alerts: v }))} label="Batch Multiple Exceedances into One Email" />
          <SaveBtn onClick={savePrefs} status={prefsStatus} />
        </SectionCard>

        {/* ── SECTION 7: API & Integrations ────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <SectionCard title="API Access" icon={Wifi}>
            <Field label="Backend URL">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Input value={BACKEND || '(not configured)'} readOnly style={{ flex: 1 }} />
                <button onClick={copyUrl} style={{ padding: '9px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.35)', cursor: 'pointer', color: 'var(--text-mid)' }}>
                  {copied ? <Check size={14} color="#16A34A" /> : <Copy size={14} />}
                </button>
              </div>
            </Field>
            <Field label="API Status">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.25)', width: 'fit-content' }}>
                {apiConnected === null ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : apiConnected ? <Wifi size={14} color="#16A34A" /> : <WifiOff size={14} color="#DC2626" />}
                <span style={{ fontSize: 13, fontWeight: 600, color: apiConnected === null ? 'var(--text-faint)' : apiConnected ? '#16A34A' : '#DC2626' }}>
                  {apiConnected === null ? 'Checking…' : apiConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
            </Field>
            <button onClick={() => { setApiConnected(null); fetch(`${BACKEND}/api/health`).then(r => setApiConnected(r.ok)).catch(() => setApiConnected(false)); }} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 10, border: 'none', background: 'rgba(59,130,246,0.10)', color: '#3B82F6', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font)', cursor: 'pointer' }}>
              <RefreshCw size={13} /> Test Connection
            </button>
          </SectionCard>

          <SectionCard title="WhatsApp Integration" icon={MessageSquare}>
            <div style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: 'rgba(0,0,0,0.06)', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>Coming Soon</span>
            </div>
            <Field label="WhatsApp Number" hint="Stored for future use — WhatsApp delivery not yet active">
              <Input placeholder="+966 5X XXX XXXX" disabled />
            </Field>
            <p style={{ fontSize: 11, color: 'var(--text-faint)' }}>WhatsApp alert delivery will be available in a future update.</p>
          </SectionCard>
        </div>

        {/* ── SECTION 4: NCEC Standards — full width ───────────────────────── */}
        <SectionCard title="NCEC Threshold Configuration" icon={Shield} fullWidth>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, marginTop: -8 }}>
            Executive Regulation for Air Quality (Royal Decree M/165, Appendix 1). Custom overrides replace NCEC defaults for alert detection.
          </p>
          <div data-scroll-x style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', width: '100%' }}>
            <table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Pollutant', 'Period', 'Unit', 'NCEC Default', 'Custom Override', 'Enabled'].map(h => (
                    <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', padding: '6px 12px', borderBottom: '1px solid rgba(0,0,0,0.07)', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {NCEC_DEFAULTS.map((def, i) => {
                  const row = getNcecRow(def);
                  return (
                    <tr key={def.key} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.15)' }}>
                      <td style={{ padding: '8px 12px', fontSize: 13, fontWeight: 600 }}>{def.pollutant}</td>
                      <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>{def.period}</td>
                      <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>{def.unit}</td>
                      <td style={{ padding: '8px 12px', fontSize: 13, fontFamily: 'var(--mono)', color: 'var(--text-mid)' }}>{def.ncec.toLocaleString()}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <input
                          type="number"
                          value={row?.threshold ?? def.ncec}
                          onChange={e => handleNcecThreshold(def, e.target.value)}
                          style={{ width: 90, padding: '5px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.35)', fontSize: 12, fontFamily: 'var(--mono)', outline: 'none' }}
                        />
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <button onClick={() => handleNcecToggle(def, !(row?.enabled ?? true))} style={{ width: 36, height: 20, borderRadius: 10, border: 'none', background: (row?.enabled ?? true) ? '#16A34A' : '#D6D3D1', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}>
                          <span style={{ position: 'absolute', top: 2, left: (row?.enabled ?? true) ? 17 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {/* Custom rules not in NCEC_DEFAULTS */}
                {ncecRules.filter(r => r.is_custom).map((r, i) => (
                  <tr key={r.id} style={{ background: 'rgba(59,130,246,0.04)' }}>
                    <td style={{ padding: '8px 12px', fontSize: 13, fontWeight: 600 }}>{r.pollutant.toUpperCase()} <span style={{ fontSize: 10, color: '#3B82F6', fontWeight: 700 }}>CUSTOM</span></td>
                    <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>{r.period}</td>
                    <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>µg/m³</td>
                    <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-faint)' }}>—</td>
                    <td style={{ padding: '8px 12px', fontSize: 13, fontFamily: 'var(--mono)', color: 'var(--text-mid)' }}>{r.threshold}</td>
                    <td style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button onClick={() => handleNcecToggle({ dbPollutant: r.pollutant, dbPeriod: r.period }, !r.enabled)} style={{ width: 36, height: 20, borderRadius: 10, border: 'none', background: r.enabled ? '#16A34A' : '#D6D3D1', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}>
                        <span style={{ position: 'absolute', top: 2, left: r.enabled ? 17 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Add custom standard form */}
          {customRuleForm.show && (
            <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 12, background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)' }}>
              <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Add Custom Standard</p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div><label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Pollutant</label><Input value={customRuleForm.pollutant} onChange={v => setCustomRuleForm(f => ({ ...f, pollutant: v }))} placeholder="e.g. pb" style={{ width: 90 }} /></div>
                <div><label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Period</label><Input value={customRuleForm.period} onChange={v => setCustomRuleForm(f => ({ ...f, period: v }))} placeholder="24-hour" style={{ width: 100 }} /></div>
                <div><label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Threshold</label><Input type="number" value={customRuleForm.threshold} onChange={v => setCustomRuleForm(f => ({ ...f, threshold: v }))} placeholder="0" style={{ width: 90 }} /></div>
                <button onClick={addCustomRule} style={{ padding: '9px 14px', borderRadius: 10, border: 'none', background: 'rgba(22,163,74,0.12)', color: '#16A34A', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font)', cursor: 'pointer' }}>Add</button>
                <button onClick={() => setCustomRuleForm(f => ({ ...f, show: false }))} style={{ padding: '9px 10px', borderRadius: 10, border: 'none', background: 'rgba(0,0,0,0.06)', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={13} /></button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18, alignItems: 'center' }}>
            <SaveBtn onClick={saveNcecAll} status={ncecStatus} />
            <button onClick={resetNcecDefaults} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 10, border: 'none', background: 'rgba(0,0,0,0.05)', color: 'var(--text-mid)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font)', cursor: 'pointer' }}>
              <RefreshCw size={13} /> Reset to NCEC Defaults
            </button>
            <button onClick={() => setCustomRuleForm(f => ({ ...f, show: true }))} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 10, border: 'none', background: 'rgba(59,130,246,0.10)', color: '#3B82F6', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font)', cursor: 'pointer' }}>
              <Plus size={13} /> Add Custom Standard
            </button>
          </div>
        </SectionCard>

        {/* ── SECTION 5: Data Management — full width ──────────────────────── */}
        <SectionCard title="Data &amp; Storage" icon={Database} fullWidth>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
            {[
              { label: 'Total Readings', value: dataStats ? dataStats.count.toLocaleString() : '—', sub: 'readings stored' },
              { label: 'Earliest Record', value: dataStats?.earliest ? new Date(dataStats.earliest).toLocaleDateString() : '—', sub: '' },
              { label: 'Latest Record', value: dataStats?.latest ? new Date(dataStats.latest).toLocaleDateString() : '—', sub: '' },
              { label: 'Est. Storage', value: dataStats ? `~${Math.round(dataStats.count * 0.5 / 1024)} MB` : '—', sub: '~0.5 KB/row' },
            ].map(s => (
              <div key={s.label} style={{ ...glassInner(), padding: '12px 14px', borderRadius: 12 }}>
                <p style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 600, marginBottom: 4 }}>{s.label}</p>
                <p style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--mono)', margin: 0 }}>{s.value}</p>
                {s.sub && <p style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>{s.sub}</p>}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20 }}>
            {/* Export */}
            <div style={{ padding: '16px', borderRadius: 14, background: 'rgba(255,255,255,0.20)', border: '1px solid rgba(255,255,255,0.35)' }}>
              <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Export All Data</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>Download all readings as a CSV file.</p>
              <button onClick={exportAllData} disabled={exportLoading} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 10, border: 'none', background: 'rgba(22,163,74,0.12)', color: '#16A34A', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font)', cursor: exportLoading ? 'default' : 'pointer' }}>
                {exportLoading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={14} />}
                {exportLoading ? 'Exporting…' : 'Export CSV'}
              </button>
            </div>

            {/* Clear old data */}
            <div style={{ padding: '16px', borderRadius: 14, background: 'rgba(220,38,38,0.04)', border: '1px solid rgba(220,38,38,0.12)' }}>
              <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: '#DC2626' }}>Clear Old Data</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>Permanently delete readings older than:</p>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <Select value={clearMonths} onChange={setClearMonths} options={[{ value: '6', label: '6 months' }, { value: '12', label: '1 year' }, { value: '24', label: '2 years' }]} />
                <button onClick={() => setClearModal(true)} disabled={clearLoading} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 10, border: 'none', background: 'rgba(220,38,38,0.10)', color: '#DC2626', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font)', cursor: 'pointer' }}>
                  {clearLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={13} />} Delete
                </button>
              </div>
              {clearResult && <p style={{ fontSize: 12, marginTop: 8, color: clearResult.ok ? '#16A34A' : '#DC2626', fontWeight: 600 }}>{clearResult.ok ? '✓' : '✗'} {clearResult.msg}</p>}
            </div>
          </div>

          {/* Backfill */}
          <div style={{ marginTop: 20, padding: '16px', borderRadius: 14, background: 'rgba(255,255,255,0.20)', border: '1px solid rgba(255,255,255,0.35)' }}>
            <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Backfill Historical Data</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>Fetch historical readings from the EnggEnv API and store them in the database.</p>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <Field label="Station">
                <Select value={bf.stationId} onChange={v => setBf(b => ({ ...b, stationId: v }))} options={[{ value: '', label: 'Select station…' }, ...stations.map(s => ({ value: s.id, label: s.name }))]} />
              </Field>
              <Field label="From Date">
                <input type="date" value={bf.fromDate} onChange={e => setBf(b => ({ ...b, fromDate: e.target.value }))} style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.35)', fontSize: 13, fontFamily: 'var(--font)', outline: 'none', boxSizing: 'border-box' }} />
              </Field>
              <Field label="To Date (optional)">
                <input type="date" value={bf.toDate} onChange={e => setBf(b => ({ ...b, toDate: e.target.value }))} style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.35)', fontSize: 13, fontFamily: 'var(--font)', outline: 'none', boxSizing: 'border-box' }} />
              </Field>
            </div>
            <button onClick={startBackfill} disabled={!bf.stationId || !bf.fromDate || bf.loading} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 10, border: 'none', background: (!bf.stationId || !bf.fromDate) ? 'rgba(0,0,0,0.05)' : 'rgba(22,163,74,0.12)', color: (!bf.stationId || !bf.fromDate) ? 'var(--text-faint)' : '#16A34A', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font)', cursor: (!bf.stationId || !bf.fromDate || bf.loading) ? 'default' : 'pointer' }}>
              {bf.loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} />}
              {bf.loading ? 'Running Backfill…' : 'Start Backfill'}
            </button>
            {bf.result && !bf.result.error && (
              <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.20)' }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#16A34A', margin: '0 0 4px' }}>✓ Backfill complete: {bf.result.imported?.toLocaleString()} readings imported</p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>{bf.result.from_date} → {bf.result.to_date} · {bf.result.errors} errors</p>
              </div>
            )}
            {bf.result?.error && <p style={{ fontSize: 12, color: '#DC2626', marginTop: 8, fontWeight: 600 }}>✗ {bf.result.error}</p>}
          </div>
        </SectionCard>

        {/* ── SECTION 6: User Management ───────────────────────────────────── */}
        <SectionCard title="Account" icon={User}>
          <Field label="Display Name">
            <div style={{ display: 'flex', gap: 8 }}>
              <Input value={displayName} onChange={setDisplayName} style={{ flex: 1 }} />
              <button onClick={saveName} style={{ padding: '9px 12px', borderRadius: 10, border: 'none', background: nameStatus === 'saved' ? 'rgba(22,163,74,0.12)' : 'rgba(22,163,74,0.10)', color: '#16A34A', cursor: 'pointer' }}>
                {nameStatus === 'saving' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : nameStatus === 'saved' ? <Check size={14} /> : <Save size={14} />}
              </button>
            </div>
          </Field>
          <Field label="Email">
            <Input value={profile?.email || profile?.organizations?.name || '—'} readOnly />
          </Field>
          <Field label="Role">
            <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 20, background: 'rgba(22,163,74,0.10)', color: '#16A34A', letterSpacing: '0.04em' }}>
              {(profile?.role || 'viewer').toUpperCase()}
            </span>
          </Field>

          {/* Change password */}
          <button onClick={() => setPwForm(f => ({ ...f, show: !f.show }))} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 10, border: 'none', background: 'rgba(0,0,0,0.05)', color: 'var(--text-mid)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font)', cursor: 'pointer', marginBottom: pwForm.show ? 12 : 0 }}>
            <Shield size={13} /> {pwForm.show ? 'Cancel' : 'Change Password'}
          </button>

          {pwForm.show && (
            <div style={{ padding: '14px', borderRadius: 12, background: 'rgba(255,255,255,0.20)', border: '1px solid rgba(255,255,255,0.35)' }}>
              <Field label="New Password">
                <Input type="password" value={pwForm.newPw} onChange={v => setPwForm(f => ({ ...f, newPw: v }))} placeholder="Min 6 characters" />
              </Field>
              <Field label="Confirm Password">
                <Input type="password" value={pwForm.confirmPw} onChange={v => setPwForm(f => ({ ...f, confirmPw: v }))} placeholder="Repeat password" />
              </Field>
              <button onClick={changePassword} disabled={pwForm.loading} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 10, border: 'none', background: 'rgba(22,163,74,0.12)', color: '#16A34A', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font)', cursor: 'pointer' }}>
                {pwForm.loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={14} />} Update Password
              </button>
              {pwForm.result && <p style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: pwForm.result.ok ? '#16A34A' : '#DC2626' }}>{pwForm.result.ok ? '✓' : '✗'} {pwForm.result.msg}</p>}
            </div>
          )}

          <button onClick={handleSignOut} style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 16, padding: '9px 16px', borderRadius: 10, border: 'none', background: 'rgba(220,38,38,0.08)', color: '#DC2626', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font)', cursor: 'pointer', width: '100%', justifyContent: 'center' }}>
            Sign Out
          </button>
        </SectionCard>

        {/* Push Notifications */}
        <SectionCard title="Push Notifications" icon={Bell} fullWidth>
          <PushNotificationSection />
        </SectionCard>

      </div>

      {/* ── Confirmation Modal for Clear Old Data ──────────────────────────── */}
      {clearModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ ...glass({ padding: '28px 32px' }), maxWidth: 380, width: '100%', animation: 'glassIn 0.25s ease both' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <AlertTriangle size={20} color="#DC2626" />
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Confirm Deletion</h3>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 20, lineHeight: 1.5 }}>
              This will permanently delete all readings older than <strong>{clearMonths === '6' ? '6 months' : clearMonths === '12' ? '1 year' : '2 years'}</strong>. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setClearModal(false)} style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: 'rgba(0,0,0,0.07)', color: 'var(--text-mid)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font)', cursor: 'pointer' }}>Cancel</button>
              <button onClick={clearOldData} style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: 'rgba(220,38,38,0.12)', color: '#DC2626', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font)', cursor: 'pointer' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
