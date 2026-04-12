import { useState, useEffect } from 'react';
import { supabase, getProfile } from './lib/supabase';
import { glass, glassInner } from './lib/utils';
import { LayoutDashboard, BarChart3, FileText, Bell, Settings, LogOut, Wind, ChevronRight, Shield, Users, Radio, Loader2, Compass, Database } from 'lucide-react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Charts from './pages/Charts';
import Compliance from './pages/Compliance';
import WindRosePage from './pages/WindRose';
import AdminStations from './pages/AdminStations';
import Reports from './pages/Reports';
import DataTable from './pages/DataTable';

const NAV_CLIENT = [
  { id: 'dashboard',  label: 'Dashboard',  icon: LayoutDashboard },
  { id: 'charts',     label: 'Charts',     icon: BarChart3 },
  { id: 'data',       label: 'Data',       icon: Database },
  { id: 'compliance', label: 'Compliance', icon: Shield },
  { id: 'wind-rose',  label: 'Wind Rose',  icon: Compass },
  { id: 'reports',    label: 'Reports',    icon: FileText },
  { id: 'alerts',     label: 'Alerts',     icon: Bell },
  { id: 'settings',   label: 'Settings',   icon: Settings },
];
const NAV_ADMIN = [
  { id: 'admin-stations', label: 'Manage Stations', icon: Radio },
  { id: 'admin-clients', label: 'Manage Clients', icon: Users },
  { id: 'admin-settings', label: 'System Settings', icon: Shield },
];

function NavItem({ item, active, onClick, collapsed }) {
  const Icon = item.icon;
  return (
    <button onClick={onClick} title={collapsed ? item.label : undefined} style={{
      display: 'flex', alignItems: 'center', gap: 10, width: '100%',
      padding: collapsed ? '10px 14px' : '10px 12px', borderRadius: 12, border: 'none',
      background: active ? 'rgba(255,255,255,0.50)' : 'transparent',
      cursor: 'pointer', color: active ? '#1C1917' : '#78716C',
      fontSize: 13, fontWeight: active ? 600 : 500, fontFamily: 'var(--font)',
      transition: 'all 0.2s', boxShadow: active ? '0 1px 4px rgba(0,0,0,0.04)' : 'none',
    }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.30)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = active ? 'rgba(255,255,255,0.50)' : 'transparent'; }}
    >
      <Icon size={18} />{!collapsed && item.label}
    </button>
  );
}

function Placeholder({ title, desc, icon: Icon }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div style={{ ...glass({ padding: '50px 60px' }), textAlign: 'center', animation: 'glassIn 0.5s ease both' }}>
        <Icon size={36} color="#A8A29E" style={{ marginBottom: 12 }} />
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 6px' }}>{title}</h2>
        <p style={{ color: '#78716C', fontSize: 14 }}>{desc}</p>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadProfile(); else setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) loadProfile(); else { setProfile(null); setLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile() {
    try { setProfile(await getProfile()); } catch {}
    setLoading(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null); setProfile(null); setPage('dashboard');
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ ...glass({ padding: '40px 50px' }), textAlign: 'center', animation: 'glassIn 0.5s ease both' }}>
        <Wind size={32} color="#16A34A" style={{ marginBottom: 12, animation: 'pulse 1.5s ease infinite' }} />
        <p style={{ fontSize: 16, fontWeight: 600 }}>Loading AirWatch...</p>
      </div>
    </div>
  );

  if (!session) return <Login onLogin={() => loadProfile()} />;

  const isAdmin = profile?.role === 'admin';
  const orgName = profile?.organizations?.name || 'Organization';

  function renderPage() {
    switch (page) {
      case 'dashboard':  return <Dashboard profile={profile} />;
      case 'charts':     return <Charts profile={profile} />;
      case 'compliance': return <Compliance profile={profile} />;
      case 'wind-rose':  return <WindRosePage profile={profile} />;
      case 'admin-stations': return isAdmin ? <AdminStations /> : <Dashboard profile={profile} />;
      case 'data':    return <DataTable profile={profile} />;
      case 'reports': return <Reports profile={profile} />;
      case 'alerts': return <Placeholder title="Alerts" desc="Coming in Phase 2." icon={Bell} />;
      case 'settings': return <Placeholder title="Settings" desc="Coming in Phase 2." icon={Settings} />;
      case 'admin-clients': return <Placeholder title="Manage Clients" desc="Coming in Phase 2." icon={Users} />;
      case 'admin-settings': return <Placeholder title="System Settings" desc="Coming in Phase 2." icon={Shield} />;
      default: return <Dashboard profile={profile} />;
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', position: 'relative', overflow: 'hidden' }}>
      {/* Ambient orbs */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '-10%', right: '-5%', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(59,130,246,0.10), transparent 70%)', animation: 'float1 25s ease-in-out infinite', filter: 'blur(40px)' }} />
        <div style={{ position: 'absolute', bottom: '-10%', left: '-8%', width: 700, height: 700, borderRadius: '50%', background: 'radial-gradient(circle, rgba(16,185,129,0.08), transparent 70%)', animation: 'float2 30s ease-in-out infinite', filter: 'blur(50px)' }} />
        <div style={{ position: 'absolute', top: '40%', left: '50%', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(168,85,247,0.06), transparent 60%)', animation: 'float3 20s ease-in-out infinite', filter: 'blur(35px)' }} />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, #10B981, #3B82F6, #8B5CF6, #EC4899, #F59E0B, #10B981)', backgroundSize: '200% 100%', animation: 'shimmer 8s linear infinite', opacity: 0.5 }} />
      </div>

      {/* Sidebar */}
      <aside style={{
        ...glass({ borderRadius: 0, border: 'none', borderRight: '1px solid rgba(255,255,255,0.4)' }),
        width: sidebarOpen ? 240 : 64, transition: 'width 0.3s cubic-bezier(.16,1,.3,1)',
        display: 'flex', flexDirection: 'column', position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 30, overflow: 'hidden',
      }}>
        <div style={{ padding: sidebarOpen ? '20px 20px 16px' : '20px 14px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,0.3)' }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, rgba(16,185,129,0.75), rgba(6,182,212,0.75))', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.5)', flexShrink: 0 }}>
            <Wind size={18} color="#fff" />
          </div>
          {sidebarOpen && <div><h1 style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em' }}>AirWatch<span style={{ color: '#16A34A' }}>.</span></h1><p style={{ fontSize: 10, color: '#A8A29E' }}>Hills and Field</p></div>}
        </div>

        <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{
          position: 'absolute', top: 22, right: -12, width: 24, height: 24, borderRadius: '50%',
          ...glassInner(), display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', border: '1px solid rgba(255,255,255,0.5)', zIndex: 2,
        }}>
          <ChevronRight size={12} color="#78716C" style={{ transform: sidebarOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s' }} />
        </button>

        <nav style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sidebarOpen && <p style={{ fontSize: 10, fontWeight: 700, color: '#A8A29E', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '8px 12px 4px' }}>MONITOR</p>}
          {NAV_CLIENT.map(i => <NavItem key={i.id} item={i} active={page === i.id} onClick={() => setPage(i.id)} collapsed={!sidebarOpen} />)}
          {isAdmin && <>
            {sidebarOpen && <p style={{ fontSize: 10, fontWeight: 700, color: '#A8A29E', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '16px 12px 4px' }}>ADMIN</p>}
            {!sidebarOpen && <div style={{ borderTop: '1px solid rgba(255,255,255,0.3)', margin: '8px 4px' }} />}
            {NAV_ADMIN.map(i => <NavItem key={i.id} item={i} active={page === i.id} onClick={() => setPage(i.id)} collapsed={!sidebarOpen} />)}
          </>}
        </nav>

        <div style={{ padding: '12px 8px', borderTop: '1px solid rgba(255,255,255,0.3)' }}>
          {sidebarOpen && <div style={{ padding: '8px 12px', marginBottom: 4 }}><p style={{ fontSize: 13, fontWeight: 600 }}>{profile?.full_name || 'User'}</p><p style={{ fontSize: 11, color: '#A8A29E' }}>{orgName}</p></div>}
          <button onClick={handleLogout} style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            padding: sidebarOpen ? '10px 12px' : '10px 14px', borderRadius: 12, border: 'none',
            background: 'rgba(220,38,38,0.06)', cursor: 'pointer', color: '#DC2626',
            fontSize: 13, fontWeight: 600, fontFamily: 'var(--font)', transition: 'background 0.2s',
          }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(220,38,38,0.12)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(220,38,38,0.06)'}
          >
            <LogOut size={16} />{sidebarOpen && 'Sign Out'}
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, marginLeft: sidebarOpen ? 240 : 64, transition: 'margin-left 0.3s cubic-bezier(.16,1,.3,1)', position: 'relative', zIndex: 1, padding: 24, maxWidth: 1400 }}>
        {renderPage()}
      </main>
    </div>
  );
}
