import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

const ENGINE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

// Ưu tiên engine/.env; fallback ../.env.local (máy dev đã có sẵn key của app Next.js)
const envCandidates = [path.join(ENGINE_DIR, '.env'), path.join(ENGINE_DIR, '..', '.env.local')]
for (const p of envCandidates) {
  if (fs.existsSync(p)) dotenv.config({ path: p })
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

let client = null

export function getSupabase() {
  if (!client) {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — tạo engine/.env theo engine/.env.example'
      )
    }
    client = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }
  return client
}

const UPSERT_CHUNK = 500

// ---------- engine_networks ----------

// Tự đăng ký network để UI biết network nào sẵn có (kèm tên hiển thị).
export async function upsertNetwork(networkId, networkName) {
  const { error } = await getSupabase()
    .from('engine_networks')
    .upsert({ network_id: networkId, network_name: networkName ?? '', updated_at: new Date().toISOString() },
      { onConflict: 'network_id' })
  if (error) throw new Error(`upsertNetwork: ${error.message}`)
}

// ---------- engine_runs ----------

export async function insertRun(networkId, accountId, dateFrom, dateTo) {
  const { data, error } = await getSupabase()
    .from('engine_runs')
    .insert({ network_id: networkId, account_id: accountId, status: 'running', date_from: dateFrom, date_to: dateTo })
    .select('id')
    .single()
  if (error) throw new Error(`insertRun: ${error.message}`)
  return data.id
}

export async function updateRun(runId, fields) {
  const { error } = await getSupabase()
    .from('engine_runs')
    .update({ ...fields, finished_at: new Date().toISOString() })
    .eq('id', runId)
  if (error) throw new Error(`updateRun: ${error.message}`)
}

// ---------- revenue_raw ----------

// rows: [{ network_id, account_id, account_label, project_id, date, offer_id, offer_name, revenue, currency, revenue_usd, fx_rate, clicks, conversions, status, raw_payload }]
export async function upsertRevenueRaw(rows, runId) {
  const supabase = getSupabase()
  let upserted = 0
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK).map((r) => ({
      ...r,
      run_id: runId,
      fetched_at: new Date().toISOString(),
    }))
    const { error } = await supabase
      .from('revenue_raw')
      .upsert(chunk, { onConflict: 'network_id,account_id,date,offer_id,offer_name' })
    if (error) throw new Error(`upsert revenue_raw (chunk ${i / UPSERT_CHUNK + 1}): ${error.message}`)
    upserted += chunk.length
  }
  return upserted
}

// ---------- affiliate_revenue (P&L) ----------

// pnlRows: [{ project_id, date, amount }] — đã gộp SUM theo (project, ngày), amount = USD
export async function upsertAffiliateRevenue(pnlRows) {
  const supabase = getSupabase()
  const rows = pnlRows.map((r) => ({ ...r, type: 'pending' }))
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const { error } = await supabase
      .from('affiliate_revenue')
      .upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict: 'project_id,date,type' })
    if (error) throw new Error(`upsert affiliate_revenue: ${error.message}`)
  }
  return rows.length
}
