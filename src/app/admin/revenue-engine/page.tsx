'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle, XCircle, Loader2, RefreshCw, AlertTriangle, Database, Clock, ChevronRight } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import AccountsManager from './AccountsManager'

interface EngineRun {
  id: string
  network_id: string
  status: 'running' | 'success' | 'failed'
  date_from: string | null
  date_to: string | null
  records_captured: number
  records_mapped: number
  records_upserted: number
  error_type: string | null
  error_message: string | null
  started_at: string
  finished_at: string | null
}

interface EngineAlert {
  id: string
  network_id: string
  error_type: string
  message: string | null
  occurrences: number
  first_seen: string
  last_seen: string
}

interface DayRow {
  project_id: string | null
  project_name: string
  network_id: string
  account_id: string
  account_label: string
  date: string
  revenue: number
  revenue_usd: number | null
  currency: string
  rows: number
  last_fetched: string
}

const ERROR_LABEL: Record<string, string> = {
  NO_CAPTURE: 'Mất phiên / đổi endpoint',
  MAPPING_FAILED: 'Sai cấu trúc dữ liệu',
  DB_ERROR: 'Lỗi ghi DB',
}

function fmtNum(n: number) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
function fmtUsd(n: number | null) {
  return n == null ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
// Tổng USD: null nếu không dòng nào có USD; ngược lại cộng các dòng có số.
function sumUsd(rows: { revenue_usd: number | null }[]) {
  return rows.some(r => r.revenue_usd != null)
    ? rows.reduce((a, r) => a + (r.revenue_usd ?? 0), 0)
    : null
}

function formatTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export default function RevenueEnginePage() {
  const { role } = useAuth()
  const router = useRouter()
  const [runs, setRuns] = useState<EngineRun[]>([])
  const [alerts, setAlerts] = useState<EngineAlert[]>([])
  const [days, setDays] = useState<DayRow[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<'monitor' | 'accounts'>('monitor')

  const toggle = (key: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  useEffect(() => {
    if (role && role !== 'super_admin' && role !== 'manager') router.replace('/dashboard')
  }, [role, router])

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/admin/revenue-engine', {
      headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
    })
    if (res.ok) {
      const d = await res.json()
      setRuns(d.runs ?? [])
      setAlerts(d.alerts ?? [])
      setDays(d.days ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  if (role !== 'super_admin' && role !== 'manager') return null

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <Database size={18} className="text-indigo-500" />
            <h2 className="text-xl font-semibold text-slate-800">Quản lý Doanh thu Engine</h2>
          </div>
          <p className="text-sm text-slate-500">Theo dõi doanh thu và quản lý tài khoản lấy dữ liệu từ các network</p>
        </div>
        {tab === 'monitor' && (
          <button onClick={load} className="p-2 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-500 transition-colors" title="Làm mới">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {([['monitor', 'Theo dõi'], ['accounts', 'Tài khoản & Dự án']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === key ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'accounts' && <AccountsManager />}

      {tab === 'monitor' && (<>
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
                  <span className="font-medium text-slate-800">{a.network_id}</span>
                  <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-md font-medium shrink-0">
                    {ERROR_LABEL[a.error_type] ?? a.error_type}
                  </span>
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

      {/* Doanh thu theo ngày */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Doanh thu theo ngày (revenue_raw)</p>
        </div>
        <div className="p-4">
          {loading ? (
            <div className="py-8 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Đang tải...
            </div>
          ) : days.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">Chưa có dữ liệu. Chạy engine để bắt đầu.</div>
          ) : (
            <div className="space-y-3">
              {[...new Map(days.map(d => [`${d.project_id ?? '∅'}`, d])).entries()].map(([projKey, first]) => {
                const projRows = days.filter(d => `${d.project_id ?? '∅'}` === projKey)
                const projOpen = expanded.has(`proj:${projKey}`)
                const projUsd = sumUsd(projRows)
                const accountIds = [...new Set(projRows.map(d => d.account_id))]
                return (
                  <div key={projKey} className="border border-slate-200 rounded-lg overflow-hidden">
                    {/* Tầng 1: Dự án */}
                    <button
                      onClick={() => toggle(`proj:${projKey}`)}
                      className="w-full flex items-center gap-3 px-3 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                    >
                      <ChevronRight size={16} className={`text-slate-400 shrink-0 transition-transform ${projOpen ? 'rotate-90' : ''}`} />
                      <span className="font-semibold text-slate-800">{first.project_name}</span>
                      <span className="text-xs text-slate-400">{accountIds.length} tài khoản</span>
                      <span className="ml-auto font-mono text-sm font-semibold text-slate-800 shrink-0">{fmtUsd(projUsd)}</span>
                    </button>

                    {/* Tầng 2: Tài khoản trong dự án */}
                    {projOpen && (
                      <div className="divide-y divide-slate-100 border-t border-slate-200">
                        {accountIds.map(accId => {
                          const rows = projRows.filter(d => d.account_id === accId)
                          const accKey = `acc:${projKey}|${accId}`
                          const accOpen = expanded.has(accKey)
                          const currency = rows[0]?.currency ?? ''
                          const totalRaw = rows.reduce((a, r) => a + r.revenue, 0)
                          const totalUsd = sumUsd(rows)
                          const maxDate = rows[0]?.date ?? ''
                          const minDate = rows[rows.length - 1]?.date ?? ''
                          return (
                            <div key={accId}>
                              <button
                                onClick={() => toggle(accKey)}
                                className="w-full flex items-center gap-3 pl-8 pr-3 py-2.5 bg-white hover:bg-slate-50 transition-colors text-left"
                              >
                                <ChevronRight size={14} className={`text-slate-300 shrink-0 transition-transform ${accOpen ? 'rotate-90' : ''}`} />
                                <span className="font-medium text-slate-700">{rows[0]?.account_label ?? accId}</span>
                                <span className="text-xs text-slate-400 font-mono">{minDate} → {maxDate} · {rows.length} ngày</span>
                                <span className="ml-auto text-right shrink-0">
                                  <span className="font-mono text-sm font-semibold text-slate-800">{fmtUsd(totalUsd)}</span>
                                  <span className="block text-xs text-slate-400 font-mono">{fmtNum(totalRaw)} {currency}</span>
                                </span>
                              </button>
                              {accOpen && (
                                <div className="overflow-x-auto border-t border-slate-100 bg-slate-50/40">
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="text-left">
                                        <th className="pl-8 pr-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Ngày</th>
                                        <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide text-right">Doanh thu (gốc)</th>
                                        <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide text-right">USD</th>
                                        <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide text-right">Số dòng</th>
                                        <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide text-right">Cập nhật</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {rows.map(d => (
                                        <tr key={d.date}>
                                          <td className="pl-8 pr-3 py-2 text-slate-700 font-mono text-xs whitespace-nowrap">{d.date}</td>
                                          <td className="px-3 py-2 text-slate-700 font-mono text-xs text-right whitespace-nowrap">{fmtNum(d.revenue)} {d.currency}</td>
                                          <td className="px-3 py-2 text-slate-700 font-mono text-xs text-right whitespace-nowrap">{fmtUsd(d.revenue_usd)}</td>
                                          <td className="px-3 py-2 text-slate-500 font-mono text-xs text-right">{d.rows}</td>
                                          <td className="px-3 py-2 text-slate-400 font-mono text-xs text-right whitespace-nowrap">{formatTime(d.last_fetched)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot>
                                      <tr className="border-t border-slate-200 bg-slate-100 font-medium">
                                        <td className="pl-8 pr-3 py-2 text-xs text-slate-600 uppercase tracking-wide">Tổng</td>
                                        <td className="px-3 py-2 text-slate-800 font-mono text-xs text-right whitespace-nowrap">{fmtNum(totalRaw)} {currency}</td>
                                        <td className="px-3 py-2 text-slate-800 font-mono text-xs text-right whitespace-nowrap">{fmtUsd(totalUsd)}</td>
                                        <td className="px-3 py-2"></td>
                                        <td className="px-3 py-2"></td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Lịch sử chạy */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center gap-2">
          <Clock size={14} className="text-slate-400" />
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Lịch sử chạy (50 gần nhất)</p>
        </div>
        <div className="p-4">
          {loading ? (
            <div className="py-8 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Đang tải...
            </div>
          ) : runs.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">Chưa có lần chạy nào.</div>
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
                  {runs.map(r => (
                    <tr key={r.id}>
                      <td className="py-2.5 text-slate-600 font-mono text-xs whitespace-nowrap">{formatTime(r.started_at)}</td>
                      <td className="py-2.5 text-slate-700">{r.network_id}</td>
                      <td className="py-2.5 text-slate-500 font-mono text-xs">{r.records_upserted > 0 ? r.records_upserted : '—'}</td>
                      <td className="py-2.5">
                        {r.status === 'success' ? (
                          <span className="flex items-center gap-1 text-green-600 text-xs font-medium"><CheckCircle size={12} /> Thành công</span>
                        ) : r.status === 'running' ? (
                          <span className="flex items-center gap-1 text-slate-500 text-xs font-medium"><Loader2 size={12} className="animate-spin" /> Đang chạy</span>
                        ) : (
                          <span className="flex items-center gap-1 text-red-600 text-xs font-medium" title={r.error_message ?? ''}>
                            <XCircle size={12} /> {ERROR_LABEL[r.error_type ?? ''] ?? 'Lỗi'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      </>)}
    </div>
  )
}
