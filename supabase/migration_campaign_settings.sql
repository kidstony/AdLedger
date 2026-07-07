-- =====================================================
-- Migration: campaign_settings — ngân sách + chiến lược giá thầu (Tối Ưu Camp D3)
-- Chạy trong Supabase SQL Editor (idempotent). Ingest qua webhook (service_role).
-- =====================================================

CREATE TABLE IF NOT EXISTS campaign_settings (
  campaign_id      text        NOT NULL,
  daily_budget     numeric,                 -- ngân sách/ngày (đơn vị tiền tài khoản)
  bidding_strategy text,                    -- MANUAL_CPC / MAXIMIZE_CONVERSIONS / TARGET_CPA ...
  target_cpa       numeric,                 -- để sẵn cho sau (chưa ingest)
  target_roas      numeric,                 -- để sẵn cho sau
  currency_code    text,                    -- USD / VND ... (từ account)
  organization_id  uuid REFERENCES organizations(id) ON DELETE SET NULL,
  updated_at       timestamptz DEFAULT now(),
  CONSTRAINT campaign_settings_pkey PRIMARY KEY (campaign_id)
);

-- RLS mirror ad_spend (key theo campaign_id): SA org-scoped + manager SELECT theo team.
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
