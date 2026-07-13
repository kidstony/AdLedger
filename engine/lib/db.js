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

// kind: 'revenue' (P&L) | 'breakdown' (dữ liệu tối ưu camp) — 2 pipeline chạy run riêng.
export async function insertRun(networkId, accountId, dateFrom, dateTo, kind = 'revenue') {
  const { data, error } = await getSupabase()
    .from('engine_runs')
    .insert({ network_id: networkId, account_id: accountId, status: 'running', date_from: dateFrom, date_to: dateTo, kind })
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

// Account đã có dữ liệu chưa? Dùng để chọn cửa sổ: chưa có = lần đầu (backfill toàn bộ),
// đã có = incremental (window_days). Lỗi DB → coi như CHƯA có (an toàn: kéo rộng còn hơn thiếu).
export async function hasRevenueRows(networkId, accountId) {
  const { data, error } = await getSupabase()
    .from('revenue_raw')
    .select('id')
    .eq('network_id', networkId)
    .eq('account_id', accountId)
    .limit(1)
  if (error) return false
  return (data?.length ?? 0) > 0
}

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

  // Dọn dòng MỒ CÔI (như upsertRevenueBreakdown): khóa upsert gồm offer_name → đổi mapping giữa các
  // lần chạy (vd offer_name "Tolt"→"tolt", currency EUR→USD) sinh KHÓA MỚI, dòng cũ không bị đè →
  // ở lại thành rác và bị CỘNG TRÙNG ở tổng doanh thu. Xóa dòng CŨ (run_id KHÁC) trên ĐÚNG các ngày
  // vừa ghi. Chỉ đụng ngày CÓ trong batch → fetch thiếu ngày giữa không xóa nhầm. Pending + confirmed
  // ghi CÙNG runAccount (cùng run_id) nên KHÔNG prune lẫn nhau.
  if (runId != null && rows.length) {
    const groups = new Map()
    for (const r of rows) {
      const key = `${r.network_id} ${r.account_id}`
      let g = groups.get(key)
      if (!g) { g = { network_id: r.network_id, account_id: r.account_id, dates: new Set() }; groups.set(key, g) }
      g.dates.add(r.date)
    }
    for (const g of groups.values()) {
      const { error } = await supabase
        .from('revenue_raw')
        .delete()
        .eq('network_id', g.network_id)
        .eq('account_id', g.account_id)
        .in('date', [...g.dates])
        .neq('run_id', runId)
      if (error) throw new Error(`dọn dòng mồ côi revenue_raw: ${error.message}`)
    }
  }
  return upserted
}

// ---------- revenue_breakdown (doanh thu theo chiều: quốc gia/thiết bị/giờ/sub-id) ----------

// Config có report breakdown mà bảng chưa có dòng nào của account → chạy backfill
// (tự bootstrap khi user thêm report breakdown vào network đã sync lâu).
export async function hasBreakdownRows(networkId, accountId) {
  const { data, error } = await getSupabase()
    .from('revenue_breakdown')
    .select('id')
    .eq('network_id', networkId)
    .eq('account_id', accountId)
    .limit(1)
  if (error) return false
  return (data?.length ?? 0) > 0
}

// rows: [{ network_id, account_id, project_id, campaign_id, report, date, country, device,
//          hour, sub_id, offer_id, offer_name, revenue, currency, revenue_usd, fx_rate,
//          conversions, clicks, revenue_type, raw_payload }]
export async function upsertRevenueBreakdown(rows, runId) {
  const supabase = getSupabase()
  if (rows.length === 0) return 0

  // GHI-TRƯỚC-DỌN-SAU (insert-then-prune). Upsert-theo-cell không đủ: khi giá trị 1 chiều ĐỔI giữa
  // các lần chạy (vd extraction nâng cấp country '' -> 'BY' sinh key MỚI), dòng cũ '' ở lại thành
  // "cell mồ côi" -> đếm trùng doanh thu. Cách dọn:
  //   1) Upsert dòng mới (gắn run_id lần này).
  //   2) Xóa cell mồ côi = dòng CŨ (run_id KHÁC) trên ĐÚNG các NGÀY vừa ghi.
  // Chỉ đụng ngày CÓ trong batch -> fetch thiếu ngày giữa KHÔNG xóa nhầm ngày không ghi lại (không
  // mất dữ liệu). Ghi trước nên crash giữa chừng chỉ để trùng tạm (tự lành lần sau), không tạo lỗ hổng.
  let upserted = 0
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK).map((r) => ({
      ...r,
      run_id: runId,
      fetched_at: new Date().toISOString(),
    }))
    const { error } = await supabase
      .from('revenue_breakdown')
      .upsert(chunk, { onConflict: 'network_id,account_id,report,date,country,device,hour,sub_id,offer_id,offer_name' })
    if (error) throw new Error(`upsert revenue_breakdown (chunk ${i / UPSERT_CHUNK + 1}): ${error.message}`)
    upserted += chunk.length
  }

  // Dọn cell mồ côi — bỏ qua khi không có runId (dry-run) để không xóa nhầm.
  if (runId != null) {
    const groups = new Map()
    for (const r of rows) {
      const key = `${r.network_id} ${r.account_id} ${r.report}`
      let g = groups.get(key)
      if (!g) { g = { network_id: r.network_id, account_id: r.account_id, report: r.report, dates: new Set() }; groups.set(key, g) }
      g.dates.add(r.date)
    }
    for (const g of groups.values()) {
      const { error } = await supabase
        .from('revenue_breakdown')
        .delete()
        .eq('network_id', g.network_id)
        .eq('account_id', g.account_id)
        .eq('report', g.report)
        .in('date', [...g.dates])
        .neq('run_id', runId)
      if (error) throw new Error(`dọn cell mồ côi revenue_breakdown (${g.report}): ${error.message}`)
    }
  }
  return upserted
}

// ---------- affiliate_revenue (P&L) ----------

// Mutex trong-tiến-trình: key upsert là (project_id,date,type) KHÔNG có account → 2 account chạy
// SONG SONG có thể ghi đè nhau. Nối tiếp các lần ghi P&L (đoạn nhỏ, không cản browser chạy song song).
// Lưu ý: P&L vốn giả định ~1 account/project; mutex chỉ chống hỏng do song song, không đổi ngữ nghĩa đó.
let pnlChain = Promise.resolve()

// pnlRows: [{ project_id, date, amount }] — đã gộp SUM theo (project, ngày), amount = USD
// type: 'pending' (tiền màn hình/dashboard) | 'confirmed' (thực nhận/payout)
export function upsertAffiliateRevenue(pnlRows, type = 'pending') {
  const run = async () => {
    const supabase = getSupabase()
    const rows = pnlRows.map((r) => ({ ...r, type }))
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const { error } = await supabase
        .from('affiliate_revenue')
        .upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict: 'project_id,date,type' })
      if (error) throw new Error(`upsert affiliate_revenue: ${error.message}`)
    }
    return rows.length
  }
  // Xếp hàng sau lần ghi trước; lỗi của lần trước không làm hỏng chuỗi.
  const result = pnlChain.then(run, run)
  pnlChain = result.then(() => {}, () => {})
  return result
}
