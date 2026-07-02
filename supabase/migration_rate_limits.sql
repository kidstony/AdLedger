-- Rate limits table for distributed rate limiting across Vercel serverless instances
CREATE TABLE IF NOT EXISTS rate_limits (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rate_limits_key_ts ON rate_limits (key, requested_at);

-- RLS: no user access; all operations go through service_role (supabaseAdmin)
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
