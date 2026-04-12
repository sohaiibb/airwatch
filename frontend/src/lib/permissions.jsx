import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from './supabase';

// ── Default permissions (admin / HFCL users get everything) ──────────────────
export const FULL_PERMISSIONS = {
  page_access:    { dashboard: true, charts: true, data: true, reports: true, compliance: true, wind_rose: true, alerts: true, settings: true },
  visible_parameters: { pm25: true, pm10: true, so2: true, no2: true, o3: true, co: true, temp: true, rh: true, ws: true, wd: true },
  report_access:  { preview: true, pdf: true, csv: true, excel: true, max_days: null, averaging: ['1-min', '15-min', '1-hour', '8-hour', '24-hour'] },
  data_access:    { raw: true, '1min': true, hourly: true, daily: true, csv: true, excel: true, max_days: null },
  dashboard_access: { aqi: true, map: true, health: true, ncec: true, sparklines: true },
};

export const DEFAULT_CLIENT_PERMISSIONS = {
  page_access:    { dashboard: true, charts: true, data: true, reports: true, compliance: false, wind_rose: false, alerts: true, settings: false },
  visible_parameters: { pm25: true, pm10: true, so2: true, no2: true, o3: true, co: true, temp: true, rh: true, ws: true, wd: true },
  report_access:  { preview: true, pdf: true, csv: false, excel: false, max_days: 30, averaging: ['1-hour', '24-hour'] },
  data_access:    { raw: false, '1min': false, hourly: true, daily: true, csv: false, excel: false, max_days: 30 },
  dashboard_access: { aqi: true, map: true, health: true, ncec: false, sparklines: true },
};

export const PRESET_TEMPLATES = {
  basic: {
    label: 'Basic Viewer',
    page_access:    { dashboard: true, charts: true, data: true, reports: true, compliance: false, wind_rose: false, alerts: false, settings: false },
    visible_parameters: { pm25: true, pm10: true, so2: false, no2: false, o3: false, co: false, temp: true, rh: true, ws: true, wd: true },
    report_access:  { preview: true, pdf: true, csv: false, excel: false, max_days: 30, averaging: ['24-hour'] },
    data_access:    { raw: false, '1min': false, hourly: true, daily: true, csv: false, excel: false, max_days: 30 },
    dashboard_access: { aqi: true, map: true, health: true, ncec: false, sparklines: true },
  },
  standard: {
    label: 'Standard Client',
    page_access:    { dashboard: true, charts: true, data: true, reports: true, compliance: false, wind_rose: false, alerts: true, settings: false },
    visible_parameters: { pm25: true, pm10: true, so2: true, no2: true, o3: true, co: true, temp: true, rh: true, ws: true, wd: true },
    report_access:  { preview: true, pdf: true, csv: true, excel: false, max_days: 90, averaging: ['1-hour', '8-hour', '24-hour'] },
    data_access:    { raw: false, '1min': false, hourly: true, daily: true, csv: true, excel: false, max_days: 90 },
    dashboard_access: { aqi: true, map: true, health: true, ncec: false, sparklines: true },
  },
  full: {
    label: 'Full Access',
    ...FULL_PERMISSIONS,
    page_access: { ...FULL_PERMISSIONS.page_access, settings: false },
  },
};

const PermissionsContext = createContext({
  isAdmin: true,
  isHFCL: true,
  permissions: FULL_PERMISSIONS,
  stationPermissions: {},
  loaded: false,
  hasPageAccess: () => true,
  canSeeParam: () => true,
  canExportReport: () => true,
  canExportData: () => true,
  maxDays: (type) => null,
  getStationPerms: (stationId) => FULL_PERMISSIONS,
});

export function PermissionsProvider({ profile, children }) {
  const [isHFCL, setIsHFCL] = useState(true);
  const [isAdmin, setIsAdmin] = useState(true);
  const [permissions, setPermissions] = useState(FULL_PERMISSIONS);
  const [stationPermissions, setStationPermissions] = useState({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!profile) return;
    const hfcl = profile.organizations?.slug === 'hfcl' || profile.role === 'admin' || profile.role === 'super_admin';
    setIsHFCL(hfcl);
    setIsAdmin(hfcl && (profile.role === 'admin' || profile.role === 'super_admin'));

    if (hfcl) {
      setPermissions(FULL_PERMISSIONS);
      setLoaded(true);
      return;
    }
    loadClientPermissions(profile.org_id);
  }, [profile?.id]);

  async function loadClientPermissions(orgId) {
    if (!orgId) { setLoaded(true); return; }
    try {
      const { data } = await supabase
        .from('client_permissions')
        .select('*')
        .eq('organization_id', orgId);

      if (!data || data.length === 0) {
        setPermissions(DEFAULT_CLIENT_PERMISSIONS);
        setLoaded(true);
        return;
      }

      // Build global permissions (station_id IS NULL)
      const global = { ...DEFAULT_CLIENT_PERMISSIONS };
      const byStation = {};

      data.forEach(row => {
        const target = row.station_id ? (byStation[row.station_id] = byStation[row.station_id] || { ...DEFAULT_CLIENT_PERMISSIONS }) : global;
        target[row.permission_type] = { ...target[row.permission_type], ...row.permission_value };
      });

      setPermissions(global);
      setStationPermissions(byStation);
    } catch (e) {
      console.error('[Permissions] Load error:', e);
      setPermissions(DEFAULT_CLIENT_PERMISSIONS);
    }
    setLoaded(true);
  }

  function getStationPerms(stationId) {
    if (isHFCL) return FULL_PERMISSIONS;
    return stationPermissions[stationId] || permissions;
  }

  function hasPageAccess(page) {
    if (isHFCL) return true;
    return permissions.page_access?.[page] !== false;
  }

  function canSeeParam(param, stationId) {
    if (isHFCL) return true;
    const p = getStationPerms(stationId);
    return p.visible_parameters?.[param] !== false;
  }

  function canExportReport(type, stationId) {
    if (isHFCL) return true;
    const p = getStationPerms(stationId);
    return p.report_access?.[type] !== false;
  }

  function canExportData(type, stationId) {
    if (isHFCL) return true;
    const p = getStationPerms(stationId);
    return p.data_access?.[type] !== false;
  }

  function maxDays(type = 'report', stationId) {
    if (isHFCL) return null;
    const p = getStationPerms(stationId);
    const val = type === 'report' ? p.report_access?.max_days : p.data_access?.max_days;
    return val || null;
  }

  return (
    <PermissionsContext.Provider value={{ isAdmin, isHFCL, permissions, stationPermissions, loaded, hasPageAccess, canSeeParam, canExportReport, canExportData, maxDays, getStationPerms }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions() {
  return useContext(PermissionsContext);
}
