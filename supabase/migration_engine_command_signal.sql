-- Migration: kênh tín hiệu cho lệnh discover (user bấm "Phân tích" để kết thúc dò)
-- Chạy trong Supabase SQL Editor (idempotent).
ALTER TABLE engine_commands ADD COLUMN IF NOT EXISTS signal text;
