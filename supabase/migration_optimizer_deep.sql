-- =====================================================
-- Migration: Tối Ưu Camp E2 — Top IS, geo target type, QS 3 thành phần
-- Chạy trong Supabase SQL Editor (idempotent). Cột mới đều nullable — không phá cũ.
-- =====================================================

-- BLOCK 0: Đảm bảo bảng campaign_settings tồn tại (từ migration_campaign_settings.sql —
-- phòng trường hợp migration đó chưa chạy; đã chạy rồi thì block này no-op).
CREATE TABLE IF NOT EXISTS campaign_settings (
  campaign_id      text        NOT NULL,
  daily_budget     numeric,
  bidding_strategy text,
  target_cpa       numeric,
  target_roas      numeric,
  currency_code    text,
  organization_id  uuid REFERENCES organizations(id) ON DELETE SET NULL,
  updated_at       timestamptz DEFAULT now(),
  CONSTRAINT campaign_settings_pkey PRIMARY KEY (campaign_id)
);

DO $$
BEGIN
  EXECUTE 'ALTER TABLE campaign_settings ENABLE ROW LEVEL SECURITY';
  DROP POLICY IF EXISTS "sa_all_campaign_settings" ON campaign_settings;
  DROP POLICY IF EXISTS "mgr_select_campaign_settings" ON campaign_settings;

  CREATE POLICY "sa_all_campaign_settings" ON campaign_settings FOR ALL
    USING (
      get_user_role() = 'super_admin'
      AND (
        get_user_org_id() IS NULL
        OR campaign_id IN (
          SELECT google_campaign_id FROM projects
          WHERE team_id IN (SELECT id FROM teams WHERE organization_id = get_user_org_id())
            AND google_campaign_id IS NOT NULL
        )
      )
    );

  CREATE POLICY "mgr_select_campaign_settings" ON campaign_settings FOR SELECT
    USING (
      get_user_role() = 'manager'
      AND campaign_id IN (
        SELECT google_campaign_id FROM projects
        WHERE team_id = get_user_team_id() AND google_campaign_id IS NOT NULL
      )
    );
END $$;

-- Top / Absolute-top Impression Share (0..1) — phát hiện "đua top vô ích".
ALTER TABLE campaign_metrics ADD COLUMN IF NOT EXISTS top_is      numeric;
ALTER TABLE campaign_metrics ADD COLUMN IF NOT EXISTS abs_top_is  numeric;

-- Presence vs Presence-or-interest — rò geo kinh điển.
ALTER TABLE campaign_settings ADD COLUMN IF NOT EXISTS geo_target_type text;

-- Quality Score 3 thành phần (ABOVE_AVERAGE / AVERAGE / BELOW_AVERAGE) — biết VÌ SAO QS thấp.
ALTER TABLE keyword_metrics ADD COLUMN IF NOT EXISTS qs_expected_ctr text;
ALTER TABLE keyword_metrics ADD COLUMN IF NOT EXISTS qs_ad_relevance text;
ALTER TABLE keyword_metrics ADD COLUMN IF NOT EXISTS qs_landing_page text;
