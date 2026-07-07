-- Migration: ngân sách test cho camp mới (Lộ trình test camp / stop-loss).
-- Chạy trong Supabase SQL Editor (idempotent). Nullable — không phá dữ liệu cũ.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS test_budget numeric;
