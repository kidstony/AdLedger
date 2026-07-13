-- Migration: tách pipeline DOANH THU (P&L) vs DỮ LIỆU TỐI ƯU CAMP (breakdown).
-- Chạy trong Supabase SQL Editor (idempotent). CHẠY TRƯỚC khi deploy app + restart worker.
--
-- 2 pipeline dùng chung engine + Chrome profile (đăng nhập 1 lần) nhưng quản lý riêng:
-- lệnh riêng (fetch vs fetch_breakdown), run riêng (engine_runs.kind), alert riêng
-- (tag '<account>:breakdown'), bật/tắt riêng (engine_network_configs.breakdown_enabled).

-- 1) engine_commands.type += 'fetch_breakdown'
--    Constraint tạo inline lần đầu → Postgres tự đặt tên engine_commands_type_check.
ALTER TABLE engine_commands DROP CONSTRAINT IF EXISTS engine_commands_type_check;
ALTER TABLE engine_commands
  ADD CONSTRAINT engine_commands_type_check
  CHECK (type IN ('login', 'fetch', 'discover', 'fetch_breakdown'));

-- 2) engine_runs.kind — run cũ mặc định 'revenue'
ALTER TABLE engine_runs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'revenue';
ALTER TABLE engine_runs DROP CONSTRAINT IF EXISTS engine_runs_kind_check;
ALTER TABLE engine_runs
  ADD CONSTRAINT engine_runs_kind_check CHECK (kind IN ('revenue', 'breakdown'));

-- Tra "lần chạy breakdown gần nhất mỗi network/account" cho tab Dữ liệu tối ưu Network
CREATE INDEX IF NOT EXISTS idx_engine_runs_network_kind_started
  ON engine_runs(network_id, kind, started_at DESC);

-- 3) Bật/tắt pipeline breakdown per network — cột riêng, KHÔNG đụng config JSONB
ALTER TABLE engine_network_configs
  ADD COLUMN IF NOT EXISTS breakdown_enabled boolean NOT NULL DEFAULT true;
