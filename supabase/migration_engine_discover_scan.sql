-- Migration: cờ "tự quét trang báo cáo" (auto-scan) cho lệnh dò.
-- Bật cờ này → sau khi đăng nhập xong, worker tự quét các link menu cùng origin
-- (Conversions/Reports/Statistics/Earnings...) để tìm trang chứa dữ liệu doanh thu/
-- breakdown — user không cần tự điều hướng. Chạy trong Supabase SQL Editor (idempotent).
ALTER TABLE engine_commands ADD COLUMN IF NOT EXISTS discover_scan boolean NOT NULL DEFAULT false;
