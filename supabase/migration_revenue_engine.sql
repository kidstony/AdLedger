-- Migration: Revenue Fetch Engine (engine_runs, revenue_raw, engine_alerts)
-- Chạy trong Supabase SQL Editor (idempotent)
--
-- Engine chạy local ghi bằng SERVICE ROLE (bypass RLS).
-- Dashboard đọc bằng authenticated → chỉ có policy SELECT.
-- network_id là text slug từ file config engine (không FK sang affiliate_networks).

-- ============================================================
-- 1. engine_runs — mỗi lần engine chạy 1 network = 1 dòng
-- ============================================================
CREATE TABLE IF NOT EXISTS engine_runs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id        text        NOT NULL,
  status            text        NOT NULL DEFAULT 'running'
                                CHECK (status IN ('running', 'success', 'failed')),
  date_from         date,
  date_to           date,
  records_captured  integer     NOT NULL DEFAULT 0,  -- số response JSON hứng được
  records_mapped    integer     NOT NULL DEFAULT 0,  -- số dòng sau mapping/dedupe
  records_upserted  integer     NOT NULL DEFAULT 0,  -- số dòng ghi vào revenue_raw
  error_type        text        CHECK (error_type IN ('NO_CAPTURE', 'MAPPING_FAILED', 'DB_ERROR')),
  error_message     text,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_engine_runs_network_started
  ON engine_runs(network_id, started_at DESC);

-- ============================================================
-- 2. revenue_raw — staging, giữ nguyên grain offer/ngày + payload gốc
-- ============================================================
CREATE TABLE IF NOT EXISTS revenue_raw (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  network_id    text        NOT NULL,
  date          date        NOT NULL,
  offer_id      text        NOT NULL DEFAULT '',
  offer_name    text        NOT NULL DEFAULT '',
  revenue       numeric     NOT NULL DEFAULT 0,
  currency      text        NOT NULL DEFAULT 'USD',
  clicks        bigint,
  conversions   numeric,
  status        text,
  raw_payload   jsonb,      -- object dòng gốc từ network (không phải cả response)
  run_id        uuid        REFERENCES engine_runs(id) ON DELETE SET NULL,
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT revenue_raw_ukey UNIQUE (network_id, date, offer_id, offer_name)
);

CREATE INDEX IF NOT EXISTS idx_revenue_raw_network_date ON revenue_raw(network_id, date);

-- ============================================================
-- 3. engine_alerts — lỗi đang mở, tự đóng khi network chạy lại thành công
-- ============================================================
CREATE TABLE IF NOT EXISTS engine_alerts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id    text        NOT NULL,
  error_type    text        NOT NULL CHECK (error_type IN ('NO_CAPTURE', 'MAPPING_FAILED', 'DB_ERROR')),
  status        text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  message       text,
  occurrences   integer     NOT NULL DEFAULT 1,
  first_seen    timestamptz NOT NULL DEFAULT now(),
  last_seen     timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  last_run_id   uuid        REFERENCES engine_runs(id) ON DELETE SET NULL
);

-- Đúng 1 alert đang mở cho mỗi cặp (network, loại lỗi)
CREATE UNIQUE INDEX IF NOT EXISTS uq_engine_alerts_open
  ON engine_alerts(network_id, error_type) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_engine_alerts_status ON engine_alerts(status, last_seen DESC);

-- ============================================================
-- RLS: authenticated chỉ đọc; không policy ghi (service role bypass)
-- ============================================================
ALTER TABLE engine_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_raw   ENABLE ROW LEVEL SECURITY;
ALTER TABLE engine_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read engine_runs" ON engine_runs;
CREATE POLICY "authenticated read engine_runs" ON engine_runs
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated read revenue_raw" ON revenue_raw;
CREATE POLICY "authenticated read revenue_raw" ON revenue_raw
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated read engine_alerts" ON engine_alerts;
CREATE POLICY "authenticated read engine_alerts" ON engine_alerts
  FOR SELECT TO authenticated USING (true);
