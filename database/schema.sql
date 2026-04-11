-- ═══════════════════════════════════════════════════════════════
-- AirWatch — Supabase Database Schema
-- Multi-tenant air quality monitoring platform
-- Hills and Field Company Limited
-- ═══════════════════════════════════════════════════════════════

-- Run this ONCE in Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- ─── 1. Organizations (Your Clients) ───
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,               -- url-friendly name: "maaden", "neom"
    logo_url TEXT,                            -- uploaded to Supabase Storage
    primary_color TEXT DEFAULT '#16A34A',     -- branding color per client
    contact_name TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Hills and Field is always org #1 (admin org)
INSERT INTO organizations (name, slug, contact_name, contact_email, notes)
VALUES ('Hills and Field', 'hfcl', 'Sohaib', 'admin@hillsnfield.com', 'Admin organization — platform owner');


-- ─── 2. User Profiles (extends Supabase Auth) ───
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'manager', 'viewer')),
    -- admin: Hills and Field team — full access to everything
    -- manager: client power user — can view all their org's stations + download reports
    -- viewer: client read-only — can view assigned stations only
    avatar_url TEXT,
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);


-- ─── 3. User Preferences ───
CREATE TABLE user_preferences (
    user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    theme TEXT DEFAULT 'light' CHECK (theme IN ('light', 'dark')),
    units_concentration TEXT DEFAULT 'ugm3' CHECK (units_concentration IN ('ugm3', 'ppb', 'ppm')),
    units_temperature TEXT DEFAULT 'celsius' CHECK (units_temperature IN ('celsius', 'fahrenheit')),
    units_wind TEXT DEFAULT 'ms' CHECK (units_wind IN ('ms', 'kmh', 'mph', 'knots')),
    default_time_range TEXT DEFAULT '24h' CHECK (default_time_range IN ('1h', '6h', '12h', '24h', '7d', '30d')),
    default_station_id UUID,                 -- which station loads first
    alert_email BOOLEAN DEFAULT true,
    alert_whatsapp BOOLEAN DEFAULT false,
    language TEXT DEFAULT 'en' CHECK (language IN ('en', 'ar')),
    updated_at TIMESTAMPTZ DEFAULT now()
);


-- ─── 4. Stations ───
CREATE TABLE stations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,                       -- "khobar-central"
    description TEXT,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    altitude DOUBLE PRECISION,               -- meters above sea level
    
    -- Data source config
    device_id TEXT,                           -- e.g. "ENE04771"
    api_base_url TEXT,                        -- e.g. "https://apis.enggenv.com/api/v1/uz/data"
    api_auth_token TEXT,                      -- if API needs auth
    data_protocol TEXT DEFAULT 'rest' CHECK (data_protocol IN ('rest', 'modbus', 'mqtt', 'manual')),
    polling_interval_seconds INTEGER DEFAULT 300,  -- 5 min default
    
    -- Field mapping: maps raw API field names → dashboard parameters
    field_mapping JSONB DEFAULT '{
        "pm25": "PM2.5",
        "pm10": "PM10",
        "so2": "so2",
        "no2": "no2",
        "o3": "o3",
        "co": "CO",
        "temperature": "Temperature",
        "humidity": "Humidity",
        "pressure": "press",
        "wind_speed": "ws",
        "wind_direction": "Wind Direction"
    }'::jsonb,
    
    -- Unit conversions per field (null = no conversion needed)
    unit_conversions JSONB DEFAULT '{}'::jsonb,
    
    -- NCEC thresholds (override defaults per station if needed)
    ncec_thresholds JSONB DEFAULT '{
        "pm25_24h": 35,
        "pm10_24h": 340,
        "so2_1h": 350,
        "so2_24h": 80,
        "no2_1h": 200,
        "no2_annual": 40,
        "o3_1h": 200,
        "o3_8h": 120,
        "co_1h": 40,
        "co_8h": 10
    }'::jsonb,
    
    status TEXT DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'stale', 'maintenance')),
    last_data_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(org_id, slug)
);


-- ─── 5. Readings (Time-Series Sensor Data) ───
CREATE TABLE readings (
    id BIGSERIAL PRIMARY KEY,
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL,
    
    -- Air quality
    aqi INTEGER,
    pm25 DOUBLE PRECISION,                   -- µg/m³
    pm10 DOUBLE PRECISION,                   -- µg/m³
    so2 DOUBLE PRECISION,                    -- µg/m³
    no2 DOUBLE PRECISION,                    -- µg/m³
    o3 DOUBLE PRECISION,                     -- µg/m³
    co DOUBLE PRECISION,                     -- mg/m³
    
    -- Meteorological
    temperature DOUBLE PRECISION,            -- °C
    humidity DOUBLE PRECISION,               -- %
    pressure DOUBLE PRECISION,               -- hPa
    wind_speed DOUBLE PRECISION,             -- m/s
    wind_direction DOUBLE PRECISION,         -- degrees (0-360)
    visibility DOUBLE PRECISION,             -- km
    
    -- Raw data (store original API response for debugging)
    raw_data JSONB,
    source TEXT DEFAULT 'api',               -- 'api', 'manual', 'aqicn', 'owm'
    
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Critical indexes for fast queries
CREATE INDEX idx_readings_station_time ON readings(station_id, timestamp DESC);
CREATE INDEX idx_readings_timestamp ON readings(timestamp DESC);
-- Unique constraint to prevent duplicate readings
CREATE UNIQUE INDEX idx_readings_unique ON readings(station_id, timestamp);


-- ─── 6. Hourly Aggregates (pre-computed for fast charts) ───
CREATE TABLE hourly_aggregates (
    id BIGSERIAL PRIMARY KEY,
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    hour_start TIMESTAMPTZ NOT NULL,
    
    pm25_avg DOUBLE PRECISION, pm25_min DOUBLE PRECISION, pm25_max DOUBLE PRECISION,
    pm10_avg DOUBLE PRECISION, pm10_min DOUBLE PRECISION, pm10_max DOUBLE PRECISION,
    so2_avg DOUBLE PRECISION,  so2_min DOUBLE PRECISION,  so2_max DOUBLE PRECISION,
    no2_avg DOUBLE PRECISION,  no2_min DOUBLE PRECISION,  no2_max DOUBLE PRECISION,
    o3_avg DOUBLE PRECISION,   o3_min DOUBLE PRECISION,   o3_max DOUBLE PRECISION,
    co_avg DOUBLE PRECISION,   co_min DOUBLE PRECISION,   co_max DOUBLE PRECISION,
    
    temperature_avg DOUBLE PRECISION,
    humidity_avg DOUBLE PRECISION,
    wind_speed_avg DOUBLE PRECISION,
    
    readings_count INTEGER DEFAULT 0,
    
    UNIQUE(station_id, hour_start)
);

CREATE INDEX idx_hourly_station_time ON hourly_aggregates(station_id, hour_start DESC);


-- ─── 7. Daily Aggregates ───
CREATE TABLE daily_aggregates (
    id BIGSERIAL PRIMARY KEY,
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    
    pm25_avg DOUBLE PRECISION, pm25_min DOUBLE PRECISION, pm25_max DOUBLE PRECISION,
    pm10_avg DOUBLE PRECISION, pm10_min DOUBLE PRECISION, pm10_max DOUBLE PRECISION,
    so2_avg DOUBLE PRECISION,  so2_min DOUBLE PRECISION,  so2_max DOUBLE PRECISION,
    no2_avg DOUBLE PRECISION,  no2_min DOUBLE PRECISION,  no2_max DOUBLE PRECISION,
    o3_avg DOUBLE PRECISION,   o3_min DOUBLE PRECISION,   o3_max DOUBLE PRECISION,
    co_avg DOUBLE PRECISION,   co_min DOUBLE PRECISION,   co_max DOUBLE PRECISION,
    
    temperature_avg DOUBLE PRECISION,
    humidity_avg DOUBLE PRECISION,
    
    aqi_avg INTEGER, aqi_max INTEGER,
    readings_count INTEGER DEFAULT 0,
    exceedance_count INTEGER DEFAULT 0,      -- how many readings exceeded any NCEC threshold
    
    UNIQUE(station_id, date)
);

CREATE INDEX idx_daily_station_date ON daily_aggregates(station_id, date DESC);


-- ─── 8. Alert Rules ───
CREATE TABLE alert_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    parameter TEXT NOT NULL CHECK (parameter IN ('pm25', 'pm10', 'so2', 'no2', 'o3', 'co', 'aqi')),
    operator TEXT NOT NULL CHECK (operator IN ('>', '>=', '<', '<=')),
    threshold DOUBLE PRECISION NOT NULL,
    averaging_period TEXT DEFAULT 'instant' CHECK (averaging_period IN ('instant', '1h', '8h', '24h')),
    notify_emails TEXT[],                    -- array of email addresses
    notify_whatsapp TEXT[],                  -- array of phone numbers
    cooldown_minutes INTEGER DEFAULT 60,     -- don't re-alert within this window
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT now()
);


-- ─── 9. Alert History ───
CREATE TABLE alert_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    parameter TEXT NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    threshold DOUBLE PRECISION NOT NULL,
    message TEXT,
    acknowledged BOOLEAN DEFAULT false,
    acknowledged_by UUID REFERENCES profiles(id),
    acknowledged_at TIMESTAMPTZ
);

CREATE INDEX idx_alerts_station_time ON alert_history(station_id, triggered_at DESC);


-- ─── 10. Reports ───
CREATE TABLE reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    station_id UUID REFERENCES stations(id) ON DELETE SET NULL,  -- null = all stations
    title TEXT NOT NULL,
    report_type TEXT NOT NULL CHECK (report_type IN ('daily', 'weekly', 'monthly', 'custom', 'compliance', 'incident')),
    date_from DATE NOT NULL,
    date_to DATE NOT NULL,
    file_url TEXT,                            -- Supabase Storage path
    file_size_bytes BIGINT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'ready', 'failed')),
    generated_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT now()
);


-- ─── 11. Audit Log (track who did what) ───
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES profiles(id),
    action TEXT NOT NULL,                    -- 'station.create', 'user.login', 'report.generate', etc.
    entity_type TEXT,                        -- 'station', 'organization', 'user', 'alert'
    entity_id UUID,
    details JSONB,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_time ON audit_log(created_at DESC);
CREATE INDEX idx_audit_user ON audit_log(user_id, created_at DESC);


-- ═══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (Multi-Tenancy)
-- This ensures clients can ONLY see their own data
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hourly_aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Helper function: get current user's org_id
CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS UUID AS $$
    SELECT org_id FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function: check if current user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM profiles 
        WHERE id = auth.uid() 
        AND role = 'admin'
    )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── Organizations ──
CREATE POLICY "Admins see all orgs" ON organizations
    FOR ALL USING (is_admin());
CREATE POLICY "Users see own org" ON organizations
    FOR SELECT USING (id = get_user_org_id());

-- ── Profiles ──
CREATE POLICY "Admins manage all profiles" ON profiles
    FOR ALL USING (is_admin());
CREATE POLICY "Users see own profile" ON profiles
    FOR SELECT USING (id = auth.uid());
CREATE POLICY "Users update own profile" ON profiles
    FOR UPDATE USING (id = auth.uid());

-- ── User Preferences ──
CREATE POLICY "Users manage own preferences" ON user_preferences
    FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Admins see all preferences" ON user_preferences
    FOR SELECT USING (is_admin());

-- ── Stations ──
CREATE POLICY "Admins manage all stations" ON stations
    FOR ALL USING (is_admin());
CREATE POLICY "Users see own org stations" ON stations
    FOR SELECT USING (org_id = get_user_org_id());

-- ── Readings ──
CREATE POLICY "Admins see all readings" ON readings
    FOR ALL USING (is_admin());
CREATE POLICY "Users see own station readings" ON readings
    FOR SELECT USING (
        station_id IN (SELECT id FROM stations WHERE org_id = get_user_org_id())
    );

-- ── Hourly Aggregates ──
CREATE POLICY "Admins see all hourly" ON hourly_aggregates
    FOR ALL USING (is_admin());
CREATE POLICY "Users see own hourly" ON hourly_aggregates
    FOR SELECT USING (
        station_id IN (SELECT id FROM stations WHERE org_id = get_user_org_id())
    );

-- ── Daily Aggregates ──
CREATE POLICY "Admins see all daily" ON daily_aggregates
    FOR ALL USING (is_admin());
CREATE POLICY "Users see own daily" ON daily_aggregates
    FOR SELECT USING (
        station_id IN (SELECT id FROM stations WHERE org_id = get_user_org_id())
    );

-- ── Alert Rules ──
CREATE POLICY "Admins manage all alerts" ON alert_rules
    FOR ALL USING (is_admin());
CREATE POLICY "Users see own station alerts" ON alert_rules
    FOR SELECT USING (
        station_id IN (SELECT id FROM stations WHERE org_id = get_user_org_id())
    );

-- ── Alert History ──
CREATE POLICY "Admins see all alert history" ON alert_history
    FOR ALL USING (is_admin());
CREATE POLICY "Users see own alert history" ON alert_history
    FOR SELECT USING (
        station_id IN (SELECT id FROM stations WHERE org_id = get_user_org_id())
    );

-- ── Reports ──
CREATE POLICY "Admins manage all reports" ON reports
    FOR ALL USING (is_admin());
CREATE POLICY "Users see own org reports" ON reports
    FOR SELECT USING (org_id = get_user_org_id());

-- ── Audit Log ──
CREATE POLICY "Admins see all audit" ON audit_log
    FOR ALL USING (is_admin());
CREATE POLICY "Users see own audit" ON audit_log
    FOR SELECT USING (user_id = auth.uid());


-- ═══════════════════════════════════════════════════════════════
-- FUNCTIONS
-- ═══════════════════════════════════════════════════════════════

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_organizations_updated BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_profiles_updated BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_stations_updated BEFORE UPDATE ON stations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-create user preferences on profile creation
CREATE OR REPLACE FUNCTION create_default_preferences()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_preferences (user_id) VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_profile_preferences AFTER INSERT ON profiles
    FOR EACH ROW EXECUTE FUNCTION create_default_preferences();

-- Calculate US AQI from PM2.5 value
CREATE OR REPLACE FUNCTION calc_aqi_pm25(pm25_val DOUBLE PRECISION)
RETURNS INTEGER AS $$
DECLARE
    aqi INTEGER;
BEGIN
    IF pm25_val IS NULL THEN RETURN NULL; END IF;
    IF pm25_val <= 12.0 THEN
        aqi := ROUND((50.0 / 12.0) * pm25_val);
    ELSIF pm25_val <= 35.4 THEN
        aqi := ROUND(50 + (49.0 / 23.4) * (pm25_val - 12.1));
    ELSIF pm25_val <= 55.4 THEN
        aqi := ROUND(100 + (49.0 / 20.0) * (pm25_val - 35.5));
    ELSIF pm25_val <= 150.4 THEN
        aqi := ROUND(150 + (49.0 / 95.0) * (pm25_val - 55.5));
    ELSIF pm25_val <= 250.4 THEN
        aqi := ROUND(200 + (99.0 / 100.0) * (pm25_val - 150.5));
    ELSIF pm25_val <= 350.4 THEN
        aqi := ROUND(300 + (99.0 / 100.0) * (pm25_val - 250.5));
    ELSE
        aqi := ROUND(400 + (99.0 / 149.6) * (pm25_val - 350.5));
    END IF;
    RETURN LEAST(aqi, 500);
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- ═══════════════════════════════════════════════════════════════
-- STORAGE BUCKETS (run in Supabase Dashboard → Storage)
-- ═══════════════════════════════════════════════════════════════
-- Create these buckets manually in Supabase Storage:
--   1. "logos"   — client organization logos (public)
--   2. "reports" — generated PDF reports (private, RLS)
--   3. "avatars" — user profile pictures (public)


-- ═══════════════════════════════════════════════════════════════
-- DONE — Schema ready
-- Next: Create your admin user in Supabase Auth
-- ═══════════════════════════════════════════════════════════════
