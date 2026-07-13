'use client'

import { useEffect, useState } from 'react'
import { Database, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn, formatVND } from '@/lib/utils'
import { countryNameByAlpha2 } from '@/lib/geo-targets'
import StatusPill from '@/components/ui/StatusPill'

// Tab "Dữ liệu nguồn" của Tối Ưu Camp: xem dữ liệu breakdown Engine thu từ network +
// đối chiếu với DT Màn hình (P&L) để kiểm chứng dữ liệu đầy đủ/chính xác.

interface NetworkData {
  network_id: string
  account_ids: string[]
  revenue_type: 'pending' | 'confirmed'
  totalUsd: number
  rows: number
  minDate: string | null
  maxDate: string | null
  lastFetchedAt: string | null
  dims: { country: number; device: number; hour: number; subId: number }
  byDay: { date: string; breakdownUsd: number; rows: number }[]
  byCountry: { country: string; usd: number; conversions: number | null; sharePct: number }[]
  byDevice: { device: string; usd: number; sharePct: number }[]
  byHour: { hour: number; usd: number }[]
}

interface Resp {
  project: { project_id: string; name: string }
  networks: NetworkData[]
  reconciliation: {
    screenTotal: number
    breakdownTotal: number
    coveragePct: number | null
    days: { date: string; screenUsd: number; breakdownUsd: number; deltaPct: number | null }[]
  }
  error?: string
}

const DEVICE_LABEL: Record<string, string> = { mobile: 'Di động', desktop: 'Máy tính', tablet: 'Tablet', other: 'Khác' }

function Card({ title, right, children }: { title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-400 ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

// Chip độ phủ dimension: mờ + gạch khi network không có chiều đó.
function DimChip({ label, pct }: { label: string; pct: number }) {
  return (
    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium',
      pct > 0 ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-300 line-through')}>
      {label}{pct > 0 ? ` ${pct}%` : ''}
    </span>
  )
}

const hoursAgo = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 3600000 : Infinity)
const daysBehind = (date: string | null) =>
  date ? Math.floor((Date.now() - new Date(date + 'T00:00:00Z').getTime()) / 86400000) : Infinity

export default function BreakdownDataPanel({ projectId, from, to }: { projectId: string; from: string; to: string }) {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    const run = async () => {
      setLoading(true); setError(null)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch(`/api/optimize/breakdown-data?project_id=${encodeURIComponent(projectId)}&from=${from}&to=${to}`,
          { headers: session ? { Authorization: `Bearer ${session.access_token}` } : {} })
        const json: Resp = await res.json()
        if (cancelled) return
        if (!res.ok) { setError(json.error ?? 'Lỗi tải dữ liệu'); setData(null) }
        else setData(json)
      } catch {
        if (!cancelled) { setError('Lỗi tải dữ liệu'); setData(null) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [projectId, from, to])

  if (loading && !data) {
    return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
      <RefreshCw size={16} className="mx-auto mb-2 animate-spin" /> Đang tải dữ liệu nguồn...
    </div>
  }
  if (error) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div>
  }
  if (!data) return null

  if (data.networks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-8 text-center text-sm text-slate-500">
        <Database size={18} className="mx-auto mb-2 text-slate-300" />
        Chưa có dữ liệu breakdown cho dự án này trong khoảng ngày đã chọn.
        <p className="mt-1 text-xs text-slate-400">
          Cấu hình ở bảng &quot;Kết nối network&quot; phía trên: bấm <b>Dò &amp; cấu hình</b> cho network tương ứng → engine tự quét trang báo cáo chuyển đổi → Lưu → Đồng bộ.
        </p>
      </div>
    )
  }

  const rec = data.reconciliation
  const covTone = rec.coveragePct == null ? 'slate' : rec.coveragePct >= 90 ? 'green' : rec.coveragePct >= 60 ? 'amber' : 'red'

  return (
    <div className="space-y-4">
      {/* Thẻ đối chiếu tổng — kiểm chứng "đầy đủ/chính xác" so với số P&L đã tin */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-800">Đối chiếu với DT Màn hình (P&L)</h2>
          <StatusPill tone={covTone}>
            {rec.coveragePct == null ? 'Chưa có DT Màn hình để so' : `Breakdown phủ ${rec.coveragePct}%`}
          </StatusPill>
          <span className="ml-auto text-xs tabular-nums text-slate-500">
            Breakdown {formatVND(rec.breakdownTotal)} / DT Màn hình {formatVND(rec.screenTotal)}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
          DT Màn hình là số P&L do report doanh thu của network đổ về (đã đối chiếu với dashboard network).
          Breakdown lệch nhiều thường do: network chỉ trả breakdown cho chuyển đổi approved, chuyển đổi bị reject
          sau cửa sổ sync 7 ngày không được sửa lại, hoặc pagination bị cắt — ngày lệch được tô đỏ bên dưới.
        </p>
      </div>

      {/* Mỗi network 1 card */}
      {data.networks.map(net => {
        const stale = hoursAgo(net.lastFetchedAt) > 24
        const lagging = daysBehind(net.maxDate) > 2
        return (
          <Card
            key={net.network_id}
            title={<span className="flex items-center gap-2">
              {net.network_id}
              <span className="text-xs font-normal text-slate-400">{net.account_ids.join(', ')}</span>
              <StatusPill tone={net.revenue_type === 'pending' ? 'indigo' : 'green'}>
                {net.revenue_type === 'pending' ? 'tiền màn hình' : 'thực nhận'}
              </StatusPill>
            </span>}
            right={<span className="text-xs tabular-nums text-slate-500">
              {net.minDate} → {net.maxDate} · {net.rows.toLocaleString('en-US')} dòng · <b className="text-slate-800">{formatVND(net.totalUsd)}</b>
            </span>}
          >
            <div className="space-y-3 px-4 py-3">
              {(stale || lagging) && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
                  {stale && <>⚠ Lần fetch cuối đã quá 24h ({net.lastFetchedAt ? new Date(net.lastFetchedAt).toLocaleString('vi-VN') : '—'}) — kiểm tra worker/auto-sync. </>}
                  {lagging && <>⚠ Dữ liệu mới nhất là {net.maxDate} (trễ hơn 2 ngày) — network có thể chưa có chuyển đổi mới hoặc report bị lỗi.</>}
                </div>
              )}

              {/* Độ phủ dimension — mỗi network cho dữ liệu khác nhau */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-400">Độ phủ theo doanh thu:</span>
                <DimChip label="Quốc gia" pct={net.dims.country} />
                <DimChip label="Thiết bị" pct={net.dims.device} />
                <DimChip label="Giờ" pct={net.dims.hour} />
                <DimChip label="Sub-ID" pct={net.dims.subId} />
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                {/* Đối chiếu theo ngày */}
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-600">
                    Đối chiếu theo ngày (đỏ = lệch &gt;10%, vàng = thiếu breakdown)
                  </div>
                  <div className="max-h-72 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50">
                        <tr><Th>Ngày</Th><Th right>DT Màn hình</Th><Th right>Breakdown</Th><Th right>Δ</Th><Th right>Dòng</Th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {rec.days.map(d => {
                          const netDay = net.byDay.find(x => x.date === d.date)
                          const missing = d.screenUsd > 0 && d.breakdownUsd === 0
                          const off = d.deltaPct != null && Math.abs(d.deltaPct) > 10
                          return (
                            <tr key={d.date} className={missing ? 'bg-amber-50/60' : off ? 'bg-red-50/60' : ''}>
                              <td className="px-3 py-1.5 font-mono text-slate-600">{d.date}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{formatVND(d.screenUsd)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">{formatVND(d.breakdownUsd)}</td>
                              <td className={cn('px-3 py-1.5 text-right tabular-nums',
                                d.deltaPct == null ? 'text-slate-300' : Math.abs(d.deltaPct) > 10 ? 'font-semibold text-red-600' : 'text-slate-500')}>
                                {d.deltaPct == null ? '—' : `${d.deltaPct > 0 ? '+' : ''}${d.deltaPct}%`}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{netDay?.rows ?? 0}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Quốc gia + thiết bị */}
                <div className="space-y-3">
                  {net.byCountry.length > 0 && (
                    <div className="overflow-hidden rounded-lg border border-slate-200">
                      <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-600">
                        Doanh thu theo quốc gia
                      </div>
                      <div className="max-h-52 overflow-auto">
                        <table className="w-full text-xs">
                          <tbody className="divide-y divide-slate-50">
                            {net.byCountry.slice(0, 20).map(c => (
                              <tr key={c.country}>
                                <td className="px-3 py-1.5 text-slate-700">
                                  {countryNameByAlpha2(c.country)} <span className="text-[10px] text-slate-300">{c.country}</span>
                                </td>
                                <td className="w-24 px-2 py-1.5">
                                  <div className="h-1.5 rounded-full bg-slate-100">
                                    <div className="h-1.5 rounded-full bg-indigo-400" style={{ width: `${Math.min(100, c.sharePct)}%` }} />
                                  </div>
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{c.sharePct}%</td>
                                <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-slate-800">{formatVND(c.usd)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {net.byDevice.length > 0 && (
                    <div className="overflow-hidden rounded-lg border border-slate-200">
                      <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-600">
                        Doanh thu theo thiết bị
                      </div>
                      <table className="w-full text-xs">
                        <tbody className="divide-y divide-slate-50">
                          {net.byDevice.map(d => (
                            <tr key={d.device}>
                              <td className="px-3 py-1.5 text-slate-700">{DEVICE_LABEL[d.device] ?? d.device}</td>
                              <td className="w-24 px-2 py-1.5">
                                <div className="h-1.5 rounded-full bg-slate-100">
                                  <div className="h-1.5 rounded-full bg-emerald-400" style={{ width: `${Math.min(100, d.sharePct)}%` }} />
                                </div>
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{d.sharePct}%</td>
                              <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-slate-800">{formatVND(d.usd)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {net.byHour.length > 0 && (
                    <div className="rounded-lg border border-slate-200 px-3 py-2">
                      <div className="mb-1.5 text-[11px] font-medium text-slate-600">Doanh thu theo giờ (múi giờ dữ liệu nguồn)</div>
                      <div className="flex h-12 items-end gap-[2px]">
                        {Array.from({ length: 24 }, (_, h) => {
                          const usd = net.byHour.find(x => x.hour === h)?.usd ?? 0
                          const max = Math.max(...net.byHour.map(x => x.usd), 1)
                          return (
                            <div key={h} className="flex-1" title={`${h}h: ${formatVND(usd)}`}>
                              <div className="w-full rounded-t bg-sky-400/80" style={{ height: `${Math.round((usd / max) * 44)}px` }} />
                            </div>
                          )
                        })}
                      </div>
                      <div className="mt-0.5 flex justify-between text-[9px] text-slate-300"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
