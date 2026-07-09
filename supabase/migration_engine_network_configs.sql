-- Migration: config network engine lưu trong DB (quản lý từ Admin)
-- Chạy trong Supabase SQL Editor (idempotent).
--
-- Trước đây mỗi network là 1 file engine/configs/<slug>.json (sửa tay trên máy engine).
-- Giờ lưu config (JSONB, cùng cấu trúc file) vào DB để quản lý/tạo ngay trong Admin.
-- Engine đọc DB trước, không có thì fallback file (giữ tolt/blancvpn chạy).

CREATE TABLE IF NOT EXISTS engine_network_configs (
  network_id  text        PRIMARY KEY,
  config      jsonb       NOT NULL,
  enabled     boolean     NOT NULL DEFAULT true,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS: authenticated đọc; ghi qua service role (API sau requireRole).
ALTER TABLE engine_network_configs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read engine_network_configs" ON engine_network_configs;
CREATE POLICY "authenticated read engine_network_configs" ON engine_network_configs
  FOR SELECT TO authenticated USING (true);
