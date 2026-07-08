-- Migration: chiều "tài khoản" (account) cho Revenue Fetch Engine
-- Chạy trong Supabase SQL Editor (idempotent).
--
-- Một nền tảng (network_id) có thể có nhiều tài khoản/ref, mỗi tài khoản gán
-- về một dự án (project_id) do người dùng chọn. revenue_raw lưu thêm:
--   account_id    — slug tài khoản (mặc định = network_id nếu config không khai accounts)
--   account_label — nhãn hiển thị của tài khoản
--   project_id    — dự án đã gán cho tài khoản (engine ghi khi fetch)
-- engine_runs thêm account_id để theo dõi từng tài khoản riêng.

-- 1. Thêm cột
ALTER TABLE revenue_raw
  ADD COLUMN IF NOT EXISTS account_id    text,
  ADD COLUMN IF NOT EXISTS account_label text,
  ADD COLUMN IF NOT EXISTS project_id    text;

ALTER TABLE engine_runs
  ADD COLUMN IF NOT EXISTS account_id text;

-- 2. Backfill dữ liệu cũ: tài khoản ngầm = chính network_id (khớp hành vi cũ).
--    project_id để trống — chạy lại engine sẽ điền đúng dự án đã gán.
UPDATE revenue_raw SET account_id    = network_id WHERE account_id    IS NULL;
UPDATE revenue_raw SET account_label = network_id WHERE account_label IS NULL;
UPDATE engine_runs SET account_id    = network_id WHERE account_id    IS NULL;

-- 3. Đổi khóa unique để cùng offer ở 2 tài khoản không đè nhau
ALTER TABLE revenue_raw DROP CONSTRAINT IF EXISTS revenue_raw_ukey;
ALTER TABLE revenue_raw ADD CONSTRAINT revenue_raw_ukey
  UNIQUE (network_id, account_id, date, offer_id, offer_name);

-- 4. Index phục vụ gom theo dự án
CREATE INDEX IF NOT EXISTS idx_revenue_raw_project_account_date
  ON revenue_raw(project_id, account_id, date);
