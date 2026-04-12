-- ── AirWatch Alerts Schema ────────────────────────────────────────────────────
-- Run this in Supabase SQL editor after the main schema.sql

-- Alert Events: active & historical alert states per station/pollutant/period
CREATE TABLE IF NOT EXISTS alert_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id      UUID        NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  pollutant       TEXT        NOT NULL,
  period          TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'warning',
  measured_value  NUMERIC,
  threshold       NUMERIC     NOT NULL,
  warning_pct     INTEGER     DEFAULT 80,
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  last_notified_at TIMESTAMPTZ,
  cleared_at      TIMESTAMPTZ,
  peak_value      NUMERIC,
  peak_at         TIMESTAMPTZ,
  hour_count      INTEGER     DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Alert Log: immutable audit trail of every notification and state change
CREATE TABLE IF NOT EXISTS alert_log (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID        REFERENCES alert_events(id) ON DELETE SET NULL,
  station_id UUID        NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  action     TEXT        NOT NULL,
  details    JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Alert Rules: per-station overrides (NULL station_id = global default)
CREATE TABLE IF NOT EXISTS alert_rules (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id  UUID        REFERENCES stations(id) ON DELETE CASCADE,
  pollutant   TEXT        NOT NULL,
  period      TEXT        NOT NULL,
  threshold   NUMERIC     NOT NULL,
  warning_pct INTEGER     DEFAULT 80,
  enabled     BOOLEAN     DEFAULT TRUE,
  is_custom   BOOLEAN     DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Alert Subscribers
CREATE TABLE IF NOT EXISTS alert_subscribers (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id       UUID        REFERENCES stations(id) ON DELETE CASCADE,
  email            TEXT        NOT NULL,
  name             TEXT,
  whatsapp_number  TEXT,
  email_enabled    BOOLEAN     DEFAULT TRUE,
  whatsapp_enabled BOOLEAN     DEFAULT FALSE,
  role             TEXT        DEFAULT 'client',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- System Settings (email config, etc.)
CREATE TABLE IF NOT EXISTS system_settings (
  key        TEXT        PRIMARY KEY,
  value      JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default rows
INSERT INTO system_settings (key, value)
VALUES ('email_config', '{"provider": null, "configured": false, "from_email": "", "smtp_host": "", "smtp_port": 587, "smtp_user": "", "resend_api_key": ""}')
ON CONFLICT (key) DO NOTHING;

-- Default global NCEC rules
INSERT INTO alert_rules (station_id, pollutant, period, threshold, warning_pct, enabled, is_custom)
VALUES
  (NULL, 'pm25', '24-hour', 35,    80, TRUE, FALSE),
  (NULL, 'pm10', '24-hour', 340,   80, TRUE, FALSE),
  (NULL, 'so2',  '1-hour',  441,   80, TRUE, FALSE),
  (NULL, 'so2',  '24-hour', 217,   80, TRUE, FALSE),
  (NULL, 'no2',  '1-hour',  200,   80, TRUE, FALSE),
  (NULL, 'o3',   '8-hour',  157,   80, TRUE, FALSE),
  (NULL, 'co',   '1-hour',  40000, 80, TRUE, FALSE),
  (NULL, 'co',   '8-hour',  10000, 80, TRUE, FALSE)
ON CONFLICT DO NOTHING;

-- RLS: allow authenticated and anon reads
ALTER TABLE alert_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules       ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_alert_events"      ON alert_events      FOR SELECT USING (true);
CREATE POLICY "read_alert_log"         ON alert_log         FOR SELECT USING (true);
CREATE POLICY "read_alert_rules"       ON alert_rules       FOR SELECT USING (true);
CREATE POLICY "read_alert_subscribers" ON alert_subscribers FOR SELECT USING (true);
CREATE POLICY "read_system_settings"   ON system_settings   FOR SELECT USING (true);
