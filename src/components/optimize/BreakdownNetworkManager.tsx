'use client'

// Quản lý pipeline DỮ LIỆU TỐI ƯU CAMP (breakdown) — độc lập hoàn toàn với pipeline
// doanh thu (P&L): lệnh riêng (fetch_breakdown), run/alert riêng, bật/tắt riêng.
// Chung Chrome profile với engine doanh thu → đăng nhập 1 lần dùng cho cả hai.
// Chỉ render cho super_admin/manager (khớp guard của commands/config API).

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Loader2, RefreshCw, Wand2, WifiOff } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import StatusPill from '@/components/ui/StatusPill'
import EmptyState from '@/components/ui/EmptyState'
import { cn, formatVND } from '@/lib/utils'
import { countryNameByAlpha2 } from '@/lib/geo-targets'
import {
  CMD_API, CFG_API, authFetch, formatTime, workerState, ERROR_LABEL,
  type EngineCommand,
} from '@/app/admin/revenue-engine/shared'

const DEVICE_LABEL: Record<string, string> = { mobile: 'Di động', desktop: 'Máy tính', tablet: 'Tablet', other: 'Khác' }

// Tóm tắt dữ liệu breakdown đã thu của 1 account (từ API).
interface DataSummary {
  totalUsd: number
  rows: number
  minDate: string | null
  maxDate: string | null
  lastFetched: string | null
  hasCountry: boolean
  hasDevice: boolean
  hasHour: boolean
  hasSub: boolean
  subPct: number
  byCountry: { country: string; usd: number; pct: number }[]
  byDevice: { device: string; usd: number; pct: number }[]
  byHour: number[]
}

interface BdRun {
  status: 'running' | 'success' | 'failed'
  breakdown_upserted: number | null
  error_type: string | null
  error_message: string | null
  date_from: string | null
  date_to: string | null
  started_at: string
  finished_at: string | null
}

interface BdRow {
  account_uuid: string
  account_id: string
  label: string
  network_id: string
  network_name: string
  project_id: string | null
  project_name: string | null
  login_status: 'never' | 'ok' | 'needs_login' | 'error'
  account_enabled: boolean
  dashboard_url: string | null
  breakdown_enabled: boolean
  has_breakdown_config: boolean
  breakdown_report_names: string[]
  last_run: BdRun | null
  open_alerts: { error_type: string; message: string | null; occurrences: number; last_seen: string }[]
  data_summary: DataSummary | null
}

interface Resp {
  settings: { auto_sync_enabled: boolean; interval_hours: number; worker_last_seen_at: string | null }
  rows: BdRow[]
}

// Kết quả detect phần breakdown (mini-flow "Dò & cấu hình").
interface DetectBreakdown {
  name?: string
  detected: boolean
  source: { url: string; rows_path: string; rows: number; page?: string | null; via_tab?: string | null }
  dims: { country: string | null; device: string | null; time: string | null; sub_id: string | null; transaction_id: string | null }
  preview: { country: string; revenue: number }[]
  draft_report: Record<string, unknown>
}
interface DetectResp {
  breakdown?: DetectBreakdown | null
  breakdown_reports?: DetectBreakdown[]   // TẤT CẢ report breakdown (geo/device/giờ) — mỗi tab 1 report
  manual_columns?: { field: string; label: string; sample: string }[]   // cột để user chỉ tay khi auto bó
  draft: Record<string, unknown> | null
  pages?: { page: string | null; hasBreakdownDims: boolean }[]
  error?: string
}

const ACTIVE = ['pending', 'running']

// Slug network → tên đẹp hiển thị: "amnezia-network"→"Amnezia", "proxy-seller-network"→"Proxy Seller".
// Nếu network_name đã đặt riêng (khác slug) thì dùng luôn.
function prettyNetwork(id: string, name?: string | null): string {
  if (name && name !== id) return name
  const base = id.replace(/[-_]?network$/i, '') || id
  return base.split(/[-_]+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || id
}

// Thời gian tương đối tiếng Việt cho lần sync gần nhất (mốc tuyệt đối để ở tooltip).
function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return 'vừa xong'
  const m = Math.floor(s / 60); if (m < 60) return `${m} phút trước`
  const h = Math.floor(m / 60); if (h < 24) return `${h} giờ trước`
  const d = Math.floor(h / 24); if (d === 1) return 'hôm qua'
  if (d < 30) return `${d} ngày trước`
  return new Date(iso).toLocaleDateString('vi-VN')
}

// Tên hiển thị 1 account: ưu tiên tên dự án (thân thiện), rồi label; slug chỉ để tham chiếu.
function acctLabel(row: BdRow): string {
  return row.project_name || row.label || row.account_id
}

// Thanh % nhỏ nằm ngang (tóm tắt inline).
function MiniBar({ pct, tone }: { pct: number; tone: 'indigo' | 'emerald' }) {
  return (
    <span className="inline-block h-1.5 w-12 shrink-0 rounded-full bg-slate-100 align-middle">
      <span className={cn('block h-1.5 rounded-full', tone === 'indigo' ? 'bg-indigo-400' : 'bg-emerald-400')}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </span>
  )
}

// Chip các chiều đã thu (Quốc gia/Thiết bị/Giờ/Sub-ID) — liếc là biết network thu được gì.
function DimChips({ sum }: { sum: DataSummary }) {
  const chips = ([['Quốc gia', sum.hasCountry], ['Thiết bị', sum.hasDevice], ['Giờ', sum.hasHour], ['Sub-ID', sum.hasSub]] as const).filter(([, h]) => h)
  if (!chips.length) return null
  return (
    <span className="flex flex-wrap gap-1">
      {chips.map(([l]) => <span key={l} className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">{l} ✓</span>)}
    </span>
  )
}

// Tóm tắt inline: thấy NGAY tổng $ + top quốc gia + top thiết bị (kèm thanh %) không cần mở chi tiết.
function InlineSummary({ sum }: { sum: DataSummary }) {
  const topC = sum.byCountry.find(c => c.country !== '__other__') ?? sum.byCountry[0]
  const topD = sum.byDevice[0]
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span className="font-semibold text-amber-500" title="Doanh thu màn hình (tín hiệu sớm)">{formatVND(sum.totalUsd)}</span>
      {topC && (
        <span className="flex items-center gap-1.5 text-slate-600">
          <span className="max-w-[9rem] truncate">{topC.country === '__other__' ? 'Nước khác' : countryNameByAlpha2(topC.country)}</span>
          <MiniBar pct={topC.pct} tone="indigo" />
          <span className="tabular-nums text-slate-400">{topC.pct}%</span>
        </span>
      )}
      {topD && (
        <span className="flex items-center gap-1.5 text-slate-600">
          <span>{DEVICE_LABEL[topD.device] ?? topD.device}</span>
          <MiniBar pct={topD.pct} tone="emerald" />
          <span className="tabular-nums text-slate-400">{topD.pct}%</span>
        </span>
      )}
    </div>
  )
}

export default function BreakdownNetworkManager() {
  const [data, setData] = useState<Resp | null>(null)
  const [commands, setCommands] = useState<EngineCommand[]>([])
  const [error, setError] = useState<string | null>(null)
  const [dialogRow, setDialogRow] = useState<BdRow | null>(null)
  const [syncingAll, setSyncingAll] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set()) // account_uuid đang mở rộng
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const toggleExpand = (uuid: string) => setExpanded(s => {
    const n = new Set(s); n.has(uuid) ? n.delete(uuid) : n.add(uuid); return n
  })

  const load = useCallback(async () => {
    const res = await authFetch('/api/optimize/breakdown-networks')
    if (res.ok) setData(await res.json())
  }, [])
  const loadCommands = useCallback(async () => {
    const res = await authFetch(CMD_API)
    if (res.ok) setCommands((await res.json()).commands ?? [])
  }, [])

  useEffect(() => { load(); loadCommands() }, [load, loadCommands])

  // Đang có lệnh breakdown/dò chạy → poll 4s để trạng thái sống (pattern AccountsTab).
  const hasActive = commands.some(c =>
    (c.type === 'fetch_breakdown' || c.type === 'discover') && ACTIVE.includes(c.status))
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (!hasActive) return
    pollRef.current = setInterval(() => { loadCommands(); load() }, 4000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [hasActive, load, loadCommands])

  const activeCmd = (accountUuid: string) =>
    commands.find(c => c.account_id === accountUuid && ACTIVE.includes(c.status) &&
      (c.type === 'fetch_breakdown' || c.type === 'discover'))

  const ws = workerState(data?.settings.worker_last_seen_at, Date.now())
  const workerOffline = ws === 'offline'

  // Toggle bật/tắt per network — PATCH cột riêng, optimistic (không đụng config doanh thu).
  const toggleNetwork = async (networkId: string, enabled: boolean) => {
    setData(d => d ? { ...d, rows: d.rows.map(r => r.network_id === networkId ? { ...r, breakdown_enabled: enabled } : r) } : d)
    const res = await authFetch(CFG_API, { method: 'PATCH', body: JSON.stringify({ network_id: networkId, breakdown_enabled: enabled }) })
    if (!res.ok) {
      setData(d => d ? { ...d, rows: d.rows.map(r => r.network_id === networkId ? { ...r, breakdown_enabled: !enabled } : r) } : d)
      toast.error((await res.json().catch(() => ({}))).error ?? 'Không đổi được trạng thái')
    }
  }

  const sync = async (row: BdRow) => {
    setError(null)
    const res = await authFetch(CMD_API, { method: 'POST', body: JSON.stringify({ type: 'fetch_breakdown', account_id: row.account_uuid }) })
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? 'Lỗi tạo lệnh'); return }
    loadCommands()
  }

  // Đồng bộ tất cả: xếp fetch_breakdown cho MỌI account đủ điều kiện (có config + bật + đã login + không đang chạy).
  const syncAll = async () => {
    if (workerOffline) { toast.error('Worker offline'); return }
    const el = (data?.rows ?? []).filter(r =>
      r.has_breakdown_config && r.breakdown_enabled && r.login_status === 'ok' && !activeCmd(r.account_uuid))
    if (!el.length) { toast.info('Không có network nào đủ điều kiện đồng bộ'); return }
    setSyncingAll(true)
    let n = 0
    try {
      for (const r of el) {
        const res = await authFetch(CMD_API, { method: 'POST', body: JSON.stringify({ type: 'fetch_breakdown', account_id: r.account_uuid }) })
        if (res.ok) n++
      }
      toast.success(`Đã xếp ${n} lệnh đồng bộ`)
      loadCommands()
    } finally { setSyncingAll(false) }
  }

  const statusPill = (row: BdRow) => {
    const cmd = activeCmd(row.account_uuid)
    if (cmd) {
      return <StatusPill tone="amber" icon={Loader2} spin>
        {cmd.type === 'discover' ? 'Đang dò…' : 'Đang đồng bộ…'}
      </StatusPill>
    }
    if (!row.has_breakdown_config) return <StatusPill tone="slate">Chưa cấu hình</StatusPill>
    if (row.open_alerts.length) {
      const a = row.open_alerts[0]
      return <span title={a.message ?? ''}>
        <StatusPill tone="red">{ERROR_LABEL[a.error_type] ?? 'Lỗi'} · {a.occurrences} lần</StatusPill>
      </span>
    }
    const run = row.last_run
    if (run?.status === 'success') {
      return <span title={`Cập nhật ${formatTime(run.finished_at)}`}>
        <StatusPill tone="green">OK · {run.breakdown_upserted ?? 0} dòng · {timeAgo(run.finished_at)}</StatusPill>
      </span>
    }
    if (run?.status === 'failed') {
      return <span title={run.error_message ?? ''}>
        <StatusPill tone="red">{ERROR_LABEL[run.error_type ?? ''] ?? 'Lỗi'}</StatusPill>
      </span>
    }
    return <StatusPill tone="slate">Chưa chạy</StatusPill>
  }

  if (!data) {
    return <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
      <RefreshCw size={15} className="mx-auto mb-2 animate-spin" /> Đang tải trạng thái network…
    </div>
  }

  const byNetwork = new Map<string, BdRow[]>()
  for (const r of data.rows) {
    const arr = byNetwork.get(r.network_id) ?? []
    arr.push(r)
    byNetwork.set(r.network_id, arr)
  }

  // Thân 1 account: trạng thái + tóm tắt inline + chips + hành động + chi tiết (mở rộng).
  // showName = network nhiều account → hiện tên account; 1 account thì tên đã gộp ở header thẻ.
  const renderAccount = (row: BdRow, showName: boolean) => {
    const busy = !!activeCmd(row.account_uuid)
    const canSync = row.has_breakdown_config && row.breakdown_enabled && row.login_status === 'ok' && !busy && !workerOffline
    const canConfig = !busy && !workerOffline && !!row.dashboard_url
    const sum = row.data_summary
    const open = expanded.has(row.account_uuid)
    return (
      <div key={row.account_uuid} className={cn('px-4 py-3', !row.breakdown_enabled && 'opacity-60')}>
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            {showName && (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-700">{acctLabel(row)}</span>
                <span className="font-mono text-[10px] text-slate-300">{row.account_id}</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {statusPill(row)}
              {sum && <DimChips sum={sum} />}
            </div>
            {sum
              ? <InlineSummary sum={sum} />
              : <p className="text-xs text-slate-400">
                  {row.has_breakdown_config ? 'Chưa có dữ liệu — bấm "Đồng bộ".' : 'Chưa cấu hình — bấm "Dò & cấu hình".'}
                </p>}
            {sum && (
              <button onClick={() => toggleExpand(row.account_uuid)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:underline">
                <ChevronRight size={12} className={cn('transition-transform', open && 'rotate-90')} />
                {open ? 'Ẩn chi tiết' : 'Xem chi tiết'}
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="ghost" disabled={!canSync}
              title={!row.has_breakdown_config ? 'Chưa cấu hình — bấm "Dò & cấu hình" trước'
                : row.login_status !== 'ok' ? 'Chưa kết nối — đăng nhập ở Admin → Revenue Engine'
                : !row.breakdown_enabled ? 'Đang tắt thu dữ liệu tối ưu'
                : workerOffline ? 'Worker offline' : 'Đồng bộ dữ liệu tối ưu ngay'}
              onClick={() => sync(row)}>
              <RefreshCw size={13} /> Đồng bộ
            </Button>
            <Button size="sm" variant="ghost" disabled={!canConfig}
              title={!row.dashboard_url ? 'Account chưa có URL dashboard' : workerOffline ? 'Worker offline' : 'Tự quét trang báo cáo (quốc gia/thiết bị/giờ) và tạo cấu hình'}
              onClick={() => setDialogRow(row)}>
              <Wand2 size={13} /> Dò &amp; cấu hình
            </Button>
          </div>
        </div>
        {open && (
          <div className="mt-2 overflow-hidden rounded-lg border border-slate-100 bg-slate-50/50">
            <DataSummaryPanel row={row} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Kết nối network — dữ liệu tối ưu</h2>
          <p className="text-[11px] text-slate-400">
            Pipeline riêng, không đụng doanh thu · chung phiên Chrome
            {data.settings.auto_sync_enabled ? ` · auto-sync ${data.settings.interval_hours}h` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {workerOffline && <StatusPill tone="red" icon={WifiOff}>Worker offline</StatusPill>}
          <Button size="sm" variant="outline" disabled={workerOffline || syncingAll} onClick={syncAll}>
            {syncingAll ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Đồng bộ tất cả
          </Button>
        </div>
      </div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {byNetwork.size === 0 ? (
        <EmptyState message="Chưa có network nào. Thêm tài khoản network ở Admin → Revenue Engine trước, rồi quay lại đây để cấu hình dữ liệu tối ưu." />
      ) : (
        <div className="space-y-3">
          {[...byNetwork.entries()].map(([networkId, rows]) => {
            const single = rows.length === 1
            return (
              <div key={networkId} className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-slate-800">{prettyNetwork(networkId, rows[0].network_name)}</span>
                    {single && <span className="text-xs text-slate-500">· {acctLabel(rows[0])}</span>}
                    <span className="font-mono text-[10px] text-slate-300">{networkId}</span>
                  </div>
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500"
                    title="Bật/tắt pipeline dữ liệu tối ưu cho network này — không ảnh hưởng đồng bộ doanh thu">
                    <input type="checkbox" checked={rows[0].breakdown_enabled}
                      onChange={e => toggleNetwork(networkId, e.target.checked)} className="accent-indigo-600" />
                    Thu dữ liệu tối ưu
                  </label>
                </div>
                <div className="divide-y divide-slate-100">
                  {rows.map(row => renderAccount(row, !single))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {dialogRow && (
        <BreakdownConfigDialog
          row={dialogRow}
          onClose={() => setDialogRow(null)}
          onSaved={() => { setDialogRow(null); toast.success('Đã lưu cấu hình dữ liệu tối ưu'); load() }}
        />
      )}
    </div>
  )
}

// ── Panel mở rộng: dữ liệu breakdown đã thu của 1 account (quốc gia/thiết bị/giờ) ──────
function DataSummaryPanel({ row }: { row: BdRow }) {
  const sum = row.data_summary
  if (!sum) {
    return (
      <div className="px-6 py-4 text-xs text-slate-400">
        {row.has_breakdown_config
          ? 'Chưa có dữ liệu — bấm "Đồng bộ" để engine thu dữ liệu tối ưu về.'
          : 'Chưa cấu hình — bấm "Dò & cấu hình" để engine tự tìm nguồn dữ liệu quốc gia/thiết bị/giờ.'}
      </div>
    )
  }
  const hourMax = Math.max(...sum.byHour, 1)
  return (
    <div className="space-y-3 px-6 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
        <span>Khoảng ngày: <b className="text-slate-600">{sum.minDate} → {sum.maxDate}</b></span>
        <span>Tổng: <b className="text-slate-700">{formatVND(sum.totalUsd)}</b></span>
        {sum.hasSub && <span>Sub-ID: <b className="text-slate-600">{sum.subPct}%</b> doanh thu</span>}
        <span>Cập nhật: {formatTime(sum.lastFetched)}</span>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {sum.byCountry.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-600">Doanh thu theo quốc gia</div>
            <div className="max-h-56 overflow-auto">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-slate-50">
                  {sum.byCountry.map(c => (
                    <tr key={c.country} className={c.country === '__other__' ? 'text-slate-400 italic' : ''}>
                      <td className="px-3 py-1.5 text-slate-700">
                        {c.country === '__other__'
                          ? <span className="text-slate-500">Nước khác (ngoài top)</span>
                          : <>{countryNameByAlpha2(c.country)} <span className="text-[10px] text-slate-300">{c.country}</span></>}
                      </td>
                      <td className="w-24 px-2 py-1.5">
                        <div className="h-1.5 rounded-full bg-slate-100">
                          <div className="h-1.5 rounded-full bg-indigo-400" style={{ width: `${Math.min(100, c.pct)}%` }} />
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{c.pct}%</td>
                      <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-slate-800">{formatVND(c.usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {sum.byDevice.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-600">Doanh thu theo thiết bị</div>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-slate-50">
                  {sum.byDevice.map(d => (
                    <tr key={d.device}>
                      <td className="px-3 py-1.5 text-slate-700">{DEVICE_LABEL[d.device] ?? d.device}</td>
                      <td className="w-24 px-2 py-1.5">
                        <div className="h-1.5 rounded-full bg-slate-100">
                          <div className="h-1.5 rounded-full bg-emerald-400" style={{ width: `${Math.min(100, d.pct)}%` }} />
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{d.pct}%</td>
                      <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-slate-800">{formatVND(d.usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sum.hasHour && (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="mb-1.5 text-[11px] font-medium text-slate-600">Doanh thu theo giờ (múi giờ dữ liệu nguồn)</div>
              <div className="flex h-12 items-end gap-[2px]">
                {sum.byHour.map((usd, h) => (
                  <div key={h} className="flex-1" title={`${h}h: ${formatVND(usd)}`}>
                    <div className="w-full rounded-t bg-sky-400/80" style={{ height: `${Math.round((usd / hourMax) * 44)}px` }} />
                  </div>
                ))}
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] text-slate-300"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Dialog "Dò & cấu hình": discover (auto-scan) → detect → lưu report breakdown ──────
// Lưu KHÔNG PHÁ config doanh thu: GET config hiện có → PUT { ...config, reports: [draft] }
// — merge phía server giữ nguyên group pending/confirmed, spread giữ fx/login_check/mapping.
function BreakdownConfigDialog({ row, onClose, onSaved }: {
  row: BdRow
  onClose: () => void
  onSaved: () => void
}) {
  const [phase, setPhase] = useState<'starting' | 'discovering' | 'detecting' | 'result' | 'saving'>('starting')
  const [cmdId, setCmdId] = useState<string | null>(null)
  const [progressMsg, setProgressMsg] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [det, setDet] = useState<DetectResp | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [manOpen, setManOpen] = useState(false)          // mở khối chỉnh tay
  const [manCountry, setManCountry] = useState('')        // cột user chỉ = quốc gia
  const [manDevice, setManDevice] = useState('')          // cột user chỉ = thiết bị
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // manual: gửi kèm breakdown_manual (cột user chỉ) → detect build report theo cột đó (trích text).
  const runDetect = useCallback(async (manual?: { country_field?: string; device_field?: string }) => {
    setPhase('detecting')
    const res = await authFetch(`${CFG_API}/detect`, {
      method: 'POST',
      body: JSON.stringify({ network_id: row.network_id, source_url: null, revenue_type: 'pending', ...(manual ? { breakdown_manual: manual } : {}) }),
    })
    const d: DetectResp = await res.json().catch(() => ({ draft: null }))
    if (!res.ok) { setErr(d.error ?? 'Lỗi phân tích'); setPhase('result'); return }
    setDet(d)
    setPhase('result')
  }, [row.network_id])

  const applyManual = () => {
    if (!manCountry && !manDevice) return
    runDetect({ ...(manCountry ? { country_field: manCountry } : {}), ...(manDevice ? { device_field: manDevice } : {}) })
  }

  const startDiscover = useCallback(async () => {
    setErr(null); setDet(null); setProgressMsg(null); setPhase('starting')
    const res = await authFetch(CMD_API, {
      method: 'POST',
      body: JSON.stringify({ type: 'discover', account_id: row.account_uuid, discover_scan: true }),
    })
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? 'Lỗi tạo lệnh dò'); setPhase('result'); return }
    const { command } = await res.json()
    setCmdId(command.id); setAnalyzing(false); setPhase('discovering')
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const r = await authFetch(CMD_API)
      if (!r.ok) return
      const { commands } = await r.json()
      const c = commands.find((x: { id: string }) => x.id === command.id)
      if (c?.status === 'running') setProgressMsg(c.message ?? null)
      if (c && (c.status === 'done' || c.status === 'error')) {
        if (pollRef.current) clearInterval(pollRef.current)
        if (c.status === 'error') { setErr(c.message ?? 'Dò thất bại'); setPhase('result'); return }
        runDetect()
      }
    }, 4000)
  }, [row.account_uuid, runDetect])

  useEffect(() => {
    startDiscover()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signalAnalyze = async () => {
    if (!cmdId) return
    setAnalyzing(true)
    await authFetch(CMD_API, { method: 'PATCH', body: JSON.stringify({ id: cmdId, signal: 'analyze' }) })
  }

  // Tất cả report breakdown dò được (geo/device/giờ) — response cũ chỉ có `breakdown` → fallback.
  const bdReports = det?.breakdown_reports?.length ? det.breakdown_reports : (det?.breakdown ? [det.breakdown] : [])
  const bd = bdReports[0] ?? null

  const save = async () => {
    const drafts = bdReports.map(r => r.draft_report).filter(Boolean)
    if (!drafts.length) return
    setPhase('saving'); setErr(null)
    // GET-then-PUT: lấy config hiện có làm base (fx/login_check/project_mapping/reports doanh thu
    // giữ nguyên qua merge server); network chưa từng cấu hình → dùng draft base của detect.
    // Gửi TẤT CẢ report breakdown 1 lần — merge giữ group doanh thu, các tên breakdown khác nhau cùng tồn tại.
    const getRes = await authFetch(`${CFG_API}?network_id=${encodeURIComponent(row.network_id)}`)
    const existing = getRes.ok ? (await getRes.json()).config : null
    const base = (existing?.config as Record<string, unknown> | undefined) ?? det?.draft ?? { network_id: row.network_id }
    const config = { ...base, reports: drafts }
    const putRes = await authFetch(CFG_API, { method: 'PUT', body: JSON.stringify({ network_id: row.network_id, config }) })
    if (!putRes.ok) { setErr((await putRes.json().catch(() => ({}))).error ?? 'Lỗi lưu cấu hình'); setPhase('result'); return }
    onSaved()
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 size={16} className="text-indigo-600" /> Dò dữ liệu tối ưu — {row.network_name}
          </DialogTitle>
        </DialogHeader>

        {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

        {(phase === 'starting' || phase === 'discovering') && (
          <div className="space-y-3 py-4 text-center text-sm text-slate-600">
            <Loader2 size={18} className="mx-auto animate-spin text-indigo-600" />
            <p>Sang cửa sổ Chrome trên máy worker: chỉ cần <b>đăng nhập</b> (nếu chưa) — engine sẽ <b>tự quét các trang báo cáo</b> tìm dữ liệu quốc gia/thiết bị/giờ.</p>
            {progressMsg && <p className="text-xs font-medium text-indigo-600">{progressMsg}</p>}
            <button onClick={signalAnalyze} disabled={analyzing || phase === 'starting'}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-60">
              {analyzing ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
              {analyzing ? 'Đang quét & phân tích…' : 'Đã đăng nhập — Quét & phân tích'}
            </button>
          </div>
        )}

        {phase === 'detecting' && (
          <div className="py-6 text-center text-sm text-slate-500">
            <Loader2 size={16} className="mx-auto mb-2 animate-spin" /> Đang phân tích dữ liệu đã quét…
          </div>
        )}

        {phase === 'result' && !bd?.detected && !err && (
          <div className="space-y-2 text-sm text-slate-600">
            <p>Không tự nhận ra cột quốc gia/thiết bị trên các trang đã quét.</p>
            {(det?.pages?.length ?? 0) > 0 && (
              <p className="text-xs text-slate-400">
                Đã quét: {det!.pages!.map(p => p.page ?? '?').join(', ')}.
              </p>
            )}
            {/* Chỉnh tay: user chỉ cột chứa quốc gia/thiết bị (engine trích tên nước/từ khóa từ text) */}
            {(det?.manual_columns?.length ?? 0) > 0 ? (
              <ManualMapping columns={det!.manual_columns!} manCountry={manCountry} manDevice={manDevice}
                setManCountry={setManCountry} setManDevice={setManDevice} onApply={applyManual} />
            ) : (
              <p className="text-xs text-slate-400">Mẹo: mở đúng trang báo cáo chuyển đổi (Conversions) trước khi Quét, hoặc thử lại.</p>
            )}
            <Button variant="outline" onClick={startDiscover}><Wand2 size={13} /> Dò lại</Button>
          </div>
        )}

        {(phase === 'result' || phase === 'saving') && bd?.detected && (
          <div className="space-y-2.5">
            <p className="text-[11px] text-slate-500">
              Dò được <b>{bdReports.length}</b> nguồn dữ liệu tối ưu:
            </p>
            {/* Mỗi report 1 dòng — chỉ hiện dimension report đó mang + tab nguồn */}
            <div className="space-y-1.5">
              {bdReports.map((r, ri) => (
                <div key={r.name ?? ri} className="flex flex-wrap items-center gap-1.5 text-[10px]">
                  {([
                    ['Quốc gia', r.dims.country],
                    ['Thiết bị', r.dims.device],
                    ['Giờ', r.dims.time],
                    ['Sub-ID', r.dims.sub_id],
                  ] as const).filter(([, f]) => f).map(([label]) => (
                    <span key={label} className="rounded-full border border-indigo-300 bg-indigo-50 px-1.5 py-0.5 text-indigo-700">{label} ✓</span>
                  ))}
                  <span className="px-1 text-slate-400">
                    {r.source.rows} dòng
                    {r.source.via_tab ? <> · tab <span className="font-mono text-slate-500">{r.source.via_tab}</span></>
                      : r.source.page ? <> · trang <span className="font-mono text-slate-500">{r.source.page}</span></> : null}
                  </span>
                </div>
              ))}
            </div>
            {bd.preview.length > 0 && (
              <div className="overflow-hidden rounded border border-slate-200">
                <div className="border-b border-slate-100 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">Preview doanh thu theo quốc gia</div>
                <table className="w-full text-[11px]">
                  <tbody className="divide-y divide-slate-50">
                    {bd.preview.map(p => (
                      <tr key={p.country}>
                        <td className="px-2 py-0.5 text-slate-600">{p.country}</td>
                        <td className="px-2 py-0.5 text-right font-mono text-slate-800">{p.revenue.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!bd.dims.sub_id && (
              <p className="text-[10px] text-slate-400">
                Chưa thấy cột sub-id — muốn doanh thu gắn đúng từng campaign: Google Ads → Final URL suffix thêm <code className="font-mono">&lt;tham_số_sub&gt;={'{campaignid}'}</code>.
              </p>
            )}
            {/* Chỉnh tay nếu auto nhận nhầm/thiếu cột */}
            {(det?.manual_columns?.length ?? 0) > 0 && (
              <div>
                <button onClick={() => setManOpen(o => !o)} className="text-[11px] text-indigo-600 hover:underline">
                  {manOpen ? '▾ Ẩn chỉnh tay' : '▸ Nhận sai/thiếu cột? Chỉnh tay'}
                </button>
                {manOpen && (
                  <div className="mt-1.5">
                    <ManualMapping columns={det!.manual_columns!} manCountry={manCountry} manDevice={manDevice}
                      setManCountry={setManCountry} setManDevice={setManDevice} onApply={applyManual} />
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={startDiscover} disabled={phase === 'saving'}>Dò lại</Button>
              <Button onClick={save} disabled={phase === 'saving'}>
                {phase === 'saving' ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Lưu cấu hình
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Khối chỉnh tay: user chọn CỘT chứa quốc gia/thiết bị (engine trích tên nước/từ khóa từ text).
function ManualMapping({ columns, manCountry, manDevice, setManCountry, setManDevice, onApply }: {
  columns: { field: string; label: string; sample: string }[]
  manCountry: string
  manDevice: string
  setManCountry: (v: string) => void
  setManDevice: (v: string) => void
  onApply: () => void
}) {
  const opt = (c: { field: string; label: string; sample: string }) =>
    `${c.label}${c.sample ? ` — "${c.sample}"` : ''}`
  return (
    <div className="space-y-2 rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-2">
      <p className="text-[11px] text-slate-500">Chỉ cột chứa quốc gia / thiết bị — engine tự trích tên nước, từ khóa thiết bị (mobile/desktop) từ text.</p>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <label className="space-y-0.5">
          <span className="text-slate-500">Cột quốc gia</span>
          <select value={manCountry} onChange={e => setManCountry(e.target.value)} className="w-full rounded border border-slate-200 px-1.5 py-1 text-slate-700">
            <option value="">— không —</option>
            {columns.map(c => <option key={c.field} value={c.field}>{opt(c)}</option>)}
          </select>
        </label>
        <label className="space-y-0.5">
          <span className="text-slate-500">Cột thiết bị</span>
          <select value={manDevice} onChange={e => setManDevice(e.target.value)} className="w-full rounded border border-slate-200 px-1.5 py-1 text-slate-700">
            <option value="">— không —</option>
            {columns.map(c => <option key={c.field} value={c.field}>{opt(c)}</option>)}
          </select>
        </label>
      </div>
      <Button size="sm" variant="outline" disabled={!manCountry && !manDevice} onClick={onApply}>
        <Wand2 size={12} /> Áp dụng cột đã chọn
      </Button>
    </div>
  )
}
