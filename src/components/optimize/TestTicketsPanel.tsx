'use client'

import { useCallback, useEffect, useState } from 'react'
import { FlaskConical, Link2, Square } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { cn, formatVND } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// Phiếu test (Optimizer v2): engine tự sinh khi thấy đột biến cơ hội (nước hot,
// offer hot, giả thuyết từ ngày lãi). Bạn duyệt → tạo camp trên Google Ads,
// ĐẶT MÃ PHIẾU (vd T-0042) vào tên camp → hệ thống tự gắn và tự chấm mỗi ngày,
// chạm stop-loss thì báo dừng, đủ ngày thì kết luận thắng/thua.
// ─────────────────────────────────────────────────────────────────────────────

interface Ticket {
  id: string
  ticket_code: string
  state: string
  source: string
  hypothesis: string
  target: { geo?: string; geoLabel?: string; device?: string; offer?: string; notes?: string } | null
  test_budget: number
  max_days: number
  min_clicks: number
  success_criteria: { threshold?: number; min_revenue?: number } | null
  stoploss: { max_spend_no_revenue?: number } | null
  test_campaign_id: string | null
  started_at: string | null
  daily_log: { date: string; spend: number; revenue: number; clicks: number; roi: number | null }[]
  conclusion: { verdict?: string; reason?: string; roi?: number | null; spend?: number; revenue?: number } | null
  created_at: string
}

const STATE_VI: Record<string, { label: string; cls: string }> = {
  proposed:      { label: 'Chờ bạn duyệt', cls: 'bg-amber-100 text-amber-700' },
  accepted:      { label: 'Đã duyệt', cls: 'bg-blue-100 text-blue-700' },
  awaiting_camp: { label: 'Chờ gắn camp', cls: 'bg-blue-100 text-blue-700' },
  running:       { label: 'Đang chạy', cls: 'bg-indigo-100 text-indigo-700' },
  won:           { label: 'THẮNG ✅', cls: 'bg-green-100 text-green-700' },
  lost:          { label: 'Thua', cls: 'bg-red-100 text-red-700' },
  stopped:       { label: 'Dừng (stop-loss)', cls: 'bg-red-100 text-red-700' },
  abandoned:     { label: 'Đã bỏ', cls: 'bg-slate-100 text-slate-500' },
  expired:       { label: 'Hết hạn', cls: 'bg-slate-100 text-slate-500' },
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session ? { Authorization: `Bearer ${session.access_token}` } : {}
}

export default function TestTicketsPanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [budgetDraft, setBudgetDraft] = useState<Record<string, string>>({})
  const [linkDraft, setLinkDraft] = useState<Record<string, string>>({})

  const [refreshKey, setRefreshKey] = useState(0)
  const load = useCallback(() => setRefreshKey(k => k + 1), [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch(`/api/optimize/tests?project_id=${encodeURIComponent(projectId)}&all=1`, { headers: await authHeaders() })
        const json = await res.json()
        if (cancelled) return
        if (res.ok) setTickets(json.tickets ?? [])
        else toast.error(json.error ?? 'Không tải được phiếu test')
      } catch {
        if (!cancelled) toast.error('Không tải được phiếu test')
      }
    }
    run()
    return () => { cancelled = true }
  }, [projectId, refreshKey])

  const patch = async (id: string, body: Record<string, unknown>, okMsg: string) => {
    try {
      const res = await fetch(`/api/optimize/tests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'Lỗi'); return }
      toast.success(okMsg)
      load()
    } catch {
      toast.error('Lỗi kết nối')
    }
  }

  if (tickets == null) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">Đang tải phiếu test…</div>
  }

  const active = tickets.filter(t => ['proposed', 'accepted', 'awaiting_camp', 'running'].includes(t.state))
  const done = tickets.filter(t => !['proposed', 'accepted', 'awaiting_camp', 'running'].includes(t.state)).slice(0, 5)

  if (!active.length && !done.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
        <FlaskConical className="mx-auto mb-2 text-slate-300" size={20} />
        <p className="text-sm text-slate-500">Chưa có phiếu test nào.</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
          Khi hệ thống thấy đột biến đáng thử (một nước tự nhiên ra nhiều tiền, offer mới ăn khách…),
          nó sẽ tự tạo phiếu test ở đây kèm ngân sách, thời gian và tiêu chí thắng/thua.
        </p>
      </div>
    )
  }

  const totals = (t: Ticket) => {
    const spend = t.daily_log.reduce((s, d) => s + d.spend, 0)
    const revenue = t.daily_log.reduce((s, d) => s + d.revenue, 0)
    const clicks = t.daily_log.reduce((s, d) => s + d.clicks, 0)
    return { spend, revenue, clicks, roi: spend > 0 ? ((revenue - spend) / spend) * 100 : null, days: t.daily_log.length }
  }

  const card = (t: Ticket) => {
    const st = STATE_VI[t.state] ?? { label: t.state, cls: 'bg-slate-100 text-slate-600' }
    const tt = totals(t)
    const chips: string[] = []
    if (t.target?.geoLabel || t.target?.geo) chips.push(`Nước: ${t.target.geoLabel ?? t.target.geo}`)
    if (t.target?.device) chips.push(`Thiết bị: ${t.target.device}`)
    if (t.target?.offer) chips.push(`Offer: ${t.target.offer}`)

    return (
      <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <FlaskConical size={15} className="text-indigo-500" />
          <span className="font-mono text-xs font-bold text-slate-700">{t.ticket_code}</span>
          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', st.cls)}>{st.label}</span>
          {chips.map(c => (
            <span key={c} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{c}</span>
          ))}
          <span className="flex-1" />
          <span className="text-[11px] text-slate-400">{t.created_at.slice(0, 10)}</span>
        </div>

        <p className="mt-2 text-sm text-slate-700">{t.hypothesis}</p>
        {t.target?.notes && <p className="mt-1 text-xs text-slate-500">{t.target.notes}</p>}

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>Ngân sách test: <b className="text-slate-700">{formatVND(t.test_budget)}</b></span>
          <span>Tối đa: <b className="text-slate-700">{t.max_days} ngày</b></span>
          <span>Thắng khi: <b className="text-slate-700">ROI ≥ {t.success_criteria?.threshold ?? 20}% & DT ≥ {formatVND(t.success_criteria?.min_revenue ?? 10)}</b></span>
          <span>Stop-loss: <b className="text-slate-700">tiêu hết {formatVND(t.stoploss?.max_spend_no_revenue ?? t.test_budget)} mà không ra tiền</b></span>
        </div>

        {/* Đang chạy: tiến độ + log */}
        {t.state === 'running' && (
          <div className="mt-3 rounded-lg bg-slate-50 p-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span>Ngày <b>{tt.days}/{t.max_days}</b></span>
              <span>Đã chi <b>{formatVND(tt.spend)}</b> / {formatVND(t.test_budget)}</span>
              <span>Doanh thu <b>{formatVND(tt.revenue)}</b></span>
              <span>Click <b>{tt.clicks}</b>/{t.min_clicks}</span>
              <span className={cn('font-semibold', tt.roi != null && tt.roi >= 0 ? 'text-green-600' : 'text-red-600')}>
                ROI {tt.roi != null ? `${tt.roi.toFixed(0)}%` : '—'}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div
                className={cn('h-full rounded-full', tt.spend >= t.test_budget ? 'bg-red-500' : 'bg-indigo-500')}
                style={{ width: `${Math.min(100, (tt.spend / Math.max(1, t.test_budget)) * 100)}%` }}
              />
            </div>
            {t.daily_log.length > 0 && (
              <table className="mt-2 w-full text-[11px] text-slate-500">
                <tbody>
                  {t.daily_log.slice(-5).map(d => (
                    <tr key={d.date} className="border-t border-slate-200/70">
                      <td className="py-0.5">{d.date}</td>
                      <td className="text-right">chi {formatVND(d.spend)}</td>
                      <td className="text-right">DT {formatVND(d.revenue)}</td>
                      <td className="text-right">{d.clicks} click</td>
                      <td className={cn('text-right font-medium', (d.roi ?? 0) >= 0 ? 'text-green-600' : 'text-red-600')}>
                        {d.roi != null ? `${d.roi.toFixed(0)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Kết luận */}
        {t.conclusion?.reason && (
          <div className={cn('mt-3 rounded-lg px-3 py-2 text-xs',
            t.state === 'won' ? 'bg-green-50 text-green-700' : t.state === 'lost' || t.state === 'stopped' ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-600')}>
            {t.conclusion.reason}
          </div>
        )}

        {/* Hành động theo trạng thái */}
        {canManage && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {t.state === 'proposed' && (
              <>
                <label className="flex items-center gap-1 text-xs text-slate-500">
                  Ngân sách test ($):
                  <input
                    type="number" min={5}
                    className="h-7 w-20 rounded border border-slate-300 px-2 text-xs"
                    placeholder={String(t.test_budget)}
                    value={budgetDraft[t.id] ?? ''}
                    onChange={e => setBudgetDraft(d => ({ ...d, [t.id]: e.target.value }))}
                  />
                </label>
                <button
                  onClick={() => patch(t.id, {
                    action: 'accept',
                    ...(budgetDraft[t.id] ? { test_budget: Number(budgetDraft[t.id]) } : {}),
                  }, `Đã duyệt phiếu ${t.ticket_code}. Tạo camp trên Google Ads và đặt "${t.ticket_code}" vào tên camp để hệ thống tự gắn.`)}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
                >
                  Duyệt phiếu
                </button>
                <button
                  onClick={() => patch(t.id, { action: 'abandon' }, 'Đã bỏ phiếu.')}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  Bỏ
                </button>
              </>
            )}
            {['accepted', 'awaiting_camp'].includes(t.state) && (
              <>
                <div className="w-full rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                  Tạo camp mới trên Google Ads theo mục tiêu của phiếu, <b>đặt mã “{t.ticket_code}” vào tên camp</b> —
                  lần đồng bộ tới hệ thống sẽ tự gắn và bắt đầu theo dõi. Khuyến nghị: tạo thêm 1 dự án riêng gắn camp này để nhập doanh thu màn hình chính xác.
                </div>
                <label className="flex items-center gap-1 text-xs text-slate-500">
                  <Link2 size={12} /> Hoặc gắn tay Campaign ID:
                  <input
                    className="h-7 w-40 rounded border border-slate-300 px-2 text-xs"
                    placeholder="123456789"
                    value={linkDraft[t.id] ?? ''}
                    onChange={e => setLinkDraft(d => ({ ...d, [t.id]: e.target.value }))}
                  />
                </label>
                <button
                  onClick={() => {
                    const cid = (linkDraft[t.id] ?? '').trim()
                    if (!cid) { toast.error('Nhập Campaign ID trước'); return }
                    patch(t.id, { action: 'link', test_campaign_id: cid }, 'Đã gắn camp — bắt đầu theo dõi.')
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  Gắn camp
                </button>
                <button
                  onClick={() => patch(t.id, { action: 'abandon' }, 'Đã bỏ phiếu.')}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
                >
                  Bỏ
                </button>
              </>
            )}
            {t.state === 'running' && (
              <button
                onClick={() => {
                  if (!window.confirm(`Dừng phiếu ${t.ticket_code}? (nhớ tự pause camp test trong Google Ads)`)) return
                  patch(t.id, { action: 'stop', note: 'Dừng tay' }, 'Đã dừng phiếu. Nhớ pause camp test trong Google Ads.')
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100"
              >
                <Square size={12} /> Dừng test
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {active.map(card)}
      {done.length > 0 && (
        <>
          <h4 className="pt-1 text-xs font-semibold text-slate-500">Phiếu đã kết thúc gần đây</h4>
          {done.map(card)}
        </>
      )}
    </div>
  )
}
