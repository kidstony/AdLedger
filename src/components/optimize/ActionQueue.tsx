'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp, Clock3, RefreshCw, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import SuggestionCard from './SuggestionCard'
import type { PersistedSuggestion } from '@/lib/optimizer/persisted'

// ─────────────────────────────────────────────────────────────────────────────
// Hàng đợi hành động (Optimizer v2): đề xuất persist từ engine, có vòng đời.
//   Đề xuất mới → bấm "Đã áp dụng" (hẹn ngày đo kết quả) hoặc "Bỏ qua".
//   Đang đo → đếm ngược tới ngày chấm. Kết luận → badge ĐÚNG/SAI/không rõ.
// Badge độ tin cậy: "rule này đúng X/Y lần" từ outcome thật của chính bạn.
// ─────────────────────────────────────────────────────────────────────────────

interface ActionsResponse {
  open: PersistedSuggestion[]
  measuring: PersistedSuggestion[]
  concluded: PersistedSuggestion[]
  dismissed: PersistedSuggestion[]
  reliability: Record<string, { won: number; lost: number; reliability: number }>
  lastRunAt: string | null
  error?: string
}

const METRIC_VI: Record<string, string> = {
  cpc: 'giá click', ctr: 'tỷ lệ bấm', roi: 'lãi/lỗ',
  revenue_screen: 'doanh thu', spend: 'chi phí', profit: 'lợi nhuận',
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session ? { Authorization: `Bearer ${session.access_token}` } : {}
}

export default function ActionQueue({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [data, setData] = useState<ActionsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [showDismissed, setShowDismissed] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const load = useCallback(() => setRefreshKey(k => k + 1), [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/optimize/actions?project_id=${encodeURIComponent(projectId)}`, { headers: await authHeaders() })
        const json: ActionsResponse = await res.json()
        if (cancelled) return
        if (res.ok) setData(json)
        else toast.error(json.error ?? 'Không tải được hàng đợi hành động')
      } catch {
        if (!cancelled) toast.error('Không tải được hàng đợi hành động')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [projectId, refreshKey])

  const patch = async (id: string, action: 'applied' | 'dismissed' | 'reopen', note?: string) => {
    try {
      const res = await fetch(`/api/optimize/suggestions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ action, note }),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'Lỗi'); return }
      if (action === 'applied') {
        toast.success(json.evaluate_after
          ? `Đã ghi nhận. Hệ thống sẽ tự chấm kết quả sau ngày ${json.evaluate_after}.`
          : 'Đã ghi nhận.')
      } else if (action === 'dismissed') {
        toast.success('Đã bỏ qua — sẽ không nhắc lại trong thời gian tới.')
      } else {
        toast.success('Đã mở lại đề xuất.')
      }
      load()
    } catch {
      toast.error('Lỗi kết nối')
    }
  }

  const reanalyze = async () => {
    setAnalyzing(true)
    try {
      const res = await fetch('/api/optimize/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({}),
      })
      if (res.ok) { toast.success('Đã phân tích lại xong.'); load() }
      else toast.error('Phân tích thất bại')
    } catch {
      toast.error('Lỗi kết nối')
    } finally {
      setAnalyzing(false)
    }
  }

  const relBadge = (s: PersistedSuggestion) => {
    const r = s.ruleKey ? data?.reliability?.[s.ruleKey] : undefined
    if (!r || r.won + r.lost < 2) return null
    return (
      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700 ring-1 ring-indigo-200"
        title="Tính từ kết quả đo thật của các lần bạn áp dụng loại đề xuất này trước đây">
        Loại đề xuất này đúng {r.won}/{r.won + r.lost} lần
      </span>
    )
  }

  const outcomeBadge = (s: PersistedSuggestion) => {
    const verdict = (s.outcome as { verdict?: string } | null)?.verdict ?? s.state
    const metric = (s.outcome as { metric?: string } | null)?.metric
    const deltaPct = (s.outcome as { delta_pct?: number | null } | null)?.delta_pct
    const metricVi = metric ? METRIC_VI[metric] ?? metric : ''
    if (verdict === 'won') return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 ring-1 ring-green-200">
        <CheckCircle2 size={12} /> ĐÚNG{deltaPct != null ? ` — ${metricVi} cải thiện ${Math.abs(deltaPct).toFixed(0)}%` : ''}
      </span>
    )
    if (verdict === 'lost') return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-red-200">
        <XCircle size={12} /> SAI{deltaPct != null ? ` — ${metricVi} xấu đi ${Math.abs(deltaPct).toFixed(0)}%` : ''}
      </span>
    )
    if (verdict === 'confounded') return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200"
        title="Bạn áp nhiều thay đổi cùng lúc trên camp này nên không tách được thay đổi nào tạo kết quả">
        Không tách được (áp nhiều thứ cùng lúc)
      </span>
    )
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
        Chưa rõ kết quả
      </span>
    )
  }

  if (!data && loading) {
    return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Đang tải hàng đợi hành động…</div>
  }
  if (!data) return null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          {data.lastRunAt
            ? <>Phân tích lần cuối: {new Date(data.lastRunAt).toLocaleString('vi-VN')}</>
            : 'Chưa chạy phân tích nền lần nào — bấm "Phân tích lại" để chạy ngay.'}
        </p>
        {canManage && (
          <button
            onClick={reanalyze}
            disabled={analyzing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={13} className={cn(analyzing && 'animate-spin')} />
            {analyzing ? 'Đang phân tích…' : 'Phân tích lại'}
          </button>
        )}
      </div>

      {/* Đề xuất mới */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">
          Đề xuất mới {data.open.length > 0 && <span className="text-slate-400">({data.open.length})</span>}
        </h3>
        {data.open.length === 0 ? (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-5 text-center text-sm text-green-700">
            Không có đề xuất mới — camp đang ổn. 🎉
          </div>
        ) : (
          <div className="space-y-2.5">
            {data.open.map(s => (
              <div key={s.id}>
                <SuggestionCard s={s} />
                <div className="-mt-1 flex flex-wrap items-center gap-2 rounded-b-xl border border-t-0 border-slate-200 bg-slate-50 px-4 py-2">
                  {relBadge(s)}
                  <span className="flex-1" />
                  <button
                    onClick={() => patch(s.id, 'applied')}
                    className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                    title="Bạn đã làm theo đề xuất này trong Google Ads — hệ thống sẽ tự đo kết quả sau ~1 tuần"
                  >
                    ✓ Đã áp dụng
                  </button>
                  <button
                    onClick={() => {
                      const note = window.prompt('Lý do bỏ qua (không bắt buộc):') ?? undefined
                      patch(s.id, 'dismissed', note)
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                  >
                    Bỏ qua
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Đang đo kết quả */}
      {data.measuring.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">
            Đã áp dụng — đang đo kết quả <span className="text-slate-400">({data.measuring.length})</span>
          </h3>
          <div className="space-y-2.5">
            {data.measuring.map(s => (
              <div key={s.id}>
                <SuggestionCard s={s} />
                <div className="-mt-1 flex flex-wrap items-center gap-2 rounded-b-xl border border-t-0 border-slate-200 bg-blue-50/50 px-4 py-2 text-xs text-blue-700">
                  <Clock3 size={13} />
                  {s.evaluateAfter
                    ? <>Áp dụng ngày {s.appliedAt?.slice(0, 10)} — hệ thống tự chấm kết quả sau ngày <b>{s.evaluateAfter}</b> (so sánh {METRIC_VI[(s.outcome as { metric?: string } | null)?.metric ?? ''] ?? 'chỉ số'} tuần trước / tuần sau).</>
                    : <>Đã ghi nhận áp dụng ngày {s.appliedAt?.slice(0, 10)}.</>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Kết luận gần đây */}
      {data.concluded.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">
            Kết luận gần đây <span className="text-slate-400">({data.concluded.length})</span>
          </h3>
          <div className="space-y-1.5">
            {data.concluded.map(s => (
              <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                {outcomeBadge(s)}
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700" title={s.title}>{s.title}</span>
                <span className="text-[11px] text-slate-400">{s.appliedAt?.slice(0, 10)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Đã bỏ qua (thu gọn) */}
      {data.dismissed.length > 0 && (
        <section>
          <button
            onClick={() => setShowDismissed(v => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
          >
            {showDismissed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Đã bỏ qua / hết hiệu lực ({data.dismissed.length})
          </button>
          {showDismissed && (
            <div className="mt-2 space-y-1.5">
              {data.dismissed.map(s => (
                <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                    {s.state === 'dismissed' ? 'Bỏ qua' : 'Hết hiệu lực'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-500" title={s.title}>{s.title}</span>
                  {s.state === 'dismissed' && (
                    <button onClick={() => patch(s.id, 'reopen')} className="text-[11px] font-medium text-slate-500 underline hover:text-slate-700">
                      Mở lại
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
