-- Lô 2: phân biệt doanh thu "pending" (tiền màn hình/dashboard) vs "confirmed" (tiền thực nhận/payout)
-- trong bảng staging revenue_raw, để trang Quản lý Doanh thu Engine KHÔNG cộng gộp hai loại vào một
-- TỔNG (trước đây report payout dùng offer_name riêng nên cả pending lẫn confirmed đều nằm trong
-- revenue_raw → API cộng cả hai → đội số ở các ngày có payout).
--
-- Chạy 1 lần trên Supabase (SQL editor). Áp dụng TRƯỚC khi deploy engine/UI mới của Lô 2.

ALTER TABLE revenue_raw
  ADD COLUMN IF NOT EXISTS revenue_type text NOT NULL DEFAULT 'pending';

-- Backfill dữ liệu cũ theo quy ước: report confirmed (payout) dùng offer_name='payout'
-- (xem network-config/detect). Dòng khác giữ mặc định 'pending'. Lần sync tới engine ghi
-- revenue_type chuẩn từ report.revenue_type nên đây chỉ là gán tạm cho dữ liệu đã có.
UPDATE revenue_raw
  SET revenue_type = 'confirmed'
  WHERE offer_name = 'payout' AND revenue_type <> 'confirmed';
