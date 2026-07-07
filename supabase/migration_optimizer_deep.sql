-- =====================================================
-- Migration: Tối Ưu Camp E2 — Top IS, geo target type, QS 3 thành phần
-- Chạy trong Supabase SQL Editor (idempotent). Cột mới đều nullable — không phá cũ.
-- =====================================================

-- Top / Absolute-top Impression Share (0..1) — phát hiện "đua top vô ích".
ALTER TABLE campaign_metrics ADD COLUMN IF NOT EXISTS top_is      numeric;
ALTER TABLE campaign_metrics ADD COLUMN IF NOT EXISTS abs_top_is  numeric;

-- Presence vs Presence-or-interest — rò geo kinh điển.
ALTER TABLE campaign_settings ADD COLUMN IF NOT EXISTS geo_target_type text;

-- Quality Score 3 thành phần (ABOVE_AVERAGE / AVERAGE / BELOW_AVERAGE) — biết VÌ SAO QS thấp.
ALTER TABLE keyword_metrics ADD COLUMN IF NOT EXISTS qs_expected_ctr text;
ALTER TABLE keyword_metrics ADD COLUMN IF NOT EXISTS qs_ad_relevance text;
ALTER TABLE keyword_metrics ADD COLUMN IF NOT EXISTS qs_landing_page text;
