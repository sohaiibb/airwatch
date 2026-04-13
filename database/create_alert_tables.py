"""
One-time migration: create alert tables in Supabase.

Usage (run from the backend/ directory or project root):
    python3 database/create_alert_tables.py

Requires DATABASE_URL env var:
  Get it from: Supabase dashboard → Project Settings → Database
               → Connection string → URI (replace [YOUR-PASSWORD])
  Add to backend/.env:
    DATABASE_URL=postgresql://postgres.{ref}:{password}@aws-0-{region}.pooler.supabase.com:5432/postgres

Alternatively, paste alerts_schema.sql directly into the Supabase SQL Editor.
"""
import os, sys
from pathlib import Path

# Load .env from backend/
env_path = Path(__file__).parent.parent / "backend" / ".env"
if env_path.exists():
    from dotenv import load_dotenv
    load_dotenv(env_path)

DATABASE_URL = os.getenv("DATABASE_URL", "")

SQL = """
-- Alert Events
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

-- Alert Log
CREATE TABLE IF NOT EXISTS alert_log (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID        REFERENCES alert_events(id) ON DELETE SET NULL,
  station_id UUID        NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  action     TEXT        NOT NULL,
  details    JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
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

-- System Settings
CREATE TABLE IF NOT EXISTS system_settings (
  key        TEXT        PRIMARY KEY,
  value      JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default settings row
INSERT INTO system_settings (key, value)
VALUES ('email_config', '{"provider": null, "configured": false}')
ON CONFLICT (key) DO NOTHING;

-- RLS policies
ALTER TABLE alert_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings   ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='alert_events'      AND policyname='read_alert_events')      THEN CREATE POLICY read_alert_events      ON alert_events      FOR SELECT USING (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='alert_log'         AND policyname='read_alert_log')         THEN CREATE POLICY read_alert_log         ON alert_log         FOR SELECT USING (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='alert_subscribers' AND policyname='read_alert_subscribers') THEN CREATE POLICY read_alert_subscribers ON alert_subscribers FOR SELECT USING (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='system_settings'   AND policyname='read_system_settings')   THEN CREATE POLICY read_system_settings   ON system_settings   FOR SELECT USING (true); END IF;
END $$;

-- Seed default NCEC rules (idempotent)
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
"""

def run():
    if not DATABASE_URL:
        print("=" * 60)
        print("ERROR: DATABASE_URL not set.")
        print()
        print("Get it from:")
        print("  Supabase Dashboard → Project Settings → Database")
        print("  → Connection string → URI")
        print("  Replace [YOUR-PASSWORD] with your database password.")
        print()
        print("Add to backend/.env:")
        print("  DATABASE_URL=postgresql://postgres.khercexknekkwpbwvnid:...")
        print()
        print("OR paste database/alerts_schema.sql into the Supabase SQL Editor.")
        print("=" * 60)
        sys.exit(1)

    try:
        import psycopg2
    except ImportError:
        print("Installing psycopg2-binary...")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary", "-q"])
        import psycopg2

    print("Connecting to database...")
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor()

    print("Running migrations...")
    try:
        cur.execute(SQL)
        print("✓ alert_events table created/verified")
        print("✓ alert_log table created/verified")
        print("✓ alert_subscribers table created/verified")
        print("✓ system_settings table created/verified")
        print("✓ Default NCEC rules seeded")
        print()
        print("Migration complete. The alert engine will start working on the next poll cycle.")
    except Exception as e:
        print(f"Migration failed: {e}")
        sys.exit(1)
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    run()
