-- Migration: thêm cột quy đổi USD vào revenue_raw
-- Chạy trong Supabase SQL Editor (idempotent).
--
-- revenue_raw giữ doanh thu GỐC (revenue + currency). Hai cột dưới lưu bản
-- quy đổi USD "đóng băng" tại thời điểm fetch — đúng tỷ giá engine đã dùng để
-- sync sang affiliate_revenue (P&L), nên số USD ở đây khớp với dashboard P&L.
--
--   revenue_usd = revenue * fx_rate  (làm tròn 2 số lẻ)
--   fx_rate     = tỷ giá <currency>→USD tại lúc chạy (USD→1)
--
-- NULL = lần fetch đó không lấy được tỷ giá (nguồn FX chết); chạy lại để điền.

ALTER TABLE revenue_raw
  ADD COLUMN IF NOT EXISTS revenue_usd numeric,
  ADD COLUMN IF NOT EXISTS fx_rate     numeric;
