'use client'

import { useEffect, useMemo, useState } from 'react'
import { Gauge, Info, RefreshCw } from 'lucide-react'
import { useProjectsContext } from '@/context/ProjectsContext'
import { useDateRange } from '@/context/DateRangeContext'
import { supabase } from '@/lib/supabase'
import { formatCid } from '@/lib/utils'
import DateRangePicker from '@/components/ui/DateRangePicker'
import HealthScorecard from '@/components/optimize/HealthScorecard'
import SuggestionCard from '@/components/optimize/SuggestionCard'
import type { CampaignHealth, OptimizationSuggestion } from '@/lib/types'

interface OptimizeResponse {
  project: { project_id: string; name: string; cid: string; campaign_id: string }
  range: { from: string; to: string }
  cost: { spend: number; rental: number; other: number; total: number }
  hasMetrics: boolean
  health: CampaignHealth
  suggestions: OptimizationSuggestion[]
  hasConversionTracking: boolean
  error?: string
  code?: string
}

export default function OptimizePage() {
  const { projects } = useProjectsContext()
  const { fromStr, toStr, setDateRange } = useDateRange()

  // Chỉ những project đã gắn Google campaign mới phân tích được.
  const eligible = useMemo(
    () => projects.filter(p => p.google_campaign_id).sort((a, b) => a.name.localeCompare(b.name)),
    [projects],
  )

  const [projectId, setProjectId] = useState('')
  const [data, setData] = useState<OptimizeResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Không setState trong effect để chọn mặc định — dẫn xuất trực tiếp.
  const selectedId = projectId || eligible[0]?.project_id || ''

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    const run = async () => {
      setLoading(true); setError(null)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const url = `/api/optimize?project_id=${encodeURIComponent(selectedId)}&from=${fromStr}&to=${toStr}`
        const res: OptimizeResponse = await fetch(url, {
          headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
        }).then(r => r.json())
        if (cancelled) return
        if (res.error) { setError(res.error); setData(null) }
        else setData(res)
      } catch {
        if (!cancelled) setError('Không tải được dữ liệu')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [selectedId, fromStr, toStr])

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <header className="mb-5">
        <div className="flex items-center gap-2">
          <Gauge className="text-slate-700" size={22} />
          <h1 className="text-xl font-bold text-slate-800">Tối Ưu Camp</h1>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Phân tích số liệu Google Ads + doanh thu affiliate thật để đề xuất hướng tối ưu camp.
        </p>
      </header>

      {/* Bộ chọn */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <select
          value={selectedId}
          onChange={e => setProjectId(e.target.value)}
          className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-slate-400 focus:outline-none"
        >
          {eligible.length === 0 && <option value="">— Chưa có camp nào gắn campaign —</option>}
          {eligible.map(p => (
            <option key={p.project_id} value={p.project_id}>
              {p.name} · {formatCid(p.cid)}
            </option>
          ))}
        </select>
        <DateRangePicker
          from={fromStr}
          to={toStr}
          onApply={(f, t) => setDateRange({ from: new Date(f + 'T00:00:00Z'), to: new Date(t + 'T00:00:00Z') })}
        />
        {loading && <RefreshCw size={16} className="animate-spin text-slate-400" />}
      </div>

      {/* Trạng thái */}
      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      {!error && data && !data.hasMetrics && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <Info className="mx-auto mb-2 text-slate-400" size={22} />
          <p className="text-sm font-medium text-slate-700">Chưa có số liệu hiệu suất cho camp này</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
            Cần chạy bản Google Ads Script mới (đã bổ sung <code className="rounded bg-slate-100 px-1">campaign_metrics</code>)
            để đồng bộ impressions/clicks/CTR/CPC/Impression Share. Sau lần sync tiếp theo, số liệu sẽ hiển thị ở đây.
          </p>
        </div>
      )}

      {!error && data && data.hasMetrics && (
        <div className="space-y-5">
          <HealthScorecard health={data.health} cost={data.cost} />

          {!data.hasConversionTracking && (
            <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              <Info size={14} className="mt-0.5 shrink-0" />
              <span>
                Camp chưa có conversion tracking → ROI thật chỉ tính ở mức dự án × ngày. Các gợi ý
                gắn nhãn <b>&ldquo;Cần xem xét&rdquo;</b> chỉ dựa trên tín hiệu hiệu suất.
              </span>
            </div>
          )}

          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">
              Gợi ý tối ưu {data.suggestions.length > 0 && <span className="text-slate-400">({data.suggestions.length})</span>}
            </h2>
            {data.suggestions.length === 0 ? (
              <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-6 text-center text-sm text-green-700">
                Không có cảnh báo nào — camp đang ổn trong khoảng thời gian này. 🎉
              </div>
            ) : (
              <div className="space-y-2.5">
                {data.suggestions.map(s => <SuggestionCard key={s.id} s={s} />)}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
