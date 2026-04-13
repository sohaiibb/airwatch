import { useState, useEffect } from 'react';
import {
  Bell, CheckCircle, XCircle, AlertTriangle, Clock, Shield, Mail, Plus,
  Trash2, Settings, ChevronDown, ChevronUp, Loader2, Play, Users,
  Activity, ToggleLeft, ToggleRight, Send, Info, RefreshCw,
} from 'lucide-react';
import { supabase, getStations, getDemoStations } from '../lib/supabase';
import { glass, glassInner } from '../lib/utils';

// ─── Constants ────────────────────────────────────────────────────────────────

const TEAL = '#0d9488';
const TEAL_DARK = '#0f766e';

const POLLUTANT_META = {
  pm25: { label: 'PM₂.₅', unit: 'µg/m³', color: '#3B82F6' },
  pm10: { label: 'PM₁₀',  unit: 'µg/m³', color: '#8B5CF6' },
  so2:  { label: 'SO₂',   unit: 'µg/m³', color: '#F59E0B' },
  no2:  { label: 'NO₂',   unit: 'µg/m³', color: '#06B6D4' },
  o3:   { label: 'O₃',    unit: 'µg/m³', color: '#EC4899' },
  co:   { label: 'CO',    unit: 'µg/m³', color: '#10B981' },
};

const NCEC_DEFAULT_RULES = [
  { pollutant: 'pm25', period: '24-hour', threshold: 35,    warning_pct: 80, enabled: true, is_custom: false },
  { pollutant: 'pm10', period: '24-hour', threshold: 340,   warning_pct: 80, enabled: true, is_custom: false },
  { pollutant: 'so2',  period: '1-hour',  threshold: 441,   warning_pct: 80, enabled: true, is_custom: false },
  { pollutant: 'so2',  period: '24-hour', threshold: 217,   warning_pct: 80, enabled: true, is_custom: false },
  { pollutant: 'no2',  period: '1-hour',  threshold: 200,   warning_pct: 80, enabled: true, is_custom: false },
  { pollutant: 'o3',   period: '8-hour',  threshold: 157,   warning_pct: 80, enabled: true, is_custom: false },
  { pollutant: 'co',   period: '1-hour',  threshold: 40000, warning_pct: 80, enabled: true, is_custom: false },
  { pollutant: 'co',   period: '8-hour',  threshold: 10000, warning_pct: 80, enabled: true, is_custom: false },
];

const STATUS_META = {
  warning:   { label: 'Warning',    color: '#CA8A04', bg: 'rgba(202,138,4,0.10)',   icon: AlertTriangle },
  triggered: { label: 'Exceedance', color: '#DC2626', bg: 'rgba(220,38,38,0.10)',   icon: XCircle },
  ongoing:   { label: 'Ongoing',    color: '#DC2626', bg: 'rgba(220,38,38,0.10)',   icon: XCircle },
  escalated: { label: 'URGENT',     color: '#991B1B', bg: 'rgba(153,27,27,0.12)',   icon: AlertTriangle },
  cleared:   { label: 'Cleared',    color: '#16A34A', bg: 'rgba(22,163,74,0.10)',   icon: CheckCircle },
};

const ACTION_META = {
  notification_queued: { label: 'Notification queued', color: '#CA8A04', icon: Bell },
  state_change:        { label: 'State change',        color: '#3B82F6', icon: Activity },
  cleared:             { label: 'Cleared',             color: '#16A34A', icon: CheckCircle },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDT(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function fmtDuration(started_at, cleared_at) {
  const start = new Date(started_at);
  const end   = cleared_at ? new Date(cleared_at) : new Date();
  const mins  = Math.round((end - start) / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function pctOf(val, limit) {
  return Math.min(Math.round((val / limit) * 100), 999);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ActiveAlertCard({ event, stationName, isMobile }) {
  const meta = STATUS_META[event.status] || STATUS_META.triggered;
  const Icon = meta.icon;
  const pm   = POLLUTANT_META[event.pollutant] || { label: event.pollutant, unit: '', color: 'var(--text-muted)' };
  const pct  = event.measured_value != null ? pctOf(event.measured_value, event.threshold) : null;

  return (
    <div style={{
      ...glassInner({ padding: '14px 18px' }),
      background: meta.bg,
      border: `1px solid ${meta.color}30`,
      borderLeft: `4px solid ${meta.color}`,
      animation: 'glassIn 0.4s cubic-bezier(.16,1,.3,1) both',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon size={18} color={meta.color} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{pm.label}</span>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: meta.color + '20', color: meta.color, fontWeight: 700 }}>
                {meta.label}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{event.period}</span>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-mid)', margin: '3px 0 0' }}>
              {stationName} · Started {fmtDT(event.started_at)}
              {event.hour_count > 0 && ` · Hour ${event.hour_count}`}
            </p>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 20, fontWeight: 700, color: meta.color, margin: 0, lineHeight: 1 }}>
            {event.measured_value != null ? Number(event.measured_value).toFixed(1) : '—'}
            <span style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 400, marginLeft: 3 }}>{pm.unit}</span>
          </p>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '2px 0 0' }}>
            Limit: {event.threshold.toLocaleString()} {pm.unit}
            {pct != null && ` · ${pct}% of limit`}
          </p>
          {event.peak_value != null && (
            <p style={{ fontSize: 10, color: meta.color, margin: '1px 0 0', fontFamily: 'DM Mono, monospace' }}>
              Peak: {Number(event.peak_value).toFixed(1)}
            </p>
          )}
        </div>
      </div>
      {/* Progress bar */}
      {pct != null && (
        <div style={{ marginTop: 10, background: 'rgba(255,255,255,0.4)', borderRadius: 4, height: 5, overflow: 'hidden' }}>
          <div style={{
            width: `${Math.min(pct, 100)}%`, height: '100%', borderRadius: 4,
            background: pct >= 100 ? meta.color : `linear-gradient(90deg, ${pm.color}, ${meta.color})`,
            transition: 'width 0.8s',
          }} />
        </div>
      )}
    </div>
  );
}

function HistoryRow({ item }) {
  const meta = ACTION_META[item.action] || { label: item.action, color: 'var(--text-muted)', icon: Activity };
  const Icon = meta.icon;
  const d = item.details || {};
  const stationName = item.stations?.name || '—';

  return (
    <div style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: meta.color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
        <Icon size={14} color={meta.color} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
              {d.tier ? `${d.tier.charAt(0).toUpperCase() + d.tier.slice(1)} — ` : ''}{meta.label}
            </span>
            {d.subject && <p style={{ fontSize: 11, color: 'var(--text-mid)', margin: '2px 0 0' }}>{d.subject}</p>}
            {d.alerts?.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {d.alerts.map((a, i) => {
                  const pm = POLLUTANT_META[a.pollutant] || {};
                  return (
                    <span key={i} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, background: (pm.color || 'var(--text-muted)') + '15', color: pm.color || 'var(--text-muted)', fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>
                      {pm.label || a.pollutant} {a.measured != null ? Number(a.measured).toFixed(1) : ''}
                    </span>
                  );
                })}
              </div>
            )}
            {d.from !== undefined && (
              <p style={{ fontSize: 10, color: 'var(--text-faint)', margin: '2px 0 0', fontFamily: 'DM Mono, monospace' }}>
                {d.from ?? 'new'} → {d.to} · measured: {d.measured != null ? Number(d.measured).toFixed(1) : '—'}
              </p>
            )}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ fontSize: 10, color: 'var(--text-faint)', margin: 0, fontFamily: 'DM Mono, monospace', whiteSpace: 'nowrap' }}>{fmtDT(item.created_at)}</p>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '2px 0 0' }}>{stationName}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function RuleRow({ rule, onToggle, onWarnPctChange, isSaving }) {
  const pm = POLLUTANT_META[rule.pollutant] || { label: rule.pollutant, unit: 'µg/m³', color: 'var(--text-muted)' };
  const [localPct, setLocalPct] = useState(rule.warning_pct || 80);

  return (
    <tr style={{ background: rule.enabled ? 'transparent' : 'rgba(0,0,0,0.02)' }}>
      <td style={{ padding: '10px 12px', fontWeight: 700, color: pm.color, fontFamily: 'Instrument Sans, sans-serif', fontSize: 13 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: pm.color, flexShrink: 0 }} />
          {pm.label}
        </span>
      </td>
      <td style={{ padding: '10px 12px', fontSize: 12, fontFamily: 'DM Mono, monospace', color: 'var(--text-mid)' }}>{rule.period}</td>
      <td style={{ padding: '10px 12px', fontSize: 12, fontFamily: 'DM Mono, monospace', fontWeight: 700, color: 'var(--text)' }}>
        {Number(rule.threshold).toLocaleString()} {pm.unit}
      </td>
      <td style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range" min={50} max={95} step={5}
            value={localPct}
            onChange={e => setLocalPct(Number(e.target.value))}
            onMouseUp={() => onWarnPctChange(rule.id, localPct)}
            onTouchEnd={() => onWarnPctChange(rule.id, localPct)}
            style={{ width: 80, accentColor: TEAL }}
          />
          <span style={{ fontSize: 11, fontFamily: 'DM Mono, monospace', color: 'var(--text-mid)', minWidth: 30 }}>{localPct}%</span>
        </div>
      </td>
      <td style={{ padding: '10px 12px' }}>
        {rule.is_custom && (
          <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 10, background: 'rgba(139,92,246,0.1)', color: '#7C3AED', fontWeight: 700 }}>CUSTOM</span>
        )}
      </td>
      <td style={{ padding: '10px 12px' }}>
        <button
          onClick={() => onToggle(rule.id, !rule.enabled)}
          disabled={isSaving}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0' }}
        >
          {rule.enabled
            ? <ToggleRight size={22} color={TEAL} />
            : <ToggleLeft size={22} color="#D6D3D1" />
          }
          <span style={{ fontSize: 11, color: rule.enabled ? TEAL : 'var(--text-faint)', fontWeight: 600 }}>
            {rule.enabled ? 'On' : 'Off'}
          </span>
        </button>
      </td>
    </tr>
  );
}

// ═══ Main Alerts Page ═════════════════════════════════════════════════════════

export default function Alerts({ profile }) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  const [tab, setTab] = useState('status');
  const [stations, setStations] = useState([]);
  const [selStation, setSelStation] = useState('');
  const [isDemo, setIsDemo] = useState(false);

  // Status
  const [activeAlerts, setActiveAlerts] = useState([]);
  const [loadingActive, setLoadingActive] = useState(true);

  // History
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState({ action: 'all', pollutant: 'all' });
  const [histPage, setHistPage] = useState(0);
  const HIST_PAGE = 25;

  // Config — rules
  const [rules, setRules] = useState([]);
  const [loadingRules, setLoadingRules] = useState(true);
  const [savingRule, setSavingRule] = useState(null);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customRule, setCustomRule] = useState({ pollutant: 'pm25', period: '24-hour', threshold: '', warning_pct: 80 });
  const [savingCustom, setSavingCustom] = useState(false);

  // Config — email
  const [emailConfig, setEmailConfig] = useState({ provider: null, configured: false });
  const [emailFields, setEmailFields] = useState({});
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailMsg, setEmailMsg] = useState('');
  const [testingAlert, setTestingAlert] = useState(false);

  // Subscribers
  const [subscribers, setSubscribers] = useState([]);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [newSub, setNewSub] = useState({ email: '', name: '', station_id: '' });
  const [addingSubscriber, setAddingSubscriber] = useState(false);
  const [subMsg, setSubMsg] = useState('');

  // ── Load stations ──────────────────────────────────────────────────────────
  useEffect(() => {
    getStations().then(st => {
      if (st.length) { setStations(st); setSelStation(st[0].id); setIsDemo(false); }
      else { const d = getDemoStations(); setStations(d); setSelStation(d[0].id); setIsDemo(true); }
    });
  }, []);

  // ── Load active alerts ────────────────────────────────────────────────────
  useEffect(() => {
    if (!selStation) return;
    loadActiveAlerts();
  }, [selStation]);

  async function loadActiveAlerts() {
    setLoadingActive(true);
    if (isDemo) { setActiveAlerts([]); setLoadingActive(false); return; }
    try {
      const { data } = await supabase
        .from('alert_events')
        .select('*, stations(name)')
        .neq('status', 'cleared')
        .eq('station_id', selStation)
        .order('updated_at', { ascending: false });
      setActiveAlerts(data || []);
    } catch { setActiveAlerts([]); }
    setLoadingActive(false);
  }

  // ── Load history ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (tab !== 'history' || !selStation) return;
    loadHistory();
  }, [tab, selStation, historyFilter]);

  async function loadHistory() {
    setLoadingHistory(true);
    if (isDemo) { setHistory([]); setLoadingHistory(false); return; }
    try {
      let q = supabase
        .from('alert_log')
        .select('*, stations(name)')
        .eq('station_id', selStation)
        .order('created_at', { ascending: false })
        .limit(200);
      if (historyFilter.action !== 'all') q = q.eq('action', historyFilter.action);
      const { data } = await q;
      let rows = data || [];
      if (historyFilter.pollutant !== 'all') {
        rows = rows.filter(r => r.details?.alerts?.some(a => a.pollutant === historyFilter.pollutant)
          || r.details?.pollutant === historyFilter.pollutant);
      }
      setHistory(rows);
      setHistPage(0);
    } catch { setHistory([]); }
    setLoadingHistory(false);
  }

  // ── Load rules ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (tab !== 'config') return;
    loadRules();
    loadEmailConfig();
  }, [tab]);

  async function loadRules() {
    setLoadingRules(true);
    if (isDemo) { setRules(NCEC_DEFAULT_RULES.map((r, i) => ({ ...r, id: `demo-${i}` }))); setLoadingRules(false); return; }
    try {
      const { data } = await supabase
        .from('alert_rules')
        .select('*')
        .is('station_id', null)
        .order('pollutant');
      setRules(data?.length ? data : NCEC_DEFAULT_RULES.map((r, i) => ({ ...r, id: `demo-${i}` })));
    } catch { setRules(NCEC_DEFAULT_RULES.map((r, i) => ({ ...r, id: `demo-${i}` }))); }
    setLoadingRules(false);
  }

  async function loadEmailConfig() {
    if (isDemo) return;
    try {
      const { data } = await supabase.from('system_settings').select('value').eq('key', 'email_config').single();
      if (data?.value) { setEmailConfig(data.value); setEmailFields(data.value); }
    } catch {}
  }

  // ── Load subscribers ──────────────────────────────────────────────────────
  useEffect(() => {
    if (tab !== 'subscribers') return;
    loadSubscribers();
  }, [tab, selStation]);

  async function loadSubscribers() {
    setLoadingSubs(true);
    if (isDemo) { setSubscribers([]); setLoadingSubs(false); return; }
    try {
      const { data } = await supabase.from('alert_subscribers').select('*, stations(name)').order('created_at', { ascending: false });
      setSubscribers(data || []);
    } catch { setSubscribers([]); }
    setLoadingSubs(false);
  }

  // ── Rule actions ──────────────────────────────────────────────────────────
  async function toggleRule(ruleId, enabled) {
    if (isDemo || ruleId?.startsWith('demo-')) return;
    setSavingRule(ruleId);
    try { await supabase.from('alert_rules').update({ enabled }).eq('id', ruleId); } catch {}
    setRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled } : r));
    setSavingRule(null);
  }

  async function updateWarningPct(ruleId, warning_pct) {
    if (isDemo || ruleId?.startsWith('demo-')) return;
    try { await supabase.from('alert_rules').update({ warning_pct }).eq('id', ruleId); } catch {}
    setRules(prev => prev.map(r => r.id === ruleId ? { ...r, warning_pct } : r));
  }

  async function addCustomRule() {
    if (!customRule.threshold) return;
    setSavingCustom(true);
    try {
      const row = { ...customRule, threshold: parseFloat(customRule.threshold), station_id: selStation || null, is_custom: true };
      const { data } = await supabase.from('alert_rules').insert(row).select().single();
      setRules(prev => [...prev, data]);
      setShowCustomForm(false);
      setCustomRule({ pollutant: 'pm25', period: '24-hour', threshold: '', warning_pct: 80 });
    } catch {}
    setSavingCustom(false);
  }

  async function deleteRule(ruleId) {
    if (!confirm('Delete this custom rule?')) return;
    await supabase.from('alert_rules').delete().eq('id', ruleId);
    setRules(prev => prev.filter(r => r.id !== ruleId));
  }

  // ── Email config ──────────────────────────────────────────────────────────
  async function saveEmailConfig() {
    setSavingEmail(true); setEmailMsg('');
    try {
      const value = { ...emailConfig, ...emailFields, configured: !!emailFields.provider && emailFields.provider !== 'none' };
      await supabase.from('system_settings').upsert({ key: 'email_config', value });
      setEmailConfig(value);
      setEmailMsg('Saved successfully.');
    } catch { setEmailMsg('Error saving configuration.'); }
    setSavingEmail(false);
    setTimeout(() => setEmailMsg(''), 3000);
  }

  async function sendTestAlert() {
    setTestingAlert(true);
    const backendUrl = import.meta.env.VITE_BACKEND_URL;
    if (!backendUrl || !selStation) { setEmailMsg('Backend URL not configured or no station selected.'); setTestingAlert(false); return; }
    try {
      await fetch(`${backendUrl}/api/alerts/test?station_id=${selStation}`, { method: 'POST' });
      setEmailMsg('Test notification queued — check backend logs.');
    } catch { setEmailMsg('Failed to reach backend.'); }
    setTestingAlert(false);
    setTimeout(() => setEmailMsg(''), 4000);
  }

  // ── Subscribers ───────────────────────────────────────────────────────────
  async function addSubscriber(e) {
    e.preventDefault();
    if (!newSub.email) return;
    setAddingSubscriber(true); setSubMsg('');
    try {
      const row = { email: newSub.email, name: newSub.name || null, station_id: newSub.station_id || null, email_enabled: true, role: 'client' };
      const { data } = await supabase.from('alert_subscribers').insert(row).select('*, stations(name)').single();
      setSubscribers(prev => [data, ...prev]);
      setNewSub({ email: '', name: '', station_id: '' });
      setSubMsg('Subscriber added.');
    } catch { setSubMsg('Error adding subscriber.'); }
    setAddingSubscriber(false);
    setTimeout(() => setSubMsg(''), 3000);
  }

  async function removeSubscriber(id) {
    if (!confirm('Remove this subscriber?')) return;
    await supabase.from('alert_subscribers').delete().eq('id', id);
    setSubscribers(prev => prev.filter(s => s.id !== id));
  }

  async function toggleSubscriberEmail(id, email_enabled) {
    await supabase.from('alert_subscribers').update({ email_enabled }).eq('id', id);
    setSubscribers(prev => prev.map(s => s.id === id ? { ...s, email_enabled } : s));
  }

  // ── Shared styles ──────────────────────────────────────────────────────────
  const inp = {
    width: '100%', padding: '8px 11px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.5)',
    background: 'rgba(255,255,255,0.35)', fontSize: 12, color: 'var(--text)', fontFamily: 'var(--font)', outline: 'none',
  };
  const tabBtn = (active) => ({
    padding: '8px 16px', borderRadius: 9, border: 'none', cursor: 'pointer',
    background: active ? 'rgba(255,255,255,0.65)' : 'transparent',
    boxShadow: active ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
    fontSize: 12, fontWeight: active ? 700 : 500,
    color: active ? 'var(--text)' : 'var(--text-muted)',
    fontFamily: 'var(--font)', transition: 'all 0.2s',
    display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
  });

  // ── History page slices ────────────────────────────────────────────────────
  const histSlice = history.slice(histPage * HIST_PAGE, (histPage + 1) * HIST_PAGE);
  const histPages = Math.max(1, Math.ceil(history.length / HIST_PAGE));

  const stationName = stations.find(s => s.id === selStation)?.name || '—';

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ width: '100%' }}>

      {/* Page header */}
      <div style={{ marginBottom: 20, animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) both' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 3px', letterSpacing: '-0.02em' }}>Alerts</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
          NCEC exceedance detection, notifications, and subscriber management.
        </p>
      </div>

      {isDemo && (
        <div style={{ ...glassInner({ padding: '8px 16px', borderRadius: 10, marginBottom: 16, background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.25)' }), display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={14} color="#CA8A04" />
          <span style={{ fontSize: 12, color: '#CA8A04', fontWeight: 600 }}>Demo Mode — Connect Supabase and run the backend to receive real alerts</span>
        </div>
      )}

      {/* Controls row */}
      <div style={{ ...glass({ padding: '10px 14px', marginBottom: 16 }), display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.05s both' }}>
        {/* Station selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>Station</span>
          <select value={selStation} onChange={e => setSelStation(e.target.value)} style={{ ...inp, width: 'auto', minWidth: 160 }}>
            {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* Refresh */}
        <button onClick={loadActiveAlerts} style={{ ...glassInner({ padding: '6px 10px', borderRadius: 8 }), border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: TEAL }}>
          <RefreshCw size={12} /> Refresh
        </button>

        {/* Tab nav */}
        <div style={{ marginLeft: 'auto', ...glassInner({ padding: '3px 4px', borderRadius: 11 }), display: 'flex', gap: 2, overflowX: 'auto' }}>
          {[
            { id: 'status',      label: 'Status',      icon: Bell },
            { id: 'history',     label: 'History',     icon: Clock },
            { id: 'config',      label: 'Config',      icon: Settings },
            { id: 'subscribers', label: 'Subscribers', icon: Users },
          ].map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)} style={tabBtn(tab === id)}>
              <Icon size={12} />{!isMobile || tab === id ? label : ''}
            </button>
          ))}
        </div>
      </div>

      {/* ══ TAB: STATUS ══════════════════════════════════════════════════════ */}
      {tab === 'status' && (
        <div style={{ animation: 'glassIn 0.4s cubic-bezier(.16,1,.3,1) both' }}>
          {loadingActive ? (
            <div style={{ ...glass({ padding: '40px' }), textAlign: 'center' }}>
              <Loader2 size={24} color="#A8A29E" style={{ animation: 'spin 1s linear infinite', marginBottom: 8 }} />
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading alerts…</p>
            </div>
          ) : activeAlerts.length === 0 ? (
            <div style={{ ...glass({ padding: '40px', background: 'rgba(22,163,74,0.07)', border: '1px solid rgba(22,163,74,0.2)' }), textAlign: 'center' }}>
              <CheckCircle size={36} color="#16A34A" style={{ marginBottom: 12 }} />
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#16A34A', margin: '0 0 6px' }}>All Clear</h2>
              <p style={{ color: '#16A34A', fontSize: 13, margin: 0, opacity: 0.75 }}>
                No active alerts for {stationName}. All pollutants within NCEC limits.
              </p>
            </div>
          ) : (
            <>
              <div style={{ ...glassInner({ padding: '10px 14px', borderRadius: 10, marginBottom: 14, background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.2)' }), display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={15} color="#DC2626" />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#DC2626' }}>
                  {activeAlerts.length} Active Alert{activeAlerts.length !== 1 ? 's' : ''} — {stationName}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {activeAlerts.map(ev => (
                  <ActiveAlertCard key={ev.id} event={ev} stationName={ev.stations?.name || stationName} isMobile={isMobile} />
                ))}
              </div>
            </>
          )}

          {/* Quick stats */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12, marginTop: 16 }}>
            {[
              { label: 'Active Alerts',    value: activeAlerts.length,                             color: activeAlerts.length > 0 ? '#DC2626' : '#16A34A' },
              { label: 'Urgent (4h+)',     value: activeAlerts.filter(a => a.status === 'escalated').length, color: '#991B1B' },
              { label: 'Warnings',         value: activeAlerts.filter(a => a.status === 'warning').length,   color: '#CA8A04' },
              { label: 'Check Interval',   value: '5 min',                                         color: TEAL },
            ].map((s, i) => (
              <div key={i} style={{ ...glass({ padding: '14px 16px' }), animation: `glassIn 0.5s cubic-bezier(.16,1,.3,1) ${0.1 + i * 0.04}s both` }}>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px' }}>{s.label}</p>
                <p style={{ fontSize: 22, fontWeight: 700, color: s.color, margin: 0, fontFamily: 'DM Mono, monospace' }}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ TAB: HISTORY ═════════════════════════════════════════════════════ */}
      {tab === 'history' && (
        <div style={{ ...glass({ padding: '20px 22px' }), animation: 'glassIn 0.4s cubic-bezier(.16,1,.3,1) both' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
              <Clock size={14} color={TEAL} /> Alert History
            </h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select value={historyFilter.action} onChange={e => setHistoryFilter(p => ({ ...p, action: e.target.value }))}
                style={{ ...inp, width: 'auto', fontSize: 11 }}>
                <option value="all">All Actions</option>
                <option value="notification_queued">Notifications</option>
                <option value="state_change">State Changes</option>
              </select>
              <select value={historyFilter.pollutant} onChange={e => setHistoryFilter(p => ({ ...p, pollutant: e.target.value }))}
                style={{ ...inp, width: 'auto', fontSize: 11 }}>
                <option value="all">All Pollutants</option>
                {Object.entries(POLLUTANT_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>

          {loadingHistory ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <Loader2 size={22} color="#A8A29E" style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          ) : history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-faint)' }}>
              <Clock size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
              <p style={{ fontSize: 13, margin: 0 }}>No alert history for this station yet.</p>
              <p style={{ fontSize: 11, marginTop: 4 }}>Alerts will appear here once the backend starts monitoring.</p>
            </div>
          ) : (
            <>
              {histSlice.map(item => <HistoryRow key={item.id} item={item} />)}
              {histPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {histPage * HIST_PAGE + 1}–{Math.min((histPage + 1) * HIST_PAGE, history.length)} of {history.length}
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => setHistPage(p => Math.max(0, p - 1))} disabled={histPage === 0}
                      style={{ ...glassInner({ padding: '4px 10px', borderRadius: 7 }), border: 'none', cursor: 'pointer', fontSize: 11, color: histPage === 0 ? '#D6D3D1' : 'var(--text-mid)' }}>← Prev</button>
                    <button onClick={() => setHistPage(p => Math.min(histPages - 1, p + 1))} disabled={histPage >= histPages - 1}
                      style={{ ...glassInner({ padding: '4px 10px', borderRadius: 7 }), border: 'none', cursor: 'pointer', fontSize: 11, color: histPage >= histPages - 1 ? '#D6D3D1' : 'var(--text-mid)' }}>Next →</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ══ TAB: CONFIG ══════════════════════════════════════════════════════ */}
      {tab === 'config' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'glassIn 0.4s cubic-bezier(.16,1,.3,1) both' }}>

          {/* Rules table */}
          <div style={{ ...glass({ padding: '20px 22px' }) }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 2px', display: 'flex', alignItems: 'center', gap: 7 }}>
                  <Shield size={14} color={TEAL} /> NCEC Alert Rules
                </h2>
                <p style={{ color: 'var(--text-faint)', fontSize: 11, margin: 0 }}>Toggle detection on/off and adjust warning thresholds</p>
              </div>
              <button onClick={() => setShowCustomForm(p => !p)} style={{
                ...glassInner({ padding: '7px 13px', borderRadius: 10 }),
                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 12, fontWeight: 600, color: TEAL,
              }}>
                <Plus size={13} /> Add Custom Rule
              </button>
            </div>

            {loadingRules ? (
              <div style={{ textAlign: 'center', padding: '24px 0' }}><Loader2 size={20} color="#A8A29E" style={{ animation: 'spin 1s linear infinite' }} /></div>
            ) : (
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                  <thead>
                    <tr>
                      {['Pollutant', 'Period', 'NCEC Limit', 'Warning At', 'Type', 'Enabled'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', borderBottom: '1px solid rgba(0,0,0,0.07)', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map(rule => (
                      <RuleRow key={rule.id} rule={rule}
                        onToggle={toggleRule} onWarnPctChange={updateWarningPct}
                        isSaving={savingRule === rule.id} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Custom rule form */}
            {showCustomForm && (
              <div style={{ marginTop: 16, padding: '14px 16px', background: 'rgba(13,148,136,0.05)', border: `1px solid ${TEAL}30`, borderRadius: 12 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', margin: '0 0 12px' }}>New Custom Rule</p>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr) auto', gap: 10, alignItems: 'flex-end' }}>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pollutant</label>
                    <select value={customRule.pollutant} onChange={e => setCustomRule(p => ({ ...p, pollutant: e.target.value }))} style={inp}>
                      {Object.entries(POLLUTANT_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Period</label>
                    <select value={customRule.period} onChange={e => setCustomRule(p => ({ ...p, period: e.target.value }))} style={inp}>
                      {['1-hour', '8-hour', '24-hour'].map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Threshold</label>
                    <input type="number" value={customRule.threshold} onChange={e => setCustomRule(p => ({ ...p, threshold: e.target.value }))} placeholder="e.g. 50" style={inp} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Warn at %</label>
                    <input type="number" min={50} max={95} value={customRule.warning_pct} onChange={e => setCustomRule(p => ({ ...p, warning_pct: Number(e.target.value) }))} style={inp} />
                  </div>
                  <button onClick={addCustomRule} disabled={savingCustom || !customRule.threshold}
                    style={{ padding: '8px 16px', borderRadius: 9, border: 'none', cursor: 'pointer', background: `linear-gradient(135deg, ${TEAL}, ${TEAL_DARK})`, color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font)', opacity: savingCustom || !customRule.threshold ? 0.6 : 1 }}>
                    {savingCustom ? 'Saving…' : 'Add'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Email Configuration */}
          <div style={{ ...glass({ padding: '20px 22px' }) }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 2px', display: 'flex', alignItems: 'center', gap: 7 }}>
                  <Mail size={14} color={TEAL} /> Email Configuration
                </h2>
                <p style={{ color: 'var(--text-faint)', fontSize: 11, margin: 0 }}>Configure SMTP or Resend to deliver alert notifications</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: emailConfig.configured ? 'rgba(22,163,74,0.1)' : 'rgba(234,179,8,0.1)', border: `1px solid ${emailConfig.configured ? 'rgba(22,163,74,0.25)' : 'rgba(234,179,8,0.25)'}` }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: emailConfig.configured ? '#16A34A' : '#CA8A04' }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: emailConfig.configured ? '#16A34A' : '#CA8A04' }}>
                  {emailConfig.configured ? 'Email active' : 'Not configured'}
                </span>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Provider</label>
              <select
                value={emailFields.provider || 'none'}
                onChange={e => setEmailFields(p => ({ ...p, provider: e.target.value === 'none' ? null : e.target.value }))}
                style={{ ...inp, maxWidth: 240 }}>
                <option value="none">— Select provider —</option>
                <option value="gmail_smtp">Gmail SMTP</option>
                <option value="resend">Resend API</option>
                <option value="custom_smtp">Custom SMTP</option>
              </select>
            </div>

            {(emailFields.provider === 'gmail_smtp' || emailFields.provider === 'custom_smtp') && (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 14 }}>
                {[
                  { key: 'smtp_host', label: 'SMTP Host', placeholder: 'smtp.gmail.com' },
                  { key: 'smtp_port', label: 'SMTP Port', placeholder: '587', type: 'number' },
                  { key: 'smtp_user', label: 'SMTP Username', placeholder: 'your@email.com' },
                  { key: 'smtp_pass', label: 'SMTP Password / App Password', placeholder: '••••••••', type: 'password' },
                  { key: 'from_email', label: 'From Email', placeholder: 'alerts@hfcl.sa' },
                ].map(f => (
                  <div key={f.key}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{f.label}</label>
                    <input type={f.type || 'text'} value={emailFields[f.key] || ''} onChange={e => setEmailFields(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.placeholder} style={inp} />
                  </div>
                ))}
              </div>
            )}

            {emailFields.provider === 'resend' && (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Resend API Key</label>
                  <input type="password" value={emailFields.resend_api_key || ''} onChange={e => setEmailFields(p => ({ ...p, resend_api_key: e.target.value }))} placeholder="re_••••••••" style={inp} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>From Email</label>
                  <input type="text" value={emailFields.from_email || ''} onChange={e => setEmailFields(p => ({ ...p, from_email: e.target.value }))} placeholder="alerts@hfcl.sa" style={inp} />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={saveEmailConfig} disabled={savingEmail} style={{
                padding: '8px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: `linear-gradient(135deg, ${TEAL}, ${TEAL_DARK})`, color: '#fff',
                fontSize: 12, fontWeight: 700, fontFamily: 'var(--font)', opacity: savingEmail ? 0.7 : 1,
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                {savingEmail ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Settings size={13} />}
                {savingEmail ? 'Saving…' : 'Save Configuration'}
              </button>

              <button onClick={sendTestAlert} disabled={testingAlert || !emailConfig.configured} style={{
                padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.5)',
                cursor: emailConfig.configured ? 'pointer' : 'not-allowed',
                background: 'rgba(255,255,255,0.4)', color: emailConfig.configured ? 'var(--text)' : 'var(--text-faint)',
                fontSize: 12, fontWeight: 600, fontFamily: 'var(--font)',
                display: 'flex', alignItems: 'center', gap: 5, opacity: emailConfig.configured ? 1 : 0.5,
              }}>
                <Send size={12} />Send Test Alert
              </button>

              {emailMsg && (
                <span style={{ fontSize: 12, color: emailMsg.includes('Error') || emailMsg.includes('Failed') ? '#DC2626' : '#16A34A', fontWeight: 600 }}>
                  {emailMsg}
                </span>
              )}
            </div>

            {!emailConfig.configured && (
              <div style={{ marginTop: 14, display: 'flex', gap: 8, padding: '10px 12px', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: 10 }}>
                <Info size={14} color="#3B82F6" style={{ flexShrink: 0, marginTop: 1 }} />
                <p style={{ fontSize: 11, color: 'var(--text-mid)', margin: 0, lineHeight: 1.6 }}>
                  Alert detection, state tracking, and logging are fully active without email.
                  Configure a provider above to receive email notifications.
                  All alerts are logged to the History tab regardless of email status.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ TAB: SUBSCRIBERS ═════════════════════════════════════════════════ */}
      {tab === 'subscribers' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'glassIn 0.4s cubic-bezier(.16,1,.3,1) both' }}>

          {/* Add subscriber form */}
          <div style={{ ...glass({ padding: '20px 22px' }) }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 7 }}>
              <Plus size={14} color={TEAL} /> Add Subscriber
            </h2>
            <form onSubmit={addSubscriber}>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr auto', gap: 12, alignItems: 'flex-end' }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email *</label>
                  <input type="email" value={newSub.email} onChange={e => setNewSub(p => ({ ...p, email: e.target.value }))} placeholder="name@company.com" required style={inp} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Name</label>
                  <input type="text" value={newSub.name} onChange={e => setNewSub(p => ({ ...p, name: e.target.value }))} placeholder="Contact name" style={inp} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Station (optional)</label>
                  <select value={newSub.station_id} onChange={e => setNewSub(p => ({ ...p, station_id: e.target.value }))} style={inp}>
                    <option value="">All stations</option>
                    {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <button type="submit" disabled={addingSubscriber || !newSub.email} style={{
                  padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: `linear-gradient(135deg, ${TEAL}, ${TEAL_DARK})`, color: '#fff',
                  fontSize: 12, fontWeight: 700, fontFamily: 'var(--font)',
                  opacity: addingSubscriber || !newSub.email ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
                }}>
                  <Plus size={13} />{addingSubscriber ? 'Adding…' : 'Add'}
                </button>
              </div>
              {subMsg && <p style={{ fontSize: 12, color: subMsg.includes('Error') ? '#DC2626' : '#16A34A', fontWeight: 600, marginTop: 10, marginBottom: 0 }}>{subMsg}</p>}
            </form>
          </div>

          {/* Subscriber list */}
          <div style={{ ...glass({ padding: '20px 22px' }) }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 7 }}>
              <Users size={14} color={TEAL} /> Active Subscribers
              <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-faint)' }}>({subscribers.length})</span>
            </h2>

            {loadingSubs ? (
              <div style={{ textAlign: 'center', padding: '24px 0' }}><Loader2 size={20} color="#A8A29E" style={{ animation: 'spin 1s linear infinite' }} /></div>
            ) : subscribers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-faint)' }}>
                <Users size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
                <p style={{ fontSize: 13, margin: 0 }}>No subscribers yet.</p>
                <p style={{ fontSize: 11, marginTop: 4 }}>Add an email address above to receive alert notifications.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {subscribers.map(sub => (
                  <div key={sub.id} style={{ ...glassInner({ padding: '12px 16px' }), display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: TEAL + '15', border: `1px solid ${TEAL}25`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Mail size={14} color={TEAL} />
                      </div>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: 'var(--text)' }}>{sub.name || sub.email}</p>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '1px 0 0' }}>
                          {sub.name ? sub.email + ' · ' : ''}
                          {sub.stations?.name || 'All stations'} · {sub.role}
                        </p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button onClick={() => toggleSubscriberEmail(sub.id, !sub.email_enabled)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0' }}>
                        {sub.email_enabled
                          ? <ToggleRight size={20} color={TEAL} />
                          : <ToggleLeft size={20} color="#D6D3D1" />
                        }
                        <span style={{ fontSize: 11, color: sub.email_enabled ? TEAL : 'var(--text-faint)', fontWeight: 600 }}>Email</span>
                      </button>
                      <button onClick={() => toggleSubscriberEmail(sub.id, sub.email_enabled)}
                        title="WhatsApp — coming soon"
                        style={{ background: 'none', border: 'none', cursor: 'not-allowed', display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0', opacity: 0.4 }}>
                        <ToggleLeft size={20} color="#D6D3D1" />
                        <span style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 600 }}>WhatsApp</span>
                      </button>
                      <button onClick={() => removeSubscriber(sub.id)}
                        style={{ ...glassInner({ padding: '5px 9px', borderRadius: 8 }), border: '1px solid rgba(220,38,38,0.15)', background: 'rgba(220,38,38,0.06)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#DC2626', fontFamily: 'var(--font)', fontWeight: 600 }}>
                        <Trash2 size={11} />Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
