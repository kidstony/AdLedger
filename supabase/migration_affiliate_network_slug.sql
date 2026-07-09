-- Migration: slug cho affiliate_networks (cầu nối sang engine)
-- Chạy trong Supabase SQL Editor (idempotent).
--
-- Dropdown Network ở "Quản lý Doanh thu Engine" lấy từ affiliate_networks. Engine
-- vẫn dùng slug (= tên file engine/configs/<slug>.json, tham số --network=) làm
-- engine_accounts.network_id. Slug tự sinh từ tên khi tạo network (phía API),
-- cố định sau đó. Network chưa có slug → hiện mờ trong dropdown.

ALTER TABLE affiliate_networks ADD COLUMN IF NOT EXISTS slug text;

-- Backfill khớp thực tế: BlancVPN Partner đang chạy với slug 'blancvpn'
-- (KHÔNG slugify máy móc thành 'blancvpn-partner' để không lệch config/engine_accounts).
UPDATE affiliate_networks
   SET slug = 'blancvpn'
 WHERE lower(name) = 'blancvpn partner' AND slug IS NULL;

-- Mỗi slug map 1-1 tới 1 network engine; cho phép nhiều NULL (network chưa cấu hình).
CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliate_networks_slug
  ON affiliate_networks(slug) WHERE slug IS NOT NULL;
