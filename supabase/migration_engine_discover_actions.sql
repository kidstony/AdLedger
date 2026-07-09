-- Migration: thao tác (click…) cho lệnh dò — mở nguồn cần tương tác mới hiện dữ liệu
-- (vd Localrent phải click "Payment history"). Chạy trong Supabase SQL Editor (idempotent).
ALTER TABLE engine_commands ADD COLUMN IF NOT EXISTS discover_actions jsonb;
