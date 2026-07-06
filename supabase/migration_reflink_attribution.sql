-- Migration: Tách chi phí QC theo từng link ref (nhiều ref / 1 CID)
-- Chạy trong Supabase SQL Editor.
--
-- Ý tưởng: mỗi link ref là một "project con" dùng chung cid (và có thể chung
-- google_campaign_id). Chi phí QC được lưu ở granularity mịn hơn
-- (device + ad_group_id) để resolver có thể gán đúng lát cắt cho từng ref.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) ad_spend: thêm chiều device + ad_group_id, đổi khoá duy nhất
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ad_spend
  ADD COLUMN IF NOT EXISTS device      text NOT NULL DEFAULT 'ALL',
  ADD COLUMN IF NOT EXISTS ad_group_id text NOT NULL DEFAULT 'ALL';

-- Khoá cũ (campaign_id, date) không còn đủ; chuyển sang
-- (campaign_id, date, device, ad_group_id). Xử lý cả trường hợp khoá là PK
-- hoặc unique constraint. Row cũ mang device/ad_group_id = 'ALL'.
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'ad_spend'::regclass
      AND c.contype IN ('p', 'u')
  LOOP
    EXECUTE format('ALTER TABLE ad_spend DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

ALTER TABLE ad_spend
  ADD CONSTRAINT ad_spend_campaign_date_device_adgroup_key
  UNIQUE (campaign_id, date, device, ad_group_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) projects: quy tắc quy chi phí (attribution rule) cho mỗi ref-link project
-- ─────────────────────────────────────────────────────────────────────────────
--   attribution_type:
--     'campaign'    → nhận toàn bộ chi phí campaign (mặc định, giữ nguyên hành vi cũ)
--     'device'      → chỉ nhận spend của device tương ứng (MOBILE/DESKTOP/TABLET)
--     'ad_group'    → chỉ nhận spend của ad_group_id tương ứng
--     'date_window' → chỉ nhận spend trong khoảng [attribution_from, attribution_to]
--     'manual_pct'  → chia theo trọng số % thủ công giữa các sibling
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS attribution_type        text    NOT NULL DEFAULT 'campaign',
  ADD COLUMN IF NOT EXISTS attribution_device      text,
  ADD COLUMN IF NOT EXISTS attribution_ad_group_id text,
  ADD COLUMN IF NOT EXISTS attribution_from        date,
  ADD COLUMN IF NOT EXISTS attribution_to          date,
  ADD COLUMN IF NOT EXISTS attribution_weight      numeric;

-- Truy vấn spend theo campaign nhanh hơn khi nhiều project chung 1 campaign.
CREATE INDEX IF NOT EXISTS idx_projects_google_campaign_id
  ON projects (google_campaign_id);
