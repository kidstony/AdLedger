-- Migration: lệnh "discover" + lưu XHR bắt được (cho "Cấu hình tự động" trong Admin)
-- Chạy trong Supabase SQL Editor (idempotent).

-- 1) Cho phép engine_commands.type = 'discover'
ALTER TABLE engine_commands DROP CONSTRAINT IF EXISTS engine_commands_type_check;
ALTER TABLE engine_commands
  ADD CONSTRAINT engine_commands_type_check CHECK (type IN ('login','fetch','discover'));

-- 2) Bảng lưu response JSON bắt được khi dò dashboard
CREATE TABLE IF NOT EXISTS engine_discoveries (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id  text        NOT NULL,
  account_id  uuid        REFERENCES engine_accounts(id) ON DELETE SET NULL,
  captured    jsonb       NOT NULL DEFAULT '[]',   -- [{ url, payload }]
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_engine_discoveries_network
  ON engine_discoveries(network_id, created_at DESC);

ALTER TABLE engine_discoveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read engine_discoveries" ON engine_discoveries;
CREATE POLICY "authenticated read engine_discoveries" ON engine_discoveries
  FOR SELECT TO authenticated USING (true);
