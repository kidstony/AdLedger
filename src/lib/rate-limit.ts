import { supabaseAdmin } from './supabase-admin'

// Distributed rate limiter backed by Supabase — works across Vercel serverless instances.
// Requires migration_rate_limits.sql to be applied in Supabase.
export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const windowStart = new Date(Date.now() - windowMs).toISOString()

  // Record this request
  await supabaseAdmin.from('rate_limits').insert({ key })

  // Count requests in the current window
  const { count } = await supabaseAdmin
    .from('rate_limits')
    .select('*', { count: 'exact', head: true })
    .eq('key', key)
    .gte('requested_at', windowStart)

  // Best-effort cleanup of old entries (fire and forget)
  supabaseAdmin
    .from('rate_limits')
    .delete()
    .eq('key', key)
    .lt('requested_at', windowStart)
    .then(() => {})

  return (count ?? 0) <= limit
}
