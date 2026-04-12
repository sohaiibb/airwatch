import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { glass, glassInner } from '../lib/utils';
import { PRESET_TEMPLATES, DEFAULT_CLIENT_PERMISSIONS } from '../lib/permissions';
import {
  Users, Plus, Search, Building2, Mail, Phone, MapPin, Trash2,
  Check, X, ChevronRight, Loader2, UserPlus, Station, Wifi,
  WifiOff, Shield, Bell, Eye, EyeOff, Save, AlertTriangle,
  ToggleLeft, ToggleRight, Settings, RefreshCw,
} from 'lucide-react';

const BACKEND = import.meta.env.VITE_BACKEND_URL || '';

// ── Shared micro-components ───────────────────────────────────────────────────

function Badge({ children, color = 'green' }) {
  const colors = { green: ['rgba(22,163,74,0.12)', '#16A34A'], red: ['rgba(220,38,38,0.10)', '#DC2626'], gray: ['rgba(0,0,0,0.07)', '#78716C'], blue: ['rgba(59,130,246,0.10)', '#3B82F6'], orange: ['rgba(234,88,12,0.10)', '#EA580C'] };
  const [bg, fg] = colors[color] || colors.green;
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: bg, color: fg, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{children}</span>;
}

function Tabs({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 20, padding: '4px', borderRadius: 12, background: 'rgba(0,0,0,0.04)' }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{ padding: '7px 14px', borderRadius: 9, border: 'none', background: active === t.id ? 'rgba(255,255,255,0.85)' : 'transparent', color: active === t.id ? '#1C1917' : '#78716C', fontSize: 12, fontWeight: active === t.id ? 700 : 500, fontFamily: 'var(--font)', cursor: 'pointer', transition: 'all 0.15s', boxShadow: active === t.id ? '0 1px 4px rgba(0,0,0,0.06)' : 'none' }}>{t.label}</button>
      ))}
    </div>
  );
}

function Toggle({ value, onChange }) {
  return (
    <button onClick={() => onChange(!value)} style={{ width: 36, height: 20, borderRadius: 10, border: 'none', background: value ? '#16A34A' : '#D6D3D1', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 2, left: value ? 17 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
    </button>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#78716C', marginBottom: 5, letterSpacing: '0.02em', textTransform: 'uppercase' }}>{label}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder, type = 'text', disabled }) {
  return (
    <input type={type} value={value ?? ''} onChange={e => onChange?.(e.target.value)} placeholder={placeholder} disabled={disabled}
      style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.45)', background: disabled ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.35)', fontSize: 13, fontFamily: 'var(--font)', color: '#1C1917', outline: 'none' }} />
  );
}

function Btn({ onClick, disabled, loading, variant = 'primary', size = 'md', children }) {
  const styles = {
    primary: { background: 'rgba(22,163,74,0.12)', color: '#16A34A' },
    danger:  { background: 'rgba(220,38,38,0.10)', color: '#DC2626' },
    ghost:   { background: 'rgba(0,0,0,0.06)', color: '#57534E' },
    blue:    { background: 'rgba(59,130,246,0.10)', color: '#3B82F6' },
  };
  const pad = size === 'sm' ? '6px 12px' : '9px 18px';
  return (
    <button onClick={onClick} disabled={disabled || loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: pad, borderRadius: 10, border: 'none', fontSize: size === 'sm' ? 12 : 13, fontWeight: 600, fontFamily: 'var(--font)', cursor: (disabled || loading) ? 'default' : 'pointer', opacity: (disabled || loading) ? 0.6 : 1, transition: 'all 0.15s', ...styles[variant] }}>
      {loading && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
      {children}
    </button>
  );
}

// ── Permission helpers ────────────────────────────────────────────────────────

const PARAMS = [
  { key: 'pm25', label: 'PM₂.₅' }, { key: 'pm10', label: 'PM₁₀' },
  { key: 'so2', label: 'SO₂' }, { key: 'no2', label: 'NO₂' }, { key: 'o3', label: 'O₃' }, { key: 'co', label: 'CO' },
  { key: 'temp', label: 'Temperature' }, { key: 'rh', label: 'Humidity' },
  { key: 'ws', label: 'Wind Speed' }, { key: 'wd', label: 'Wind Direction' },
];

const PAGES = [
  { key: 'dashboard', label: 'Dashboard' }, { key: 'charts', label: 'Charts' },
  { key: 'data', label: 'Data Table' }, { key: 'reports', label: 'Reports' },
  { key: 'compliance', label: 'Compliance' }, { key: 'wind_rose', label: 'Wind Rose' },
  { key: 'alerts', label: 'Alerts' },
];

const AVERAGING = ['1-min', '15-min', '1-hour', '8-hour', '24-hour'];

// ── PermissionsTab ─────────────────────────────────────────────────────────────

function PermissionsTab({ org, stations }) {
  const [permsMap, setPermsMap] = useState({});  // { stationId|'global': { type: value } }
  const [saving, setSaving] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => { loadPerms(); }, [org?.id]);

  async function loadPerms() {
    if (!org) return;
    const { data } = await supabase.from('client_permissions').select('*').eq('organization_id', org.id);
    const map = {};
    (data || []).forEach(r => {
      const key = r.station_id || 'global';
      if (!map[key]) map[key] = {};
      map[key][r.permission_type] = r.permission_value;
    });
    setPermsMap(map);
  }

  function getPerms(stationId) {
    const key = stationId || 'global';
    return permsMap[key] || {};
  }

  function mergePerms(stationId, type, patch) {
    const key = stationId || 'global';
    setPermsMap(m => ({ ...m, [key]: { ...m[key], [type]: { ...(m[key]?.[type] || {}), ...patch } } }));
  }

  async function savePerms(stationId) {
    const key = stationId || 'global';
    setSaving(key);
    const p = permsMap[key] || {};
    const rows = Object.entries(p).map(([type, value]) => ({
      organization_id: org.id, station_id: stationId || null, permission_type: type, permission_value: value,
    }));
    for (const row of rows) {
      await supabase.from('client_permissions').upsert(row, { onConflict: 'organization_id,station_id,permission_type' });
    }
    setSaving(''); setSaved(key); setTimeout(() => setSaved(''), 2000);
  }

  async function applyPreset(stationId, presetKey) {
    const preset = PRESET_TEMPLATES[presetKey];
    if (!preset) return;
    const key = stationId || 'global';
    const newPerms = {
      page_access: preset.page_access,
      visible_parameters: preset.visible_parameters,
      report_access: preset.report_access,
      data_access: preset.data_access,
      dashboard_access: preset.dashboard_access,
    };
    setPermsMap(m => ({ ...m, [key]: newPerms }));
  }

  function PermCard({ stationId, stationName }) {
    const p = getPerms(stationId);
    const key = stationId || 'global';
    const vis = p.visible_parameters || DEFAULT_CLIENT_PERMISSIONS.visible_parameters;
    const pages = p.page_access || DEFAULT_CLIENT_PERMISSIONS.page_access;
    const rep = p.report_access || DEFAULT_CLIENT_PERMISSIONS.report_access;
    const dat = p.data_access || DEFAULT_CLIENT_PERMISSIONS.data_access;

    return (
      <div style={{ ...glassInner(), padding: '18px', borderRadius: 14, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>{stationName}</h4>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(PRESET_TEMPLATES).map(([k, t]) => (
              <Btn key={k} size="sm" variant="ghost" onClick={() => applyPreset(stationId, k)}>{t.label}</Btn>
            ))}
          </div>
        </div>

        {/* Parameters */}
        <p style={{ fontSize: 11, fontWeight: 700, color: '#A8A29E', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Parameters Access</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {PARAMS.map(param => (
            <button key={param.key} onClick={() => mergePerms(stationId, 'visible_parameters', { [param.key]: !vis[param.key] })} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: `1.5px solid ${vis[param.key] ? '#16A34A' : 'rgba(0,0,0,0.12)'}`, background: vis[param.key] ? 'rgba(22,163,74,0.10)' : 'rgba(0,0,0,0.03)', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font)', color: vis[param.key] ? '#16A34A' : '#78716C' }}>
              {vis[param.key] ? <Check size={11} /> : <X size={11} />} {param.label}
            </button>
          ))}
          <Btn size="sm" variant="ghost" onClick={() => mergePerms(stationId, 'visible_parameters', Object.fromEntries(PARAMS.map(p => [p.key, true])))}>Select All</Btn>
          <Btn size="sm" variant="ghost" onClick={() => mergePerms(stationId, 'visible_parameters', Object.fromEntries(PARAMS.map(p => [p.key, false])))}>Deselect All</Btn>
        </div>

        {/* Pages */}
        <p style={{ fontSize: 11, fontWeight: 700, color: '#A8A29E', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Page Access</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {PAGES.map(pg => (
            <button key={pg.key} onClick={() => mergePerms(stationId, 'page_access', { [pg.key]: !pages[pg.key] })} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: `1.5px solid ${pages[pg.key] ? '#3B82F6' : 'rgba(0,0,0,0.12)'}`, background: pages[pg.key] ? 'rgba(59,130,246,0.10)' : 'rgba(0,0,0,0.03)', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font)', color: pages[pg.key] ? '#3B82F6' : '#78716C' }}>
              {pages[pg.key] ? <Check size={11} /> : <X size={11} />} {pg.label}
            </button>
          ))}
        </div>

        {/* Report + Data access side by side */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#A8A29E', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Report Permissions</p>
            {[['preview', 'Preview'], ['pdf', 'Download PDF'], ['csv', 'Download CSV'], ['excel', 'Download Excel']].map(([k, lbl]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                <span style={{ fontSize: 12, color: '#44403C' }}>{lbl}</span>
                <Toggle value={!!rep[k]} onChange={v => mergePerms(stationId, 'report_access', { [k]: v })} />
              </div>
            ))}
            <div style={{ marginTop: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#78716C', display: 'block', marginBottom: 4 }}>Max Date Range</label>
              <select value={rep.max_days ?? ''} onChange={e => mergePerms(stationId, 'report_access', { max_days: e.target.value ? +e.target.value : null })} style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.35)', fontSize: 12, fontFamily: 'var(--font)', outline: 'none' }}>
                <option value="">Unlimited</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
              </select>
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#78716C', display: 'block', marginBottom: 6 }}>Averaging Periods</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {AVERAGING.map(a => {
                  const enabled = (rep.averaging || []).includes(a);
                  return (
                    <button key={a} onClick={() => mergePerms(stationId, 'report_access', { averaging: enabled ? (rep.averaging || []).filter(x => x !== a) : [...(rep.averaging || []), a] })} style={{ padding: '4px 8px', borderRadius: 6, border: `1.5px solid ${enabled ? '#8B5CF6' : 'rgba(0,0,0,0.12)'}`, background: enabled ? 'rgba(139,92,246,0.10)' : 'rgba(0,0,0,0.03)', cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font)', color: enabled ? '#8B5CF6' : '#78716C' }}>{a}</button>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#A8A29E', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Data Table Permissions</p>
            {[['raw', 'Raw Data'], ['1min', '1-Min Data'], ['hourly', 'Hourly Data'], ['daily', 'Daily Data'], ['csv', 'Export CSV'], ['excel', 'Export Excel']].map(([k, lbl]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                <span style={{ fontSize: 12, color: '#44403C' }}>{lbl}</span>
                <Toggle value={!!dat[k]} onChange={v => mergePerms(stationId, 'data_access', { [k]: v })} />
              </div>
            ))}
            <div style={{ marginTop: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#78716C', display: 'block', marginBottom: 4 }}>Max Date Range</label>
              <select value={dat.max_days ?? ''} onChange={e => mergePerms(stationId, 'data_access', { max_days: e.target.value ? +e.target.value : null })} style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.35)', fontSize: 12, fontFamily: 'var(--font)', outline: 'none' }}>
                <option value="">Unlimited</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
              </select>
            </div>
          </div>
        </div>

        <Btn onClick={() => savePerms(stationId)} loading={saving === key} variant="primary">
          {saved === key ? <><Check size={13} /> Saved</> : <><Save size={13} /> Save Permissions</>}
        </Btn>
      </div>
    );
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: '#78716C', marginBottom: 16 }}>Configure what this client can see and do. Permissions apply to all assigned stations unless overridden per station.</p>
      <PermCard stationId={null} stationName="Global (All Stations)" />
      {stations.map(s => (
        <PermCard key={s.id} stationId={s.id} stationName={s.name} />
      ))}
      {stations.length === 0 && <p style={{ fontSize: 13, color: '#A8A29E', fontStyle: 'italic' }}>Assign stations first to set per-station permissions.</p>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AdminClients() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 900);
  const [orgs, setOrgs] = useState([]);
  const [allStations, setAllStations] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [orgStations, setOrgStations] = useState([]);
  const [orgUsers, setOrgUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('details');
  const [loading, setLoading] = useState(true);

  // Add org modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newOrg, setNewOrg] = useState({ name: '', contact_name: '', contact_email: '', contact_phone: '', address: '' });
  const [newOrgStations, setNewOrgStations] = useState([]);
  const [addingOrg, setAddingOrg] = useState(false);

  // Edit org
  const [editOrg, setEditOrg] = useState({});
  const [savingOrg, setSavingOrg] = useState(false);
  const [savedOrg, setSavedOrg] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);

  // Assign station
  const [assignStation, setAssignStation] = useState('');

  // Invite user
  const [inviteForm, setInviteForm] = useState({ show: false, full_name: '', email: '', role: 'viewer', loading: false, result: null });

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const [orgsRes, stationsRes] = await Promise.all([
      fetch(`${BACKEND}/api/organizations`).then(r => r.json()).catch(() => []),
      supabase.from('stations').select('id,name,device_id,status,is_active').eq('is_active', true).order('name'),
    ]);
    setOrgs(Array.isArray(orgsRes) ? orgsRes : []);
    setAllStations(stationsRes.data || []);
    setLoading(false);
  }

  async function loadOrgDetail(org) {
    setSelectedOrg(org);
    setEditOrg({ ...org });
    setTab('details');
    const [st, us] = await Promise.all([
      fetch(`${BACKEND}/api/organizations/${org.id}/stations`).then(r => r.json()).catch(() => []),
      fetch(`${BACKEND}/api/organizations/${org.id}/users`).then(r => r.json()).catch(() => []),
    ]);
    setOrgStations(Array.isArray(st) ? st : []);
    setOrgUsers(Array.isArray(us) ? us : []);
  }

  async function createOrg() {
    if (!newOrg.name.trim()) return;
    setAddingOrg(true);
    const res = await fetch(`${BACKEND}/api/organizations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newOrg) });
    const created = await res.json();
    // Assign selected stations
    for (const sid of newOrgStations) {
      await fetch(`${BACKEND}/api/organizations/${created.id}/stations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ station_id: sid }) });
    }
    setAddingOrg(false);
    setShowAddModal(false);
    setNewOrg({ name: '', contact_name: '', contact_email: '', contact_phone: '', address: '' });
    setNewOrgStations([]);
    await loadAll();
    loadOrgDetail(created);
  }

  async function saveOrgDetails() {
    setSavingOrg(true);
    await fetch(`${BACKEND}/api/organizations/${selectedOrg.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editOrg) });
    await loadAll();
    setSavingOrg(false); setSavedOrg(true); setTimeout(() => setSavedOrg(false), 2000);
  }

  async function deleteOrg() {
    setDeleteModal(false);
    await fetch(`${BACKEND}/api/organizations/${selectedOrg.id}`, { method: 'DELETE' });
    setSelectedOrg(null);
    await loadAll();
  }

  async function assignStationToOrg() {
    if (!assignStation) return;
    await fetch(`${BACKEND}/api/organizations/${selectedOrg.id}/stations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ station_id: assignStation }) });
    setAssignStation('');
    const st = await fetch(`${BACKEND}/api/organizations/${selectedOrg.id}/stations`).then(r => r.json()).catch(() => []);
    setOrgStations(Array.isArray(st) ? st : []);
  }

  async function unassignStation(stationId) {
    await fetch(`${BACKEND}/api/organizations/${selectedOrg.id}/stations/${stationId}`, { method: 'DELETE' });
    setOrgStations(ss => ss.filter(s => s.id !== stationId));
  }

  async function sendInvite() {
    setInviteForm(f => ({ ...f, loading: true, result: null }));
    const res = await fetch(`${BACKEND}/api/organizations/${selectedOrg.id}/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ full_name: inviteForm.full_name, email: inviteForm.email, role: inviteForm.role }) });
    const data = await res.json();
    setInviteForm(f => ({ ...f, loading: false, result: res.ok ? { ok: true, ...data } : { ok: false, msg: data.detail || 'Failed' } }));
    if (res.ok) {
      const us = await fetch(`${BACKEND}/api/organizations/${selectedOrg.id}/users`).then(r => r.json()).catch(() => []);
      setOrgUsers(Array.isArray(us) ? us : []);
    }
  }

  async function updateUser(userId, updates) {
    await fetch(`${BACKEND}/api/organizations/${selectedOrg.id}/users/${userId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
    setOrgUsers(us => us.map(u => u.id === userId ? { ...u, ...updates } : u));
  }

  async function deactivateUser(userId) {
    await fetch(`${BACKEND}/api/organizations/${selectedOrg.id}/users/${userId}`, { method: 'DELETE' });
    setOrgUsers(us => us.map(u => u.id === userId ? { ...u, is_active: false } : u));
  }

  // ── Filtered orgs ─────────────────────────────────────────────────────────

  const filteredOrgs = orgs.filter(o => o.name?.toLowerCase().includes(search.toLowerCase()) || o.contact_email?.toLowerCase().includes(search.toLowerCase()));

  // Available stations (not yet assigned)
  const assignedIds = new Set(orgStations.map(s => s.id));
  const availableStations = allStations.filter(s => !assignedIds.has(s.id));

  // ── Detail panels ──────────────────────────────────────────────────────────

  function DetailsTab() {
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Organization Name"><Input value={editOrg.name} onChange={v => setEditOrg(e => ({ ...e, name: v }))} /></Field>
          <Field label="Status">
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              {[true, false].map(v => (
                <button key={String(v)} onClick={() => setEditOrg(e => ({ ...e, is_active: v }))} style={{ flex: 1, padding: '8px 0', borderRadius: 9, border: `1.5px solid ${editOrg.is_active === v ? (v ? '#16A34A' : '#DC2626') : 'rgba(0,0,0,0.12)'}`, background: editOrg.is_active === v ? (v ? 'rgba(22,163,74,0.10)' : 'rgba(220,38,38,0.08)') : 'transparent', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font)', cursor: 'pointer', color: editOrg.is_active === v ? (v ? '#16A34A' : '#DC2626') : '#78716C' }}>
                  {v ? 'Active' : 'Inactive'}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Contact Name"><Input value={editOrg.contact_name} onChange={v => setEditOrg(e => ({ ...e, contact_name: v }))} /></Field>
          <Field label="Contact Email"><Input value={editOrg.contact_email} onChange={v => setEditOrg(e => ({ ...e, contact_email: v }))} /></Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Phone"><Input value={editOrg.contact_phone} onChange={v => setEditOrg(e => ({ ...e, contact_phone: v }))} /></Field>
          <Field label="Address"><Input value={editOrg.address} onChange={v => setEditOrg(e => ({ ...e, address: v }))} /></Field>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Btn onClick={saveOrgDetails} loading={savingOrg} variant="primary">
            {savedOrg ? <><Check size={13} /> Saved</> : <><Save size={13} /> Save Changes</>}
          </Btn>
          <Btn onClick={() => setDeleteModal(true)} variant="danger"><Trash2 size={13} /> Delete Organization</Btn>
        </div>
      </div>
    );
  }

  function StationsTab() {
    return (
      <div>
        {/* Assign */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <select value={assignStation} onChange={e => setAssignStation(e.target.value)} style={{ width: '100%', padding: '9px 32px 9px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.35)', fontSize: 13, fontFamily: 'var(--font)', color: '#1C1917', outline: 'none', appearance: 'none' }}>
              <option value="">Select station to assign…</option>
              {availableStations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <Btn onClick={assignStationToOrg} disabled={!assignStation} variant="primary"><Plus size={13} /> Assign</Btn>
        </div>

        {/* List */}
        {orgStations.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#A8A29E' }}>
            <Building2 size={28} color="#D6D3D1" style={{ marginBottom: 8 }} />
            <p style={{ fontSize: 13 }}>No stations assigned. Assign a station to give this client access.</p>
          </div>
        ) : orgStations.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.4)', marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>{s.name}</p>
              <p style={{ fontSize: 11, color: '#78716C', margin: '2px 0 0', fontFamily: 'var(--mono)' }}>{s.device_id || 'No device ID'}</p>
            </div>
            <Badge color={s.status === 'online' ? 'green' : s.status === 'offline' ? 'red' : 'orange'}>{s.status || 'unknown'}</Badge>
            <Btn size="sm" variant="danger" onClick={() => unassignStation(s.id)}><X size={12} /> Remove</Btn>
          </div>
        ))}
      </div>
    );
  }

  function UsersTab() {
    const ROLES = [
      { value: 'viewer', label: 'Client Viewer' },
      { value: 'manager', label: 'Client Editor' },
    ];

    return (
      <div>
        {!inviteForm.show ? (
          <Btn onClick={() => setInviteForm(f => ({ ...f, show: true }))} variant="primary" style={{ marginBottom: 16 }}>
            <UserPlus size={13} /> Invite User
          </Btn>
        ) : (
          <div style={{ ...glassInner(), padding: '16px', borderRadius: 14, marginBottom: 20 }}>
            <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Invite New User</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <Field label="Full Name"><Input value={inviteForm.full_name} onChange={v => setInviteForm(f => ({ ...f, full_name: v }))} placeholder="Jane Smith" /></Field>
              <Field label="Email Address"><Input value={inviteForm.email} onChange={v => setInviteForm(f => ({ ...f, email: v }))} type="email" placeholder="jane@company.com" /></Field>
            </div>
            <Field label="Role">
              <div style={{ display: 'flex', gap: 8 }}>
                {ROLES.map(r => (
                  <button key={r.value} onClick={() => setInviteForm(f => ({ ...f, role: r.value }))} style={{ flex: 1, padding: '8px 0', borderRadius: 9, border: `1.5px solid ${inviteForm.role === r.value ? '#3B82F6' : 'rgba(0,0,0,0.12)'}`, background: inviteForm.role === r.value ? 'rgba(59,130,246,0.10)' : 'transparent', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font)', cursor: 'pointer', color: inviteForm.role === r.value ? '#3B82F6' : '#78716C' }}>{r.label}</button>
                ))}
              </div>
            </Field>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <Btn onClick={sendInvite} loading={inviteForm.loading} disabled={!inviteForm.email} variant="primary"><Mail size={13} /> Send Invitation</Btn>
              <Btn onClick={() => setInviteForm(f => ({ ...f, show: false, result: null }))} variant="ghost"><X size={13} /> Cancel</Btn>
            </div>
            {inviteForm.result && (
              <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, background: inviteForm.result.ok ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)', border: `1px solid ${inviteForm.result.ok ? 'rgba(22,163,74,0.20)' : 'rgba(220,38,38,0.20)'}` }}>
                {inviteForm.result.ok ? (
                  <>
                    <p style={{ fontSize: 12, fontWeight: 700, color: '#16A34A', margin: '0 0 4px' }}>✓ Invitation sent to {inviteForm.result.email}</p>
                    {inviteForm.result.reset_url && <p style={{ fontSize: 11, color: '#78716C', margin: 0 }}>Password reset link generated. User will receive an email to set their password.</p>}
                  </>
                ) : (
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#DC2626', margin: 0 }}>✗ {inviteForm.result.msg}</p>
                )}
              </div>
            )}
          </div>
        )}

        {orgUsers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#A8A29E' }}>
            <Users size={28} color="#D6D3D1" style={{ marginBottom: 8 }} />
            <p style={{ fontSize: 13 }}>No users in this organization.</p>
          </div>
        ) : orgUsers.map(u => (
          <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.4)', marginBottom: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 140 }}>
              <p style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>{u.full_name || '—'}</p>
              <p style={{ fontSize: 11, color: '#78716C', margin: '2px 0 0' }}>{u.email || '—'}</p>
              {u.last_login && <p style={{ fontSize: 10, color: '#A8A29E', margin: '2px 0 0' }}>Last: {new Date(u.last_login).toLocaleDateString()}</p>}
            </div>
            <select value={u.role} onChange={e => updateUser(u.id, { role: e.target.value })} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.35)', fontSize: 12, fontFamily: 'var(--font)', outline: 'none' }}>
              <option value="viewer">Client Viewer</option>
              <option value="manager">Client Editor</option>
            </select>
            <Badge color={u.is_active ? 'green' : 'gray'}>{u.is_active ? 'Active' : 'Inactive'}</Badge>
            {u.is_active && <Btn size="sm" variant="ghost" onClick={() => deactivateUser(u.id)}>Deactivate</Btn>}
          </div>
        ))}
      </div>
    );
  }

  function AlertSubscribersTab() {
    const [subs, setSubs] = useState([]);
    useEffect(() => {
      supabase.from('alert_subscribers').select('*, stations(name)').in('station_id', orgStations.map(s => s.id)).then(({ data }) => setSubs(data || []));
    }, [selectedOrg?.id]);

    return (
      <div>
        <p style={{ fontSize: 12, color: '#78716C', marginBottom: 16 }}>Alert subscribers from this organization. Manage subscriptions in the Alerts page.</p>
        {subs.length === 0 ? (
          <p style={{ fontSize: 13, color: '#A8A29E', textAlign: 'center', padding: '24px 0' }}>No alert subscribers for this organization's stations.</p>
        ) : subs.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.4)', marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>{s.name || s.email}</p>
              <p style={{ fontSize: 11, color: '#78716C', margin: '2px 0 0' }}>{s.email} · {s.stations?.name || 'All stations'}</p>
            </div>
            <Badge color={s.email_enabled ? 'green' : 'gray'}>{s.email_enabled ? 'Email On' : 'Email Off'}</Badge>
          </div>
        ))}
      </div>
    );
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  const leftWidth = isMobile ? '100%' : 280;

  return (
    <div style={{ maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: isMobile ? 22 : 26, fontWeight: 800, letterSpacing: '-0.03em', margin: 0 }}>Manage Clients</h1>
          <p style={{ fontSize: 13, color: '#78716C', marginTop: 4 }}>{orgs.length} organizations</p>
        </div>
        <Btn onClick={() => setShowAddModal(true)} variant="primary"><Plus size={14} /> Add Organization</Btn>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexDirection: isMobile ? 'column' : 'row' }}>

        {/* ── Left panel: Org list ─────────────────────────────────────────── */}
        <div style={{ ...glass({ padding: '16px' }), width: leftWidth, flexShrink: 0, animation: 'glassIn 0.4s ease both' }}>
          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Search size={14} color="#A8A29E" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search organizations…" style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px 8px 30px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.35)', fontSize: 12, fontFamily: 'var(--font)', outline: 'none' }} />
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}><Loader2 size={20} color="#A8A29E" style={{ animation: 'spin 1s linear infinite' }} /></div>
          ) : filteredOrgs.length === 0 ? (
            <p style={{ fontSize: 13, color: '#A8A29E', textAlign: 'center', padding: '20px 0' }}>No organizations found.</p>
          ) : filteredOrgs.map(org => (
            <button key={org.id} onClick={() => loadOrgDetail(org)} style={{ width: '100%', padding: '12px', borderRadius: 12, border: `1.5px solid ${selectedOrg?.id === org.id ? 'rgba(22,163,74,0.4)' : 'rgba(255,255,255,0.4)'}`, background: selectedOrg?.id === org.id ? 'rgba(22,163,74,0.08)' : 'rgba(255,255,255,0.25)', cursor: 'pointer', textAlign: 'left', marginBottom: 6, transition: 'all 0.15s' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#1C1917' }}>{org.name}</span>
                <Badge color={org.is_active ? 'green' : 'gray'}>{org.is_active ? 'Active' : 'Inactive'}</Badge>
              </div>
              <p style={{ fontSize: 11, color: '#78716C', margin: 0 }}>{org.contact_email || 'No email'}</p>
              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <span style={{ fontSize: 11, color: '#A8A29E' }}>{org.stations_count || 0} stations</span>
                <span style={{ fontSize: 11, color: '#A8A29E' }}>{org.users_count || 0} users</span>
              </div>
            </button>
          ))}
        </div>

        {/* ── Right panel: Org detail ──────────────────────────────────────── */}
        {selectedOrg ? (
          <div style={{ ...glass({ padding: '20px' }), flex: 1, minWidth: 0, animation: 'glassIn 0.3s ease both' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{selectedOrg.name}</h2>
                <p style={{ fontSize: 12, color: '#78716C', margin: '2px 0 0' }}>{selectedOrg.contact_email}</p>
              </div>
              <Badge color={selectedOrg.is_active ? 'green' : 'gray'}>● {selectedOrg.is_active ? 'Active' : 'Inactive'}</Badge>
            </div>

            <Tabs
              tabs={[
                { id: 'details', label: 'Details' },
                { id: 'stations', label: `Stations (${orgStations.length})` },
                { id: 'users', label: `Users (${orgUsers.length})` },
                { id: 'subscribers', label: 'Alert Subscribers' },
                { id: 'permissions', label: 'Permissions' },
              ]}
              active={tab}
              onChange={setTab}
            />

            {tab === 'details'     && <DetailsTab />}
            {tab === 'stations'    && <StationsTab />}
            {tab === 'users'       && <UsersTab />}
            {tab === 'subscribers' && <AlertSubscribersTab />}
            {tab === 'permissions' && <PermissionsTab org={selectedOrg} stations={orgStations} />}
          </div>
        ) : (
          <div style={{ ...glass({ padding: '40px' }), flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', animation: 'glassIn 0.4s ease both' }}>
            <Building2 size={40} color="#D6D3D1" style={{ marginBottom: 12 }} />
            <p style={{ fontSize: 14, color: '#A8A29E', fontWeight: 500 }}>Select an organization to view details</p>
          </div>
        )}
      </div>

      {/* ── Add Organization Modal ───────────────────────────────────────────── */}
      {showAddModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ ...glass({ padding: '28px' }), maxWidth: 520, width: '100%', animation: 'glassIn 0.25s ease both', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>Add Organization</h3>
              <button onClick={() => setShowAddModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A8A29E' }}><X size={18} /></button>
            </div>

            <Field label="Organization Name *"><Input value={newOrg.name} onChange={v => setNewOrg(n => ({ ...n, name: v }))} placeholder="e.g. NEOM, MAADEN" /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Contact Name"><Input value={newOrg.contact_name} onChange={v => setNewOrg(n => ({ ...n, contact_name: v }))} /></Field>
              <Field label="Contact Email"><Input value={newOrg.contact_email} onChange={v => setNewOrg(n => ({ ...n, contact_email: v }))} type="email" /></Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Phone"><Input value={newOrg.contact_phone} onChange={v => setNewOrg(n => ({ ...n, contact_phone: v }))} /></Field>
              <Field label="Address"><Input value={newOrg.address} onChange={v => setNewOrg(n => ({ ...n, address: v }))} /></Field>
            </div>

            <Field label="Assign Stations">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {allStations.map(s => {
                  const sel = newOrgStations.includes(s.id);
                  return (
                    <button key={s.id} onClick={() => setNewOrgStations(ss => sel ? ss.filter(id => id !== s.id) : [...ss, s.id])} style={{ padding: '5px 10px', borderRadius: 8, border: `1.5px solid ${sel ? '#16A34A' : 'rgba(0,0,0,0.12)'}`, background: sel ? 'rgba(22,163,74,0.10)' : 'rgba(0,0,0,0.03)', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font)', color: sel ? '#16A34A' : '#78716C' }}>
                      {sel && <Check size={11} style={{ marginRight: 4 }} />}{s.name}
                    </button>
                  );
                })}
              </div>
            </Field>

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <Btn onClick={createOrg} loading={addingOrg} disabled={!newOrg.name.trim()} variant="primary"><Building2 size={13} /> Create Organization</Btn>
              <Btn onClick={() => setShowAddModal(false)} variant="ghost">Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ────────────────────────────────────────── */}
      {deleteModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ ...glass({ padding: '28px 32px' }), maxWidth: 380, width: '100%', animation: 'glassIn 0.25s ease both' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <AlertTriangle size={20} color="#DC2626" />
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Delete Organization</h3>
            </div>
            <p style={{ fontSize: 13, color: '#57534E', marginBottom: 20, lineHeight: 1.5 }}>
              This will permanently remove <strong>{selectedOrg?.name}</strong>, all its users, station assignments, and permissions. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Btn onClick={() => setDeleteModal(false)} variant="ghost">Cancel</Btn>
              <Btn onClick={deleteOrg} variant="danger"><Trash2 size={13} /> Delete</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
