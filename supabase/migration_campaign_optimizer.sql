-- =====================================================
-- Migration: Campaign Optimizer — số liệu hiệu suất Google Ads
-- Chạy trong Supabase SQL Editor (idempotent — chạy lại an toàn).
--
-- KHÔNG đụng bảng ad_spend (nguồn P&L). Đây là các bảng metric MỚI, tách riêng,
-- phục vụ tính năng "Tối Ưu Camp". Ingest qua webhook /api/sync/ads-script
-- (service_role, bỏ qua RLS). Đọc qua /api/optimize (service_role + kiểm quyền
-- trong code). RLS bật để deny-by-default cho anon key + mirror policy ad_spend.
-- =====================================================

-- ─────────────────────────────────────────
-- BLOCK 1: Bảng campaign_metrics (campaign × ngày)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_metrics (
  campaign_id             text        NOT NULL,
  date                    date        NOT NULL,
  impressions             bigint      NOT NULL DEFAULT 0,
  clicks                  bigint      NOT NULL DEFAULT 0,
  cost                    numeric     NOT NULL DEFAULT 0,
  conversions             numeric,                    -- NULL nếu không có conversion tracking
  conversions_value       numeric,
  search_impression_share numeric,                    -- 0..1
  search_budget_lost_is   numeric,                    -- 0..1
  search_rank_lost_is     numeric,                    -- 0..1
  organization_id         uuid REFERENCES organizations(id) ON DELETE SET NULL,
  updated_at              timestamptz DEFAULT now(),
  CONSTRAINT campaign_metrics_pkey PRIMARY KEY (campaign_id, date)
);
CREATE INDEX IF NOT EXISTS idx_campaign_metrics_date ON campaign_metrics(date);

-- ─────────────────────────────────────────
-- BLOCK 2: Bảng keyword_metrics (keyword × ngày) — dùng ở P2
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS keyword_metrics (
  campaign_id     text        NOT NULL,
  ad_group_id     text        NOT NULL,
  criterion_id    text        NOT NULL,
  date            date        NOT NULL,
  keyword_text    text        NOT NULL DEFAULT '',
  match_type      text        NOT NULL DEFAULT '',
  impressions     bigint      NOT NULL DEFAULT 0,
  clicks          bigint      NOT NULL DEFAULT 0,
  cost            numeric     NOT NULL DEFAULT 0,
  conversions     numeric,
  quality_score   int,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  updated_at      timestamptz DEFAULT now(),
  CONSTRAINT keyword_metrics_pkey PRIMARY KEY (campaign_id, ad_group_id, criterion_id, date)
);
CREATE INDEX IF NOT EXISTS idx_keyword_metrics_campaign_date ON keyword_metrics(campaign_id, date);

-- ─────────────────────────────────────────
-- BLOCK 3: Bảng search_term_metrics (search term × ngày) — dùng ở P2
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_term_metrics (
  campaign_id     text        NOT NULL,
  ad_group_id     text        NOT NULL,
  search_term     text        NOT NULL,
  date            date        NOT NULL,
  impressions     bigint      NOT NULL DEFAULT 0,
  clicks          bigint      NOT NULL DEFAULT 0,
  cost            numeric     NOT NULL DEFAULT 0,
  conversions     numeric,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  updated_at      timestamptz DEFAULT now(),
  CONSTRAINT search_term_metrics_pkey PRIMARY KEY (campaign_id, ad_group_id, search_term, date)
);
CREATE INDEX IF NOT EXISTS idx_search_term_metrics_campaign_date ON search_term_metrics(campaign_id, date);

-- ─────────────────────────────────────────
-- BLOCK 4: Bảng segment_metrics (device/hour/geo × ngày) — dùng ở P3
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS segment_metrics (
  campaign_id     text        NOT NULL,
  date            date        NOT NULL,
  segment_type    text        NOT NULL CHECK (segment_type IN ('device', 'hour', 'geo')),
  segment_value   text        NOT NULL,
  impressions     bigint      NOT NULL DEFAULT 0,
  clicks          bigint      NOT NULL DEFAULT 0,
  cost            numeric     NOT NULL DEFAULT 0,
  conversions     numeric,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  updated_at      timestamptz DEFAULT now(),
  CONSTRAINT segment_metrics_pkey PRIMARY KEY (campaign_id, date, segment_type, segment_value)
);
CREATE INDEX IF NOT EXISTS idx_segment_metrics_campaign_date ON segment_metrics(campaign_id, date);

-- ─────────────────────────────────────────
-- BLOCK 5: RLS — mirror ad_spend (key theo campaign_id).
--   SA org-scoped (giống migration_organizations BLOCK 13), manager SELECT theo
--   team, member không có policy (không thấy). Webhook & API dùng service_role
--   nên bỏ qua RLS; RLS ở đây để deny-by-default cho anon key.
-- ─────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['campaign_metrics','keyword_metrics','search_term_metrics','segment_metrics']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "sa_all_%1$s" ON %1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS "mgr_select_%1$s" ON %1$s', t);

    EXECUTE format($f$
      CREATE POLICY "sa_all_%1$s" ON %1$s FOR ALL
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
      )$f$, t);

    EXECUTE format($f$
      CREATE POLICY "mgr_select_%1$s" ON %1$s FOR SELECT
      USING (
        get_user_role() = 'manager'
        AND campaign_id IN (
          SELECT google_campaign_id FROM projects
          WHERE team_id = get_user_team_id() AND google_campaign_id IS NOT NULL
        )
      )$f$, t);
  END LOOP;
END $$;
