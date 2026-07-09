-- Migration: cài đặt auto-sync (worker tự fetch định kỳ)
-- Chạy trong Supabase SQL Editor (idempotent).

CREATE TABLE IF NOT EXISTS engine_settings (
  id                 int         PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- singleton
  auto_sync_enabled  boolean     NOT NULL DEFAULT false,
  interval_hours     numeric     NOT NULL DEFAULT 6,
  last_auto_sync_at  timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
INSERT INTO engine_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE engine_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read engine_settings" ON engine_settings;
CREATE POLICY "authenticated read engine_settings" ON engine_settings
  FOR SELECT TO authenticated USING (true);
