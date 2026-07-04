-- Migration: cờ "chốt kỳ" (cycle_end) cho tiền màn hình luỹ kế
-- Chạy trong Supabase SQL Editor
--
-- Đánh dấu ngày cuối của một kỳ thanh toán trên dòng pending (Tiền màn hình).
-- Khi ngày baseline có cycle_end = true, delta luỹ kế của ngày kế reset về 0
-- (platform reset bộ đếm sau khi thanh toán). KHÔNG tạo doanh thu thực.

ALTER TABLE affiliate_revenue
  ADD COLUMN IF NOT EXISTS cycle_end boolean NOT NULL DEFAULT false;
