-- ── AirWatch Alerts Schema ────────────────────────────────────────────────────
-- Run this in Supabase Dashboard → SQL Editor
-- Safe to run multiple times (all statements are idempotent).

-- ── 1. alert_events ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id       UUID        NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  pollutant        TEXT        NOT NULL,
  period           TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'warning',
  measured_value   NUMERIC,
  threshold        NUMERIC     NOT NULL,
  warning_pct      INTEGER     DEFAULT 80,
  started_at       TIMESTAMPTZ DEFAULT NOW(),
  last_notified_at TIMESTAMPTZ,
  cleared_at       TIMESTAMPTZ,
  peak_value       NUMERIC,
  peak_at          TIMESTAMPTZ,
  hour_count       INTEGER     DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. alert_log ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_log (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID        REFERENCES alert_events(id) ON DELETE SET NULL,
  station_id UUID        NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  action     TEXT        NOT NULL,
  details    JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. alert_rules ───────────────────────────────────────────────────────────
-- The table already exists with the old schema.  We ADD the new columns that
-- alerts.py needs (pollutant, period, enabled, warning_pct, is_custom).
-- Existing data is untouched; old columns remain for backwards compat.
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS pollutant   TEXT;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS period      TEXT;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS enabled     BOOLEAN DEFAULT TRUE;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS warning_pct INTEGER DEFAULT 80;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS is_custom   BOOLEAN DEFAULT FALSE;

-- Back-fill pollutant/period from old columns where missing
UPDATE alert_rules
SET    pollutant = parameter,
       period    = averaging_period
WHERE  pollutant IS NULL
  AND  parameter IS NOT NULL;

-- ── 4. alert_subscribers ─────────────────────────────────────────────────────
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

-- ── 5. system_settings ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_settings (
  key        TEXT        PRIMARY KEY,
  value      JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO system_settings (key, value)
VALUES ('email_config', '{"provider": null, "configured": false, "from_email": "", "smtp_host": "", "smtp_port": 587, "smtp_user": "", "resend_api_key": ""}')
ON CONFLICT (key) DO NOTHING;

-- ── 6. Seed default NCEC rules (idempotent) ──────────────────────────────────
-- Uses pollutant+period uniqueness via a DO block to stay idempotent even
-- without a UNIQUE constraint on the existing table.
DO $$
DECLARE
  rules JSONB := '[
    {"pollutant":"pm25","period":"24-hour","threshold":35,    "warning_pct":80},
    {"pollutant":"pm10","period":"24-hour","threshold":340,   "warning_pct":80},
    {"pollutant":"so2", "period":"1-hour", "threshold":441,   "warning_pct":80},
    {"pollutant":"so2", "period":"24-hour","threshold":217,   "warning_pct":80},
    {"pollutant":"no2", "period":"1-hour", "threshold":200,   "warning_pct":80},
    {"pollutant":"o3",  "period":"8-hour", "threshold":157,   "warning_pct":80},
    {"pollutant":"co",  "period":"1-hour", "threshold":40000, "warning_pct":80},
    {"pollutant":"co",  "period":"8-hour", "threshold":10000, "warning_pct":80}
  ]'::JSONB;
  r JSONB;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(rules)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM alert_rules
      WHERE  pollutant = r->>'pollutant'
        AND  period    = r->>'period'
        AND  station_id IS NULL
    ) THEN
      INSERT INTO alert_rules (station_id, pollutant, period, threshold, warning_pct, enabled, is_custom)
      VALUES (
        NULL,
        r->>'pollutant',
        r->>'period',
        (r->>'threshold')::NUMERIC,
        (r->>'warning_pct')::INTEGER,
        TRUE,
        FALSE
      );
    END IF;
  END LOOP;
END $$;

-- ── 7. RLS policies ──────────────────────────────────────────────────────────
ALTER TABLE alert_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules       ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings   ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='alert_events'      AND policyname='read_alert_events')      THEN CREATE POLICY read_alert_events      ON alert_events      FOR SELECT USING (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='alert_log'         AND policyname='read_alert_log')         THEN CREATE POLICY read_alert_log         ON alert_log         FOR SELECT USING (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='alert_rules'       AND policyname='read_alert_rules')       THEN CREATE POLICY read_alert_rules       ON alert_rules       FOR SELECT USING (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='alert_subscribers' AND policyname='read_alert_subscribers') THEN CREATE POLICY read_alert_subscribers ON alert_subscribers FOR SELECT USING (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='system_settings'   AND policyname='read_system_settings')   THEN CREATE POLICY read_system_settings   ON system_settings   FOR SELECT USING (true); END IF;
END $$;
