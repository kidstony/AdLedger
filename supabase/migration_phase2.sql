-- Migration Phase 2: History log + Telegram config
-- Chạy trong Supabase SQL Editor

-- ─── 1. Bảng project_history ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_history (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text REFERENCES projects(project_id) ON DELETE CASCADE,
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name  text,
  field      text NOT NULL,
  old_value  text,
  new_value  text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_history_project
  ON project_history(project_id, created_at DESC);

-- ─── 2. Telegram config cho organizations ─────────────────────────────────────
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS telegram_bot_token text,
  ADD COLUMN IF NOT EXISTS telegram_chat_id   text;
