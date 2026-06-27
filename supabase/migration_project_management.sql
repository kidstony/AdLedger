-- Migration: Project Management — Camp Manager
-- Chạy trong Supabase SQL Editor

-- ─── 1. Bảng project_categories ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  color           text NOT NULL DEFAULT '#6b7280',
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz DEFAULT now()
);

-- ─── 2. Bảng project_reminders ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_reminders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      text REFERENCES projects(project_id) ON DELETE CASCADE,
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  remind_at       timestamptz NOT NULL,
  repeat_type     text NOT NULL DEFAULT 'none'
                  CHECK (repeat_type IN ('none','daily','weekly','custom')),
  repeat_days     int,
  message         text,
  notify_inapp    boolean NOT NULL DEFAULT true,
  notify_telegram boolean NOT NULL DEFAULT false,
  is_triggered    boolean NOT NULL DEFAULT false,
  created_at      timestamptz DEFAULT now()
);

-- ─── 3. Bảng notifications (in-app bell) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  type       text NOT NULL DEFAULT 'reminder',
  title      text NOT NULL,
  body       text,
  project_id text REFERENCES projects(project_id) ON DELETE SET NULL,
  is_read    boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- ─── 4. Thêm cột mới vào bảng projects ───────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS category_id        uuid REFERENCES project_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS affiliate_url      text,
  ADD COLUMN IF NOT EXISTS affiliate_username text,
  ADD COLUMN IF NOT EXISTS affiliate_password text,
  ADD COLUMN IF NOT EXISTS affiliate_network  text,
  ADD COLUMN IF NOT EXISTS statuses           text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS camp_start_date    date,
  ADD COLUMN IF NOT EXISTS person_in_charge   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS note               text,
  ADD COLUMN IF NOT EXISTS created_at         timestamptz DEFAULT now();

-- ─── 5. Index để tìm kiếm nhanh theo statuses ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_projects_statuses ON projects USING gin(statuses);
CREATE INDEX IF NOT EXISTS idx_project_reminders_remind_at ON project_reminders(remind_at) WHERE is_triggered = false;
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id) WHERE is_read = false;
