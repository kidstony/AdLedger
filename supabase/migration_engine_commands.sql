-- Migration: hàng lệnh engine + trạng thái đăng nhập (điều khiển từ admin)
-- Chạy trong Supabase SQL Editor (idempotent).
--
-- Admin đẩy lệnh (login/fetch) vào engine_commands; worker (engine luôn bật) poll
-- và thực thi, cập nhật status. login_status/last_login_at trên engine_accounts để
-- admin hiển thị badge kết nối.

CREATE TABLE IF NOT EXISTS engine_commands (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text        NOT NULL CHECK (type IN ('login','fetch')),
  account_id   uuid        REFERENCES engine_accounts(id) ON DELETE CASCADE,
  network_id   text,
  status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','error')),
  force        boolean     NOT NULL DEFAULT false,
  message      text,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  finished_at  timestamptz
);

-- Cho bảng đã tạo trước đó (idempotent).
ALTER TABLE engine_commands ADD COLUMN IF NOT EXISTS force boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_engine_commands_pending
  ON engine_commands(created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_engine_commands_account ON engine_commands(account_id);

ALTER TABLE engine_accounts
  ADD COLUMN IF NOT EXISTS login_status  text NOT NULL DEFAULT 'never'
    CHECK (login_status IN ('never','ok','needs_login','error')),
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

-- RLS: authenticated đọc; ghi qua service role (API/worker).
ALTER TABLE engine_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read engine_commands" ON engine_commands;
CREATE POLICY "authenticated read engine_commands" ON engine_commands
  FOR SELECT TO authenticated USING (true);
