-- Migration: URL dashboard theo từng engine_account (cho network kiểu Tolt)
-- Chạy trong Supabase SQL Editor (idempotent).
--
-- Tolt là 1 nền tảng, nhiều brand có URL riêng (partner.blancvpn.com, x.tolt.io…)
-- nhưng cấu trúc trang giống nhau → 1 config engine (configs/tolt.json) dùng biến
-- {base} = dashboard_url của account. dashboard_url KHÔNG unique: nhiều account
-- (khác login/profile/project) có thể chung 1 URL. login_url tùy chọn nếu trang
-- đăng nhập khác trang báo cáo.

ALTER TABLE engine_accounts
  ADD COLUMN IF NOT EXISTS dashboard_url text,
  ADD COLUMN IF NOT EXISTS login_url     text;
