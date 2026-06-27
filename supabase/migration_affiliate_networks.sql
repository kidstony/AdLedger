-- Migration: Affiliate Networks
-- Chạy trong Supabase SQL Editor

CREATE TABLE IF NOT EXISTS affiliate_networks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  color           text NOT NULL DEFAULT '#6b7280',
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_networks_org ON affiliate_networks(organization_id);
