-- Migration: Affiliate Revenue table
-- Chạy trong Supabase SQL Editor

CREATE TABLE IF NOT EXISTS affiliate_revenue (
  project_id      text        NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  date            date        NOT NULL,
  type            text        NOT NULL CHECK (type IN ('confirmed', 'pending')),
  amount          numeric     NOT NULL DEFAULT 0,
  note            text,
  payout_start_date date,
  payout_end_date   date,
  confirmed_at    timestamptz,
  created_at      timestamptz DEFAULT now(),
  CONSTRAINT affiliate_revenue_pkey PRIMARY KEY (project_id, date, type)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_revenue_project ON affiliate_revenue(project_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_revenue_date    ON affiliate_revenue(date);

-- RLS
ALTER TABLE affiliate_revenue ENABLE ROW LEVEL SECURITY;
