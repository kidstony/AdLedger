-- Migration: heartbeat của worker để UI biết worker sống/chết ngay lập tức
-- (trước đây phải bấm lệnh rồi chờ pending >60s mới đoán được "worker chưa chạy").
-- Worker update cột này mỗi ~30s khi đang chạy; UI coi online nếu tuổi < 90s.
-- Chạy trong Supabase SQL Editor (idempotent).
ALTER TABLE engine_settings ADD COLUMN IF NOT EXISTS worker_last_seen_at timestamptz;
