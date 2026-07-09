-- Migration: URL trang nguồn cho lệnh dò + lưu lại vào discovery.
-- Cho phép cấu hình nguồn 'confirmed' (thực nhận) từ TRANG PAYOUT khác trang dashboard.
-- Chạy trong Supabase SQL Editor (idempotent).

-- URL để lệnh dò mở (thay dashboard_url mặc định). NULL = dùng dashboard_url.
ALTER TABLE engine_commands ADD COLUMN IF NOT EXISTS discover_url text;

-- URL trang đã dò (chỉ set khi lệnh dò có discover_url) → detect dùng đặt report.url.
ALTER TABLE engine_discoveries ADD COLUMN IF NOT EXISTS source_url text;
