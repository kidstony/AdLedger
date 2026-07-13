-- Migration: revenue_breakdown — doanh thu affiliate theo chiều (quốc gia/thiết bị/giờ/sub-id)
-- Chạy trong Supabase SQL Editor (idempotent)
--
-- Engine thu từ report kind='breakdown' trong config network. Grain = TỔNG HỢP theo
-- (date × dimensions), KHÔNG per-conversion → re-fetch cửa sổ trùng chỉ đè cùng cell,
-- không sinh duplicate kể cả network trả từng chuyển đổi không có ID ổn định.
-- Bảng này KHÔNG bao giờ ghi vào affiliate_revenue (P&L) — chỉ để join với chi phí
-- Google Ads theo segment trong mục Tối Ưu Camp (tránh double-count doanh thu).
--
-- Sentinel khi network không có dimension: country/device/sub_id = '' , hour = -1
-- (không dùng NULL vì NULL phá UNIQUE constraint của Postgres).

CREATE TABLE IF NOT EXISTS revenue_breakdown (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  network_id    text        NOT NULL,
  account_id    text        NOT NULL DEFAULT '',
  project_id    text,                            -- resolve qua project_mapping rules → account.project_id
  campaign_id   text,                            -- extract từ sub_id (khi user truyền {campaignid}); NULL nếu chưa
  report        text        NOT NULL DEFAULT '', -- report.name (1 network có thể có nhiều report breakdown)
  date          date        NOT NULL,
  country       text        NOT NULL DEFAULT '', -- ISO-3166 alpha-2 UPPER ('' = network không có/không parse được)
  device        text        NOT NULL DEFAULT '', -- 'mobile'|'desktop'|'tablet'|'other'|''
  hour          smallint    NOT NULL DEFAULT -1  -- 0..23 theo múi giờ dữ liệu nguồn; -1 = không có
                            CHECK (hour BETWEEN -1 AND 23),
  sub_id        text        NOT NULL DEFAULT '',
  offer_id      text        NOT NULL DEFAULT '',
  offer_name    text        NOT NULL DEFAULT '',
  revenue       numeric     NOT NULL DEFAULT 0,  -- tiền tệ nguồn
  currency      text        NOT NULL DEFAULT 'USD',
  revenue_usd   numeric,                         -- đóng băng lúc ghi; fail tỷ giá → NULL (như revenue_raw)
  fx_rate       numeric,
  conversions   numeric,
  clicks        bigint,
  revenue_type  text        NOT NULL DEFAULT 'pending' CHECK (revenue_type IN ('pending', 'confirmed')),
  raw_payload   jsonb,                           -- 1 dòng mẫu (dòng cuối của nhóm) để debug mapping
  run_id        uuid        REFERENCES engine_runs(id) ON DELETE SET NULL,
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT revenue_breakdown_ukey UNIQUE
    (network_id, account_id, report, date, country, device, hour, sub_id, offer_id, offer_name)
);

CREATE INDEX IF NOT EXISTS idx_revenue_breakdown_project_date ON revenue_breakdown(project_id, date);
CREATE INDEX IF NOT EXISTS idx_revenue_breakdown_campaign_date
  ON revenue_breakdown(campaign_id, date) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_revenue_breakdown_network_date ON revenue_breakdown(network_id, date);

-- Đếm riêng số dòng breakdown mỗi run (records_* giữ nguyên nghĩa cho report revenue)
ALTER TABLE engine_runs ADD COLUMN IF NOT EXISTS breakdown_upserted integer NOT NULL DEFAULT 0;

-- RLS: authenticated chỉ đọc; engine ghi bằng service role (bypass)
ALTER TABLE revenue_breakdown ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read revenue_breakdown" ON revenue_breakdown;
CREATE POLICY "authenticated read revenue_breakdown" ON revenue_breakdown
  FOR SELECT TO authenticated USING (true);
