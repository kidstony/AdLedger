// Dùng chung cho các tab của trang Doanh thu Engine: types, fetch có auth,
// format, và state machine "1 nút hành động chính" per account.
import { supabase } from '@/lib/supabase'

// ── API paths ────────────────────────────────────────────────────────────────
export const ACC_API = '/api/admin/revenue-engine/accounts'
export const CMD_API = '/api/admin/revenue-engine/commands'
export const SET_API = '/api/admin/revenue-engine/settings'
export const CFG_API = '/api/admin/revenue-engine/network-config'
export const ENGINE_API = '/api/admin/revenue-engine'

export async function authFetch(url: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession()
  return fetch(url, {
    ...opts,
    headers: { ...opts?.headers, 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
  })
}

// ── Types ────────────────────────────────────────────────────────────────────
export interface EngineAccount {
  id: string
  network_id: string
  account_id: string
  label: string
  project_id: string | null
  enabled: boolean
  dashboard_url: string | null
  login_url: string | null
  login_status: 'never' | 'ok' | 'needs_login' | 'error'
  last_login_at: string | null
  created_at: string
}

export interface EngineCommand {
  id: string
  type: 'login' | 'fetch' | 'discover' | 'fetch_breakdown'
  account_id: string | null
  status: 'pending' | 'running' | 'done' | 'error'
  message: string | null
  created_at?: string
  started_at?: string | null
}

export interface NetworkOpt { id: string; network_id: string | null; network_name: string; color?: string }
export interface ProjectOpt { project_id: string; name: string; affiliate_network?: string | null; affiliate_url?: string | null }

export interface Settings {
  auto_sync_enabled: boolean
  interval_hours: number
  last_auto_sync_at: string | null
  worker_last_seen_at?: string | null
}

export interface EngineRun {
  id: string
  network_id: string
  kind?: 'revenue' | 'breakdown'   // pipeline: doanh thu (P&L) | dữ liệu tối ưu camp
  status: 'running' | 'success' | 'failed'
  date_from: string | null
  date_to: string | null
  records_captured: number
  records_mapped: number
  records_upserted: number
  breakdown_upserted?: number
  error_type: string | null
  error_message: string | null
  started_at: string
  finished_at: string | null
}

export interface EngineAlert {
  id: string
  network_id: string
  error_type: string
  message: string | null
  occurrences: number
  first_seen: string
  last_seen: string
}

export interface DayRow {
  project_id: string | null
  project_name: string
  network_id: string
  account_id: string
  account_label: string
  date: string
  revenue: number              // chỉ PENDING (tiền màn hình) — không gộp confirmed
  revenue_usd: number | null
  revenueConfirmed: number     // CONFIRMED (payout/tiền thực) — hiển thị riêng, KHÔNG cộng vào tổng
  revenueUsdConfirmed: number | null
  currency: string
  rows: number
  last_fetched: string
}

// ── Format ───────────────────────────────────────────────────────────────────
export const ERROR_LABEL: Record<string, string> = {
  NO_CAPTURE: 'Mất phiên / đổi endpoint',
  MAPPING_FAILED: 'Sai cấu trúc dữ liệu',
  DB_ERROR: 'Lỗi ghi DB',
}

export function formatTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export function fmtNum(n: number) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function fmtUsd(n: number | null) {
  return n == null ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Tổng USD: null nếu không dòng nào có USD; ngược lại cộng các dòng có số.
export function sumUsd(rows: { revenue_usd: number | null }[]) {
  return rows.some(r => r.revenue_usd != null)
    ? rows.reduce((a, r) => a + (r.revenue_usd ?? 0), 0)
    : null
}

// ── Worker liveness ──────────────────────────────────────────────────────────
// Worker heartbeat ~30s → online nếu tuổi < 90s (3 nhịp). null/thiếu cột → 'unknown'
// (migration heartbeat chưa chạy hoặc worker bản cũ).
export type WorkerState = 'online' | 'offline' | 'unknown'
export function workerState(lastSeen: string | null | undefined, nowMs: number): WorkerState {
  if (!lastSeen) return 'unknown'
  return nowMs - new Date(lastSeen).getTime() < 90_000 ? 'online' : 'offline'
}

// ── State machine: 1 nút hành động chính per account ─────────────────────────
export type RowAction =
  | { kind: 'busy'; label: string }        // có lệnh pending/running → spinner disabled
  | { kind: 'need-url' }                    // thiếu dashboard_url → nhắc nhập URL
  | { kind: 'need-config' }                 // network chưa có config → nút "Cấu hình"
  | { kind: 'connect' }                     // chưa/lỗi đăng nhập → "Kết nối"
  | { kind: 'relogin' }                     // mất phiên → "Đăng nhập lại" (force)
  | { kind: 'sync' }                        // sẵn sàng → "Đồng bộ"

const BUSY_LABEL: Record<EngineCommand['type'], string> = {
  login: 'Đang kết nối…',
  fetch: 'Đang đồng bộ…',
  discover: 'Đang dò…',
  fetch_breakdown: 'Đang đồng bộ dữ liệu tối ưu…',
}

export function nextAction(a: EngineAccount, activeCmd: EngineCommand | undefined, configured: boolean): RowAction {
  if (activeCmd) return { kind: 'busy', label: BUSY_LABEL[activeCmd.type] ?? 'Đang chạy…' }
  if (!a.dashboard_url) return { kind: 'need-url' }
  if (!configured) return { kind: 'need-config' }
  if (a.login_status === 'needs_login') return { kind: 'relogin' }
  if (a.login_status === 'ok') return { kind: 'sync' }
  return { kind: 'connect' } // never | error
}
