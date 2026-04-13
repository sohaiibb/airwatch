import { useState, useEffect } from 'react';
import { supabase, getProfile } from './lib/supabase';
import { glass, glassInner } from './lib/utils';
import { PermissionsProvider, usePermissions } from './lib/permissions';
import { LayoutDashboard, BarChart3, FileText, Bell, Settings as SettingsIcon, LogOut, Wind, ChevronRight, Shield, Users, Radio, Loader2, Compass, Database, Menu, Sun, Moon } from 'lucide-react';
import TickerStrip from './components/TickerStrip';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Charts from './pages/Charts';
import Compliance from './pages/Compliance';
import WindRosePage from './pages/WindRose';
import AdminStations from './pages/AdminStations';
import AdminClients from './pages/AdminClients';
import Reports from './pages/Reports';
import DataTable from './pages/DataTable';
import Alerts from './pages/Alerts';
import Settings from './pages/Settings';

// Nav items for HFCL admin users (full access)
const NAV_HFCL = [
  { id: 'dashboard',  label: 'Dashboard',  icon: LayoutDashboard },
  { id: 'charts',     label: 'Charts',     icon: BarChart3 },
  { id: 'data',       label: 'Data',       icon: Database },
  { id: 'compliance', label: 'Compliance', icon: Shield },
  { id: 'wind-rose',  label: 'Wind Rose',  icon: Compass },
  { id: 'reports',    label: 'Reports',    icon: FileText },
  { id: 'alerts',     label: 'Alerts',     icon: Bell },
  { id: 'settings',   label: 'Settings',   icon: SettingsIcon },
];

// Nav items that clients may see (filtered by page_access permissions)
const NAV_CLIENT_ALL = [
  { id: 'dashboard',  label: 'Dashboard',  icon: LayoutDashboard, permKey: 'dashboard' },
  { id: 'charts',     label: 'Charts',     icon: BarChart3,        permKey: 'charts' },
  { id: 'data',       label: 'Data',       icon: Database,         permKey: 'data' },
  { id: 'reports',    label: 'Reports',    icon: FileText,         permKey: 'reports' },
  { id: 'compliance', label: 'Compliance', icon: Shield,           permKey: 'compliance' },
  { id: 'wind-rose',  label: 'Wind Rose',  icon: Compass,          permKey: 'wind_rose' },
  { id: 'alerts',     label: 'Alerts',     icon: Bell,             permKey: 'alerts' },
  { id: 'settings',   label: 'Settings',   icon: SettingsIcon,     permKey: 'settings' },
];

const NAV_ADMIN = [
  { id: 'admin-stations', label: 'Manage Stations', icon: Radio },
  { id: 'admin-clients',  label: 'Manage Clients',  icon: Users },
];

function NavItem({ item, active, onClick, collapsed }) {
  const Icon = item.icon;
  return (
    <button onClick={onClick} title={collapsed ? item.label : undefined} style={{
      display: 'flex', alignItems: 'center', gap: 10, width: '100%',
      padding: collapsed ? '10px 14px' : '10px 12px', borderRadius: 12, border: 'none',
      background: active ? 'var(--glass-inner-bg)' : 'transparent',
      cursor: 'pointer', color: active ? 'var(--text)' : 'var(--text-muted)',
      fontSize: 13, fontWeight: active ? 600 : 500, fontFamily: 'var(--font)',
      transition: 'all 0.2s', boxShadow: active ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
    }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--glass-inner-bg)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
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
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>{desc}</p>
      </div>
    </div>
  );
}

// ── Inner app — uses permissions context ──────────────────────────────────────

function AppInner({ profile, session, onLogout }) {
  const { isHFCL, isAdmin, hasPageAccess, loaded } = usePermissions();
  const [page, setPage] = useState('dashboard');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 768);
  const [dark, setDark] = useState(() => localStorage.getItem('airwatch-theme') === 'dark');
  const [tickerVisible, setTickerVisible] = useState(() => localStorage.getItem('airwatch-ticker') !== 'off');
  const [pushBanner, setPushBanner] = useState(() => {
    const perm = typeof Notification !== 'undefined' ? Notification.permission : 'default';
    return perm === 'default' && !localStorage.getItem('airwatch-push-dismissed');
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('airwatch-theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  // Determine which nav to show
  const navItems = isHFCL ? NAV_HFCL : NAV_CLIENT_ALL.filter(i => hasPageAccess(i.permKey));
  const showAdminNav = isHFCL && (profile?.role === 'admin' || profile?.role === 'super_admin');
  const orgName = profile?.organizations?.name || 'Organization';

  // Guard: redirect client to dashboard if they navigate to a forbidden page
  useEffect(() => {
    if (!loaded) return;
    if (!isHFCL && !hasPageAccess(page.replace('-', '_'))) {
      setPage('dashboard');
    }
  }, [loaded, page]);

  function renderPage() {
    switch (page) {
      case 'dashboard':        return <Dashboard profile={profile} dark={dark} />;
      case 'charts':           return <Charts profile={profile} />;
      case 'compliance':       return hasPageAccess('compliance') ? <Compliance profile={profile} onNavigate={navigate} /> : <Dashboard profile={profile} />;
      case 'wind-rose':        return hasPageAccess('wind_rose') ? <WindRosePage profile={profile} /> : <Dashboard profile={profile} />;
      case 'data':             return <DataTable profile={profile} />;
      case 'reports':          return <Reports profile={profile} />;
      case 'alerts':           return <Alerts profile={profile} />;
      case 'settings':         return <Settings profile={profile} />;
      case 'admin-stations':   return showAdminNav ? <AdminStations /> : <Dashboard profile={profile} />;
      case 'admin-clients':    return showAdminNav ? <AdminClients /> : <Dashboard profile={profile} />;
      case 'admin-settings':   return showAdminNav ? <Placeholder title="System Settings" desc="Coming soon." icon={Shield} /> : <Dashboard profile={profile} />;
      default:                 return <Dashboard profile={profile} />;
    }
  }

  function navigate(id) {
    setPage(id);
    if (isMobile) setSidebarOpen(false);
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

      {/* Mobile hamburger */}
      {isMobile && (
        <button onClick={() => setSidebarOpen(true)} style={{ display: sidebarOpen ? 'none' : 'flex', position: 'fixed', top: 14, left: 14, zIndex: 40, width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', ...glassInner(), border: '1px solid rgba(255,255,255,0.5)', cursor: 'pointer' }}>
          <Menu size={18} color="var(--text-mid)" />
        </button>
      )}

      {/* Mobile backdrop */}
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 25, background: 'rgba(0,0,0,0.4)' }} />
      )}

      {/* Sidebar */}
      <aside style={{
        ...glass({ borderRadius: 0, border: 'none', borderRight: '1px solid var(--border)', background: 'var(--sidebar-bg)' }),
        width: isMobile ? 240 : (sidebarOpen ? 240 : 64),
        transform: isMobile ? (sidebarOpen ? 'translateX(0)' : 'translateX(-100%)') : 'translateX(0)',
        transition: isMobile ? 'transform 0.3s cubic-bezier(.16,1,.3,1)' : 'width 0.3s cubic-bezier(.16,1,.3,1)',
        display: 'flex', flexDirection: 'column', position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 30, overflow: 'hidden',
      }}>
        <div style={{ padding: sidebarOpen ? '20px 20px 16px' : '20px 14px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)' }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, rgba(16,185,129,0.75), rgba(6,182,212,0.75))', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.5)', flexShrink: 0 }}>
            <Wind size={18} color="#fff" />
          </div>
          {sidebarOpen && <div><h1 style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em' }}>AirWatch<span style={{ color: '#16A34A' }}>.</span></h1><p style={{ fontSize: 10, color: 'var(--text-faint)' }}>Hills and Field</p></div>}
        </div>

        <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ position: 'absolute', top: 22, right: -12, width: 24, height: 24, borderRadius: '50%', ...glassInner(), display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.5)', zIndex: 2 }}>
          <ChevronRight size={12} color="var(--text-muted)" style={{ transform: sidebarOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s' }} />
        </button>

        <nav style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
          {sidebarOpen && <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '8px 12px 4px' }}>MONITOR</p>}
          {navItems.map(i => <NavItem key={i.id} item={i} active={page === i.id} onClick={() => navigate(i.id)} collapsed={!sidebarOpen} />)}
          {showAdminNav && <>
            {sidebarOpen && <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '16px 12px 4px' }}>ADMIN</p>}
            {!sidebarOpen && <div style={{ borderTop: '1px solid var(--border)', margin: '8px 4px' }} />}
            {NAV_ADMIN.map(i => <NavItem key={i.id} item={i} active={page === i.id} onClick={() => navigate(i.id)} collapsed={!sidebarOpen} />)}
          </>}
        </nav>

        <div style={{ padding: '12px 8px', borderTop: '1px solid var(--border)' }}>
          {sidebarOpen && (
            <div style={{ padding: '8px 12px', marginBottom: 4 }}>
              <p style={{ fontSize: 13, fontWeight: 600 }}>{profile?.full_name || 'User'}</p>
              <p style={{ fontSize: 11, color: 'var(--text-faint)' }}>{orgName}</p>
              {!isHFCL && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 8, background: 'rgba(59,130,246,0.10)', color: '#3B82F6' }}>CLIENT</span>}
            </div>
          )}
          {/* Dark mode + ticker toggles */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <button onClick={() => setDark(d => !d)} title={dark ? 'Light mode' : 'Dark mode'} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: sidebarOpen ? 'flex-start' : 'center', gap: 8, padding: sidebarOpen ? '8px 12px' : '8px 0', borderRadius: 10, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, fontWeight: 500, fontFamily: 'var(--font)', transition: 'background 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {dark ? <Sun size={15} /> : <Moon size={15} />}{sidebarOpen && (dark ? 'Light Mode' : 'Dark Mode')}
            </button>
            {sidebarOpen && (
              <button onClick={() => { setTickerVisible(v => { const next = !v; localStorage.setItem('airwatch-ticker', next ? 'on' : 'off'); return next; }); }} title={tickerVisible ? 'Hide ticker' : 'Show ticker'} style={{ flexShrink: 0, padding: '8px 10px', borderRadius: 10, border: 'none', background: tickerVisible ? 'rgba(34,197,94,0.12)' : 'transparent', cursor: 'pointer', color: tickerVisible ? '#22c55e' : 'var(--text-faint)', fontSize: 10, fontWeight: 700, fontFamily: 'var(--font)', transition: 'background 0.2s', letterSpacing: '0.05em' }}>
                LIVE
              </button>
            )}
          </div>
          <button onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: sidebarOpen ? '10px 12px' : '10px 14px', borderRadius: 12, border: 'none', background: 'rgba(220,38,38,0.06)', cursor: 'pointer', color: '#DC2626', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font)', transition: 'background 0.2s' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(220,38,38,0.12)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(220,38,38,0.06)'}
          >
            <LogOut size={16} />{sidebarOpen && 'Sign Out'}
          </button>
        </div>
      </aside>

      {/* Ticker strip — fixed at top, respects sidebar */}
      {tickerVisible && (
        <div style={{ position: 'fixed', top: 0, left: isMobile ? 0 : (sidebarOpen ? 240 : 64), right: 0, zIndex: 20, transition: 'left 0.3s cubic-bezier(.16,1,.3,1)' }}>
          <TickerStrip visible={tickerVisible} />
        </div>
      )}

      {/* Push notification permission banner */}
      {pushBanner && (
        <div style={{
          position: 'fixed',
          bottom: 16, left: isMobile ? 12 : (sidebarOpen ? 252 : 76),
          right: 16, zIndex: 25,
          ...glass({ padding: '12px 16px', borderRadius: 14 }),
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
          transition: 'left 0.3s cubic-bezier(.16,1,.3,1)',
          animation: 'glassIn 0.4s ease both',
        }}>
          <Bell size={16} color="#0d9488" style={{ flexShrink: 0 }} />
          <p style={{ flex: 1, fontSize: 13, color: 'var(--text)', margin: 0, minWidth: 200 }}>
            Enable push notifications for real-time air quality alerts
          </p>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              onClick={async () => {
                setPushBanner(false);
                localStorage.setItem('airwatch-push-dismissed', '1');
                if ('Notification' in window) {
                  const permission = await Notification.requestPermission();
                  if (permission === 'granted') {
                    localStorage.setItem('airwatch-push-enabled', '1');
                  }
                }
              }}
              style={{ padding: '7px 14px', borderRadius: 9, border: 'none', background: '#0d9488', color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font)', cursor: 'pointer' }}
            >Enable</button>
            <button
              onClick={() => { setPushBanner(false); localStorage.setItem('airwatch-push-dismissed', '1'); }}
              style={{ padding: '7px 12px', borderRadius: 9, border: 'none', background: 'var(--glass-inner-bg)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 500, fontFamily: 'var(--font)', cursor: 'pointer' }}
            >Not Now</button>
          </div>
        </div>
      )}

      <main style={{ flex: 1, marginLeft: isMobile ? 0 : (sidebarOpen ? 240 : 64), transition: 'margin-left 0.3s cubic-bezier(.16,1,.3,1)', position: 'relative', zIndex: 1, padding: isMobile ? `${tickerVisible ? 96 : 60}px 12px 24px` : `${tickerVisible ? 60 : 24}px 24px 24px`, width: '100%', overflowX: 'hidden', minWidth: 0, boxSizing: 'border-box' }}>
        {renderPage()}
      </main>
    </div>
  );
}

// ── Root app — manages auth, wraps with PermissionsProvider ───────────────────

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

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
    setSession(null); setProfile(null);
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

  return (
    <PermissionsProvider profile={profile}>
      <AppInner profile={profile} session={session} onLogout={handleLogout} />
    </PermissionsProvider>
  );
}
