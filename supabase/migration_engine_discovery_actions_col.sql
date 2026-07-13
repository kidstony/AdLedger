-- Migration: lưu ACTION đã dùng lúc dò vào bản discovery.
-- Cùng 1 trang có thể là 2 nguồn (vd Localrent: bảng Commission = 'pending', tab
-- "Payment history" = 'confirmed'). Trước đây 2 bản dò trùng source_url → detect lấy nhầm
-- bản mới nhất. Lưu actions để detect tách bản dò 'confirmed' (có click) khỏi 'pending' (không click).
-- Chạy trong Supabase SQL Editor (idempotent).
ALTER TABLE engine_discoveries ADD COLUMN IF NOT EXISTS actions jsonb;
