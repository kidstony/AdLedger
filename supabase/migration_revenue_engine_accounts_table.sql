-- Migration: quản lý tài khoản Engine trên DB (engine_networks, engine_accounts)
-- Chạy trong Supabase SQL Editor (idempotent).
--
-- Tách "config nghiệp vụ" (tài khoản/ref nào tồn tại + gán dự án nào) ra khỏi
-- file JSON kỹ thuật. Manager gán qua UI; engine đọc account từ đây.
-- Login/profile Chrome vẫn chạy cục bộ trên máy engine (không đụng bảng này).

-- ============================================================
-- engine_networks — engine tự upsert khi chạy để UI biết network sẵn có
-- ============================================================
CREATE TABLE IF NOT EXISTS engine_networks (
  network_id    text        PRIMARY KEY,
  network_name  text        NOT NULL DEFAULT '',
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- engine_accounts — mỗi tài khoản/ref của 1 network, gán về 1 dự án
-- ============================================================
CREATE TABLE IF NOT EXISTS engine_accounts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id   text        NOT NULL,
  account_id   text        NOT NULL,   -- slug = tên thư mục profile Chrome
  label        text        NOT NULL DEFAULT '',
  project_id   text        REFERENCES projects(project_id) ON DELETE SET NULL,
  enabled      boolean     NOT NULL DEFAULT true,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engine_accounts_ukey UNIQUE (network_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_engine_accounts_network ON engine_accounts(network_id);

-- ============================================================
-- RLS: authenticated chỉ đọc; ghi qua service role (API sau requireRole)
-- ============================================================
ALTER TABLE engine_networks ENABLE ROW LEVEL SECURITY;
ALTER TABLE engine_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read engine_networks" ON engine_networks;
CREATE POLICY "authenticated read engine_networks" ON engine_networks
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated read engine_accounts" ON engine_accounts;
CREATE POLICY "authenticated read engine_accounts" ON engine_accounts
  FOR SELECT TO authenticated USING (true);

-- ============================================================
-- Seed: tài khoản blancvpn hiện tại (khớp dữ liệu đang chạy) + network
-- ============================================================
INSERT INTO engine_networks (network_id, network_name)
VALUES ('blancvpn', 'BlancVPN Partner')
ON CONFLICT (network_id) DO NOTHING;

INSERT INTO engine_accounts (network_id, account_id, label, project_id)
VALUES ('blancvpn', 'blancvpn', 'BlancVPN Partner', 'proj011')
ON CONFLICT (network_id, account_id) DO NOTHING;
