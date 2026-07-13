'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle, ChevronDown, ChevronRight, Clock, Loader2, Search, XCircle } from 'lucide-react'
import StatusPill from '@/components/ui/StatusPill'
import EmptyState from '@/components/ui/EmptyState'
import TableSkeleton from '@/components/ui/TableSkeleton'
import { cn } from '@/lib/utils'
import {
  ERROR_LABEL, formatTime, fmtNum, fmtUsd, sumUsd,
  type DayRow, type EngineAlert, type EngineRun,
} from './shared'

interface Props {
  loading: boolean
  runs: EngineRun[]
  alerts: EngineAlert[]
  days: DayRow[]
}

interface AccountGroup {
  key: string
  projectName: string
  accountLabel: string
  networkId: string
  rows: DayRow[]
  minDate: string
  maxDate: string
  totalRaw: number            // chỉ pending
  totalUsd: number | null
  totalUsdConfirmed: number | null   // payout/tiền thực — hiển thị riêng, không cộng vào tổng
  currency: string
  lastFetched: string
}

// Tab "Dữ liệu & Lịch sử": bảng phẳng theo account (expand ra bảng ngày) + filter + lịch sử chạy.
export default function MonitorTab({ loading, runs, alerts, days }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [netFilter, setNetFilter] = useState('')
  const [showRuns, setShowRuns] = useState(false)

  const toggle = (key: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  // Gom theo (project, account) — 1 dòng / account, bỏ tầng project (đa số dự án chỉ 1 account).
  const groups = useMemo<AccountGroup[]>(() => {
    const map = new Map<string, DayRow[]>()
    for (const d of days) {
      const key = `${d.project_id ?? '∅'}|${d.account_id}`
      const arr = map.get(key) ?? []
      arr.push(d)
      map.set(key, arr)
    }
    return [...map.entries()].map(([key, rows]) => {
      const dates = rows.map(r => r.date).sort()
      return {
        key,
        projectName: rows[0].project_name,
        accountLabel: rows[0].account_label || rows[0].account_id,
        networkId: rows[0].network_id,
        rows,
        minDate: dates[0] ?? '',
        maxDate: dates[dates.length - 1] ?? '',
        totalRaw: rows.reduce((a, r) => a + r.revenue, 0),
        totalUsd: sumUsd(rows),
        totalUsdConfirmed: rows.some(r => r.revenueUsdConfirmed != null)
          ? rows.reduce((a, r) => a + (r.revenueUsdConfirmed ?? 0), 0)
          : null,
        currency: rows[0].currency ?? '',
        lastFetched: rows.map(r => r.last_fetched).sort().pop() ?? '',
      }
    })
  }, [days])

  const networkIds = useMemo(() => [...new Set(days.map(d => d.network_id))].sort(), [days])

  const filtered = groups.filter(g => {
    if (netFilter && g.networkId !== netFilter) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      if (!g.projectName.toLowerCase().includes(q) && !g.accountLabel.toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <div className="space-y-4">
      {/* Cảnh báo đang mở */}
      {alerts.length > 0 && (
        <div className="border border-red-200 bg-red-50 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-red-100 flex items-center gap-2">
            <AlertTriangle size={15} className="text-red-500" />
            <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">{alerts.length} cảnh báo đang mở</p>
          </div>
          <div className="divide-y divide-red-100">
            {alerts.map(a => (
              <div key={a.id} className="px-4 py-2.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-800">{a.network_id.replace(/:breakdown$/, ' (tối ưu)')}</span>
                  <StatusPill tone="red">{ERROR_LABEL[a.error_type] ?? a.error_type}</StatusPill>
                </div>
                {a.message && <p className="text-xs text-slate-500 mt-1">{a.message}</p>}
                <p className="text-xs text-slate-400 mt-1">
                  {a.occurrences} lần · gần nhất {formatTime(a.last_seen)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter bar */}
      {days.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Tìm dự án / tài khoản…"
              className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-md text-slate-700 w-56"
            />
          </div>
          <select value={netFilter} onChange={e => setNetFilter(e.target.value)}
            className="border border-slate-200 rounded-md px-2 py-1.5 text-sm text-slate-700">
            <option value="">Tất cả network</option>
            {networkIds.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          {(search || netFilter) && (
            <span className="text-xs text-slate-400">{filtered.length}/{groups.length} tài khoản</span>
          )}
        </div>
      )}

      {/* Doanh thu theo account (revenue_raw) */}
      {loading ? (
        <TableSkeleton rows={4} cols={6} />
      ) : days.length === 0 ? (
        <EmptyState message='Chưa có dữ liệu. Sang tab "Tài khoản & Đồng bộ" để kết nối và đồng bộ.' />
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left">
                <th className="px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Dự án</th>
                <th className="px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Tài khoản</th>
                <th className="px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Khoảng ngày</th>
                <th className="px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide text-right">Tổng gốc</th>
                <th className="px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide text-right">Tổng USD</th>
                <th className="px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide text-right">Cập nhật</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <EmptyState colSpan={6} message="Không khớp bộ lọc." />
              ) : filtered.map(g => {
                const open = expanded.has(g.key)
                return [
                  <tr key={g.key} onClick={() => toggle(g.key)} className="cursor-pointer hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-1.5 font-medium text-slate-800">
                        <ChevronRight size={14} className={cn('text-slate-400 shrink-0 transition-transform', open && 'rotate-90')} />
                        {g.projectName}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {g.accountLabel} <span className="text-xs text-slate-400">({g.networkId})</span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-500 whitespace-nowrap">
                      {g.minDate} → {g.maxDate} · {g.rows.length} ngày
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-700 text-right whitespace-nowrap">{fmtNum(g.totalRaw)} {g.currency}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <div className="font-mono text-sm font-semibold text-slate-800">{fmtUsd(g.totalUsd)}</div>
                      {g.totalUsdConfirmed != null && g.totalUsdConfirmed > 0 && (
                        <div className="font-mono text-[11px] text-slate-400" title="Tiền thực nhận (payout/confirmed) — KHÔNG cộng vào TỔNG (tổng chỉ tính pending/tiền màn hình)">
                          +{fmtUsd(g.totalUsdConfirmed)} payout
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-400 text-right whitespace-nowrap">{formatTime(g.lastFetched)}</td>
                  </tr>,
                  open && (
                    <tr key={`${g.key}-detail`}>
                      <td colSpan={6} className="p-0 bg-slate-50/40 border-t border-slate-100">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left">
                              <th className="pl-10 pr-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Ngày</th>
                              <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide text-right">Doanh thu (gốc)</th>
                              <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide text-right">USD</th>
                              <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide text-right">Số dòng</th>
                              <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide text-right">Cập nhật</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {g.rows.map(d => (
                              <tr key={d.date}>
                                <td className="pl-10 pr-3 py-2 text-slate-700 font-mono text-xs whitespace-nowrap">{d.date}</td>
                                <td className="px-3 py-2 text-slate-700 font-mono text-xs text-right whitespace-nowrap">{fmtNum(d.revenue)} {d.currency}</td>
                                <td className="px-3 py-2 text-slate-700 font-mono text-xs text-right whitespace-nowrap">{fmtUsd(d.revenue_usd)}</td>
                                <td className="px-3 py-2 text-slate-500 font-mono text-xs text-right">{d.rows}</td>
                                <td className="px-3 py-2 text-slate-400 font-mono text-xs text-right whitespace-nowrap">{formatTime(d.last_fetched)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Lịch sử chạy — ít dùng, mặc định đóng */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <button
          onClick={() => setShowRuns(v => !v)}
          className="w-full bg-slate-50 px-4 py-3 flex items-center gap-2 hover:bg-slate-100 transition-colors"
        >
          <Clock size={14} className="text-slate-400" />
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Lịch sử chạy (50 gần nhất)</p>
          <ChevronDown size={14} className={cn('text-slate-400 ml-auto transition-transform', showRuns && 'rotate-180')} />
        </button>
        {showRuns && (
          <div className="p-4 border-t border-slate-200">
            {runs.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-400">Chưa có lần chạy nào.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="pb-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Thời gian</th>
                      <th className="pb-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Network</th>
                      <th className="pb-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Dòng</th>
                      <th className="pb-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {runs.map(r => {
                      const isBd = r.kind === 'breakdown'
                      const rows = isBd ? (r.breakdown_upserted ?? 0) : r.records_upserted
                      return (
                      <tr key={r.id}>
                        <td className="py-2.5 text-slate-600 font-mono text-xs whitespace-nowrap">{formatTime(r.started_at)}</td>
                        <td className="py-2.5 text-slate-700">
                          {r.network_id}
                          {isBd && <StatusPill tone="indigo" className="ml-1.5">tối ưu</StatusPill>}
                        </td>
                        <td className="py-2.5 text-slate-500 font-mono text-xs">{rows > 0 ? rows : '—'}</td>
                        <td className="py-2.5">
                          {r.status === 'success' ? (
                            <StatusPill tone="green" icon={CheckCircle}>Thành công</StatusPill>
                          ) : r.status === 'running' ? (
                            <StatusPill tone="slate" icon={Loader2} spin>Đang chạy</StatusPill>
                          ) : (
                            <span title={r.error_message ?? ''}>
                              <StatusPill tone="red" icon={XCircle}>{ERROR_LABEL[r.error_type ?? ''] ?? 'Lỗi'}</StatusPill>
                            </span>
                          )}
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
