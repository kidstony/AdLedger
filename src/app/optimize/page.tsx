'use client'

import { useEffect, useMemo, useState } from 'react'
import { Gauge, Info, RefreshCw } from 'lucide-react'
import { useProjectsContext } from '@/context/ProjectsContext'
import { useDateRange } from '@/context/DateRangeContext'
import { supabase } from '@/lib/supabase'
import { cn, formatCid, formatVND } from '@/lib/utils'
import DateRangePicker from '@/components/ui/DateRangePicker'
import HealthScorecard from '@/components/optimize/HealthScorecard'
import SuggestionCard from '@/components/optimize/SuggestionCard'
import BreakdownTables from '@/components/optimize/BreakdownTables'
import PortfolioTable, { type OverviewRow } from '@/components/optimize/PortfolioTable'
import WinDayPanel from '@/components/optimize/WinDayPanel'
import LaunchChecklist from '@/components/optimize/LaunchChecklist'
import NextSteps from '@/components/optimize/NextSteps'
import type { CampaignHealth, CampaignSettings, KeywordAgg, LaunchPlan, OptimizationSuggestion, SearchTermAgg, SegmentAgg, WinDayAnalysis } from '@/lib/types'

interface OptimizeResponse {
  project: { project_id: string; name: string; cid: string; campaign_id: string }
  range: { from: string; to: string }
  cost: { spend: number; rental: number; other: number; total: number }
  revenue: { screen: number; confirmed: number }
  settings: CampaignSettings | null
  hasMetrics: boolean
  health: CampaignHealth
  suggestions: OptimizationSuggestion[]
  hasConversionTracking: boolean
  estimatedSavings: number
  dataMaturity: 'young' | 'ok'
  winDayAnalysis: WinDayAnalysis | null
  launchPlan: LaunchPlan | null
  breakdowns: { keywords: KeywordAgg[]; searchTerms: SearchTermAgg[]; segments: SegmentAgg[] }
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

  const [mode, setMode] = useState<'overview' | 'detail'>('overview')
  const [projectId, setProjectId] = useState('')
  const [data, setData] = useState<OptimizeResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overview, setOverview] = useState<OverviewRow[] | null>(null)
  const [ovLoading, setOvLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  // Không setState trong effect để chọn mặc định — dẫn xuất trực tiếp.
  const selectedId = projectId || eligible[0]?.project_id || ''

  const authFetch = async (url: string) => {
    const { data: { session } } = await supabase.auth.getSession()
    return fetch(url, { headers: session ? { Authorization: `Bearer ${session.access_token}` } : {} }).then(r => r.json())
  }

  // Chi tiết 1 camp (chế độ detail).
  useEffect(() => {
    if (mode !== 'detail' || !selectedId) return
    let cancelled = false
    const run = async () => {
      setLoading(true); setError(null)
      try {
        const res: OptimizeResponse = await authFetch(`/api/optimize?project_id=${encodeURIComponent(selectedId)}&from=${fromStr}&to=${toStr}`)
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
  }, [mode, selectedId, fromStr, toStr, refreshKey])

  // Bảng tổng quan (chế độ overview).
  useEffect(() => {
    if (mode !== 'overview') return
    let cancelled = false
    const run = async () => {
      setOvLoading(true)
      try {
        const res = await authFetch(`/api/optimize/overview?from=${fromStr}&to=${toStr}`)
        if (!cancelled) setOverview(Array.isArray(res.rows) ? res.rows : [])
      } catch {
        if (!cancelled) setOverview([])
      } finally {
        if (!cancelled) setOvLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [mode, fromStr, toStr])

  const openDetail = (pid: string) => { setProjectId(pid); setMode('detail') }

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <header className="mb-5">
        <div className="flex items-center gap-2">
          <Gauge className="text-slate-700" size={22} />
          <h1 className="text-xl font-bold text-slate-800">Tối Ưu Camp</h1>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Phân tích số liệu Google Ads + <b>DT Màn hình</b> (tín hiệu doanh thu sớm) để đề xuất hướng tối ưu camp.
        </p>
      </header>

      {/* Tab + bộ chọn */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
          {(['overview', 'detail'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn('rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                mode === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
            >
              {m === 'overview' ? 'Tổng quan' : 'Chi tiết camp'}
            </button>
          ))}
        </div>
        {mode === 'detail' && (
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
        )}
        <DateRangePicker
          from={fromStr}
          to={toStr}
          onApply={(f, t) => setDateRange({ from: new Date(f + 'T00:00:00Z'), to: new Date(t + 'T00:00:00Z') })}
        />
        {(loading || ovLoading) && <RefreshCw size={16} className="animate-spin text-slate-400" />}
      </div>

      {/* Chế độ Tổng quan */}
      {mode === 'overview' && (
        overview
          ? <PortfolioTable rows={overview} onSelect={openDetail} />
          : <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Đang tải...</div>
      )}

      {/* Chế độ Chi tiết */}
      {mode === 'detail' && <>
      {/* Trạng thái */}
      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      {/* Lộ trình test camp mới — hiện cả khi CHƯA có metrics (lúc cần nhất) */}
      {!error && data && data.launchPlan && (
        <div className="mb-5">
          <LaunchChecklist plan={data.launchPlan} projectId={selectedId} onSaved={() => setRefreshKey(k => k + 1)} />
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
          <HealthScorecard health={data.health} cost={data.cost} confirmedRevenue={data.revenue.confirmed} settings={data.settings} />

          <NextSteps suggestions={data.suggestions} />

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
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-700">
                Kế hoạch hành động {data.suggestions.length > 0 && <span className="text-slate-400">({data.suggestions.length})</span>}
              </h2>
              {data.estimatedSavings >= 0.5 && (
                <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 ring-1 ring-green-200">
                  Ước tính tiết kiệm ~{formatVND(data.estimatedSavings)}/kỳ nếu chặn search-term rác
                </span>
              )}
            </div>
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

          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Phân tích ngày lãi / ngày lỗ</h2>
            <WinDayPanel analysis={data.winDayAnalysis} />
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Chi tiết keyword, search term &amp; phân khúc</h2>
            <BreakdownTables keywords={data.breakdowns.keywords} searchTerms={data.breakdowns.searchTerms} segments={data.breakdowns.segments} />
          </section>
        </div>
      )}
      </>}
    </div>
  )
}
