-- =====================================================
-- Migration: Optimizer v2 — đề xuất bền vững + phát hiện đột biến + phiếu test
-- Chạy trong Supabase SQL Editor (idempotent — chạy lại an toàn).
--
-- Bối cảnh: cơ chế đề xuất cũ (campaign-optimizer.ts) là stateless — tính lại mỗi
-- request, không nhớ đề xuất đã đưa, không đo kết quả. Optimizer v2 chạy nền
-- (trigger khi dữ liệu về: webhook ads-script / worker ping / nhập DT tay) và
-- persist mọi thứ vào các bảng dưới đây. Ghi bằng service_role (bypass RLS);
-- RLS bật để deny-by-default cho anon key, mirror pattern migration_campaign_optimizer.
-- =====================================================

-- ─────────────────────────────────────────
-- BLOCK 1: optimizer_state — trạng thái engine per-org (claim lock + digest dedup)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS optimizer_state (
  organization_id  uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  dirty_since      timestamptz,              -- trigger đặt khi có dữ liệu mới; engine xóa khi chạy xong
  last_run_at      timestamptz,              -- claim lock: UPDATE ... WHERE last_run_at < now() - interval
  last_run_id      uuid,
  last_digest_date date,                     -- gửi digest Telegram tối đa 1 lần/ngày
  rule_stats       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {rule_key: {won, lost, inconclusive, confounded}}
  confirm_rates    jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {network_id|project_id: {rate, periods, updated}}
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────
-- BLOCK 2: optimizer_runs — lịch sử chạy (debug + UI "phân tích lần cuối lúc…")
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS optimizer_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  triggered_by    text NOT NULL CHECK (triggered_by IN ('webhook','worker','pageload','manual','revenue')),
  status          text NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','error')),
  stats           jsonb,                     -- {projects, suggestions_new, anomalies, evaluated, tests_evaluated}
  message         text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);
CREATE INDEX IF NOT EXISTS idx_optimizer_runs_org_started ON optimizer_runs(organization_id, started_at DESC);

-- ─────────────────────────────────────────
-- BLOCK 3: optimizer_daily_stats — cache thống kê ngày (derived, rebuild được).
--   1 dòng / project × ngày. Lý do tồn tại: baseline anomaly + cửa sổ pre/post của
--   feedback loop phải ỔN ĐỊNH (đúng như engine đã thấy), và tránh re-run
--   attribution/screen-revenue mỗi lần.
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS optimizer_daily_stats (
  project_id      text NOT NULL,
  campaign_id     text NOT NULL,
  date            date NOT NULL,
  spend           numeric NOT NULL DEFAULT 0,  -- đã attribute về project (allocateSpendRow)
  revenue_screen  numeric NOT NULL DEFAULT 0,  -- DT Màn hình theo ngày (đã delta hóa nếu cumulative)
  clicks          bigint  NOT NULL DEFAULT 0,
  impressions     bigint  NOT NULL DEFAULT 0,
  cpc             numeric,
  ctr             numeric,                     -- %
  roi             numeric,                     -- % theo DT màn hình
  roi_effective   numeric,                     -- % theo tiền thực nhận dự kiến (revenue × confirm-rate); NULL nếu chưa đủ kỳ payout
  is_lost_budget  numeric,                     -- 0..1
  is_lost_rank    numeric,                     -- 0..1
  mature          boolean NOT NULL DEFAULT false, -- ngày ≤ ngày cuối đã có DT (tránh "lỗ giả" do pending trễ)
  organization_id uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT optimizer_daily_stats_pkey PRIMARY KEY (project_id, date)
);
CREATE INDEX IF NOT EXISTS idx_opt_daily_campaign ON optimizer_daily_stats(campaign_id, date);

-- ─────────────────────────────────────────
-- BLOCK 4: optimizer_suggestions — đề xuất bền vững + vòng đời
--   proposed → applied → evaluating → won/lost/inconclusive | expired | dismissed
--   outcome.verdict có thể là 'confounded' khi ≥2 đề xuất áp cùng camp chồng cửa sổ đo
--   (hiện UI nhưng không tính vào reliability).
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS optimizer_suggestions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  project_id      text NOT NULL,
  campaign_id     text NOT NULL,
  rule_key        text NOT NULL,               -- 'cut_no_revenue','bid_ceiling','geo_exclude',...
  dedupe_key      text NOT NULL,               -- rule_key + scope (vd 'geo_exclude:2840')
  state           text NOT NULL DEFAULT 'proposed'
    CHECK (state IN ('proposed','applied','evaluating','won','lost','inconclusive','expired','dismissed')),
  severity        text NOT NULL DEFAULT 'medium' CHECK (severity IN ('high','medium','low')),
  confidence      text NOT NULL DEFAULT 'engagement' CHECK (confidence IN ('roi','engagement')),
  suggestion_type text NOT NULL DEFAULT '',    -- OptSuggestionType cũ để SuggestionCard render icon
  title           text NOT NULL,
  detail          text NOT NULL DEFAULT '',
  action          text NOT NULL DEFAULT '',
  evidence        jsonb NOT NULL DEFAULT '[]'::jsonb,  -- OptEvidence[] + items
  params          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- máy đọc: giá trị trigger + spec đánh giá
  impact_estimate numeric NOT NULL DEFAULT 0,
  score           numeric NOT NULL DEFAULT 0,          -- impact × confWeight × reliability
  issued_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),  -- rule còn cháy ở run gần nhất → refresh
  applied_at      timestamptz,
  applied_note    text,
  applied_by      uuid,
  evaluate_after  date,                                -- applied_at + windowDays (theo rule)
  evaluated_at    timestamptz,
  outcome         jsonb,        -- {metric, pre, post, delta_pct, verdict, note}
  dismissed_note  text
);
-- Dedup: mỗi (campaign, dedupe_key) chỉ 1 suggestion đang mở
CREATE UNIQUE INDEX IF NOT EXISTS uq_optimizer_suggestions_open
  ON optimizer_suggestions(campaign_id, dedupe_key)
  WHERE state IN ('proposed','applied','evaluating');
CREATE INDEX IF NOT EXISTS idx_optimizer_suggestions_project_state
  ON optimizer_suggestions(project_id, state);

-- ─────────────────────────────────────────
-- BLOCK 5: anomaly_events — sự kiện đột biến (spike z-score, trend Theil–Sen,
--   sự cố network). metric để text tự do (cpc, ctr, spend, revenue, roi,
--   is_lost_budget, geo_revenue, offer_revenue, cpc_trend, revenue_trend,
--   roi_trend, network_outage, confirm_rate...) — engine là nguồn duy nhất ghi.
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS anomaly_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid,
  project_id       text NOT NULL,
  campaign_id      text,
  metric           text NOT NULL,
  dimension        jsonb,                     -- {"geo":"US"} | {"offer":"..."} | {"account":"..."} | null
  dedupe_key       text NOT NULL,             -- metric + hash dimension
  direction        text NOT NULL CHECK (direction IN ('up','down')),
  severity         text NOT NULL CHECK (severity IN ('warn','high')),
  value            numeric,
  baseline         numeric,
  spread           numeric,
  zscore           numeric,
  "window"         jsonb,                     -- {date, baseline_days, dow_aware, slope?} — WINDOW là từ khóa PG nên phải bọc nháy kép
  state            text NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved','muted')),
  cooldown_until   timestamptz,
  telegram_sent_at timestamptz,
  suggestion_id    uuid REFERENCES optimizer_suggestions(id) ON DELETE SET NULL,
  test_ticket_id   uuid,
  detected_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_anomaly_open ON anomaly_events(project_id, state, dedupe_key);

-- ─────────────────────────────────────────
-- BLOCK 6: test_tickets — phiếu test camp khi có đột biến cơ hội / giả thuyết win-day
--   proposed → accepted → awaiting_camp → running → won/lost/stopped | abandoned | expired
--   ticket_code đặt vào tên camp mới trên Google Ads để engine auto-link qua
--   campaign_discoveries.
-- ─────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS test_ticket_seq;

CREATE TABLE IF NOT EXISTS test_tickets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_code      text NOT NULL UNIQUE
                     DEFAULT ('T-' || lpad(nextval('test_ticket_seq')::text, 4, '0')),
  organization_id  uuid,
  project_id       text NOT NULL,             -- project nguồn (control tham khảo)
  source           text NOT NULL CHECK (source IN ('anomaly','insight','suggestion','manual')),
  source_id        uuid,                      -- anomaly_events.id / optimizer_suggestions.id
  state            text NOT NULL DEFAULT 'proposed'
    CHECK (state IN ('proposed','accepted','awaiting_camp','running','won','lost','stopped','abandoned','expired')),
  hypothesis       text NOT NULL,
  target           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {geo, device, hours[], offer, keywords[], notes}
  test_budget      numeric NOT NULL DEFAULT 30,
  max_days         int NOT NULL DEFAULT 10,
  min_clicks       int NOT NULL DEFAULT 50,
  success_criteria jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {metric:'roi', threshold:20, min_revenue:10}
  stoploss         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {max_spend_no_revenue}
  control          jsonb,                     -- snapshot baseline camp nguồn lúc tạo phiếu
  test_campaign_id text,                      -- gắn khi user tạo camp (manual hoặc auto-detect)
  test_project_id  text,                      -- nếu user tạo project riêng cho camp test (khuyến nghị)
  started_at       date,                      -- ngày đầu tiên camp test có spend
  daily_log        jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{date,spend,revenue,clicks,roi,note}]
  concluded_at     timestamptz,
  conclusion       jsonb,                     -- {verdict, spend, revenue, roi, vs_control, learnings}
  follow_up_suggestion_id uuid REFERENCES optimizer_suggestions(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_test_tickets_project_state ON test_tickets(project_id, state);

-- FK ngược từ anomaly_events → test_tickets (tạo sau vì test_tickets khai báo sau)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'anomaly_events_test_ticket_fk'
  ) THEN
    ALTER TABLE anomaly_events
      ADD CONSTRAINT anomaly_events_test_ticket_fk
      FOREIGN KEY (test_ticket_id) REFERENCES test_tickets(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─────────────────────────────────────────
-- BLOCK 7: optimizer_settings — ngưỡng cấu hình (per-org, override per-project)
--   thresholds CHỈ chứa override so với DEFAULT_THRESHOLDS trong code
--   (src/lib/optimizer/defaults.ts) — xóa key = trở về mặc định.
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS optimizer_settings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      text,                       -- NULL = mặc định toàn org
  thresholds      jsonb NOT NULL DEFAULT '{}'::jsonb,
  auto_tune       boolean NOT NULL DEFAULT false,  -- cho phép engine tự siết/nới ngưỡng theo outcome
  updated_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_optimizer_settings
  ON optimizer_settings(organization_id, COALESCE(project_id, ''));

-- ─────────────────────────────────────────
-- BLOCK 8: RLS
--   Bảng key theo project_id → sa_all org-scoped + mgr_select theo team
--   (mirror migration_campaign_optimizer BLOCK 5, đổi campaign_id → project_id).
--   Bảng key theo organization_id → sa_all org-scoped + mgr_select theo org của team.
--   Mọi ghi đều qua service_role (bypass) — RLS chỉ để chặn anon key.
-- ─────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  -- Nhóm key theo project_id
  FOREACH t IN ARRAY ARRAY['optimizer_daily_stats','optimizer_suggestions','anomaly_events','test_tickets']
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
          OR project_id IN (
            SELECT project_id FROM projects
            WHERE team_id IN (SELECT id FROM teams WHERE organization_id = get_user_org_id())
          )
        )
      )$f$, t);

    EXECUTE format($f$
      CREATE POLICY "mgr_select_%1$s" ON %1$s FOR SELECT
      USING (
        get_user_role() = 'manager'
        AND project_id IN (
          SELECT project_id FROM projects WHERE team_id = get_user_team_id()
        )
      )$f$, t);
  END LOOP;

  -- Nhóm key theo organization_id
  FOREACH t IN ARRAY ARRAY['optimizer_state','optimizer_runs','optimizer_settings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "sa_all_%1$s" ON %1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS "mgr_select_%1$s" ON %1$s', t);

    EXECUTE format($f$
      CREATE POLICY "sa_all_%1$s" ON %1$s FOR ALL
      USING (
        get_user_role() = 'super_admin'
        AND (get_user_org_id() IS NULL OR organization_id = get_user_org_id())
      )$f$, t);

    EXECUTE format($f$
      CREATE POLICY "mgr_select_%1$s" ON %1$s FOR SELECT
      USING (
        get_user_role() = 'manager'
        AND organization_id IN (
          SELECT organization_id FROM teams WHERE id = get_user_team_id()
        )
      )$f$, t);
  END LOOP;
END $$;
