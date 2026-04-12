-- Push notification subscriptions
-- Run this in the Supabase SQL editor

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint    text UNIQUE NOT NULL,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Service role can read all (for backend to send pushes)
CREATE POLICY "service_read" ON push_subscriptions
  FOR SELECT USING (true);

CREATE POLICY "users_manage_own" ON push_subscriptions
  FOR ALL USING (user_id = auth.uid());
