'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Gauge, Info, RefreshCw } from 'lucide-react'
import { useProjectsContext } from '@/context/ProjectsContext'
import { useDateRange } from '@/context/DateRangeContext'
import { useAuth } from '@/context/AuthContext'
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
import BreakdownDataPanel from '@/components/optimize/BreakdownDataPanel'
import BreakdownNetworkManager from '@/components/optimize/BreakdownNetworkManager'
import type { BreakdownMeta, CampaignHealth, CampaignSettings, KeywordAgg, LaunchPlan, OptimizationSuggestion, SearchTermAgg, SegmentAgg, WinDayAnalysis } from '@/lib/types'

interface OptimizeResponse {
  project: { project_id: string; name: string; cid: string; campaign_id: string }
  range: { from: string; to: string }
  cost: { spend: number; rental: number; other: number; total: number }
  revenue: { screen: number; confirmed: number }
  settings: CampaignSettings | null
  hasMetrics: boolean
  breakdown: BreakdownMeta | null   // meta doanh thu breakdown từ network (Engine thu)
  health: CampaignHealth
  suggestions: OptimizationSuggestion[]
  hasConversionTracking: boolean
  hasBreakdownRevenue: boolean
  estimatedSavings: number
  dataMaturity: 'young' | 'ok'
  winDayAnalysis: WinDayAnalysis | null
  launchPlan: LaunchPlan | null
  breakdowns: { keywords: KeywordAgg[]; searchTerms: SearchTermAgg[]; segments: SegmentAgg[] }
  error?: string
  code?: string
}

type Mode = 'camp' | 'network' | 'advice'
const TABS: { key: Mode; label: string }[] = [
  { key: 'camp', label: 'Dữ liệu Camp' },
  { key: 'network', label: 'Dữ liệu Network' },
  { key: 'advice', label: 'Đề xuất tối ưu' },
]

export default function OptimizePage() {
  const { projects } = useProjectsContext()
  const { fromStr, toStr, setDateRange } = useDateRange()
  const { role } = useAuth()
  // Section quản lý network (lệnh/config engine) chỉ cho role khớp guard API admin.
  const canManage = role === 'super_admin' || role === 'manager'

  // Chỉ những project đã gắn Google campaign mới phân tích được (tab Camp/Đề xuất).
  const eligible = useMemo(
    () => projects.filter(p => p.google_campaign_id).sort((a, b) => a.name.localeCompare(b.name)),
    [projects],
  )
  // Tab Network: mọi project (không cần gắn campaign — chỉ cần Engine có dữ liệu breakdown).
  const allProjects = useMemo(() => [...projects].sort((a, b) => a.name.localeCompare(b.name)), [projects])

  const [mode, setMode] = useState<Mode>('camp')
  const [openId, setOpenId] = useState('')          // camp đang mở chi tiết ('' = xem danh sách) — dùng chung Camp/Đề xuất
  const [netProjectId, setNetProjectId] = useState('')
  const [data, setData] = useState<OptimizeResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overview, setOverview] = useState<OverviewRow[] | null>(null)
  const [ovLoading, setOvLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const isCampish = mode === 'camp' || mode === 'advice'
  const netSelectedId = netProjectId || allProjects[0]?.project_id || ''

  const authFetch = async (url: string) => {
    const { data: { session } } = await supabase.auth.getSession()
    return fetch(url, { headers: session ? { Authorization: `Bearer ${session.access_token}` } : {} }).then(r => r.json())
  }

  // Chi tiết 1 camp (tab Camp/Đề xuất, khi đã chọn camp).
  useEffect(() => {
    if (!isCampish || !openId) return
    let cancelled = false
    const run = async () => {
      setLoading(true); setError(null)
      try {
        const res: OptimizeResponse = await authFetch(`/api/optimize?project_id=${encodeURIComponent(openId)}&from=${fromStr}&to=${toStr}`)
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
  }, [isCampish, openId, fromStr, toStr, refreshKey])

  // Danh sách camp (tab Camp/Đề xuất, khi chưa chọn camp).
  useEffect(() => {
    if (!isCampish) return
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
  }, [isCampish, fromStr, toStr])

  const errorBox = error && (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div>
  )
  const noMetricsBox = (
    <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
      <Info className="mx-auto mb-2 text-slate-400" size={22} />
      <p className="text-sm font-medium text-slate-700">Chưa có số liệu hiệu suất cho camp này</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
        Cần chạy bản Google Ads Script mới (đã bổ sung <code className="rounded bg-slate-100 px-1">campaign_metrics</code>)
        để đồng bộ impressions/clicks/CTR/CPC/Impression Share. Sau lần sync tiếp theo, số liệu sẽ hiển thị ở đây.
      </p>
    </div>
  )
  const loadingBox = <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Đang tải…</div>

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
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setMode(t.key)}
              className={cn('rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                mode === t.key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Camp/Đề xuất — chỉ khi đã mở 1 camp: nút về danh sách + đổi camp nhanh */}
        {isCampish && openId && (
          <>
            <button
              onClick={() => setOpenId('')}
              className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
            >
              <ArrowLeft size={15} /> Danh sách
            </button>
            <select
              value={openId}
              onChange={e => setOpenId(e.target.value)}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-slate-400 focus:outline-none"
            >
              {eligible.map(p => (
                <option key={p.project_id} value={p.project_id}>{p.name} · {formatCid(p.cid)}</option>
              ))}
            </select>
          </>
        )}

        {/* Network — chọn dự án để đối chiếu */}
        {mode === 'network' && (
          <select
            value={netSelectedId}
            onChange={e => setNetProjectId(e.target.value)}
            className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-slate-400 focus:outline-none"
          >
            {allProjects.length === 0 && <option value="">— Chưa có dự án —</option>}
            {allProjects.map(p => (
              <option key={p.project_id} value={p.project_id}>{p.name}</option>
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

      {/* ── Tab Dữ liệu Camp ── */}
      {mode === 'camp' && (
        openId ? (
          <div className="space-y-5">
            {errorBox}
            {!error && data && !data.hasMetrics && noMetricsBox}
            {!error && data && data.hasMetrics && (
              <>
                <HealthScorecard health={data.health} cost={data.cost} confirmedRevenue={data.revenue.confirmed} settings={data.settings} />
                <section>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold text-slate-700">Chi tiết keyword, search term &amp; phân khúc</h2>
                    {data.breakdown && (
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-medium ring-1',
                          data.hasBreakdownRevenue
                            ? 'bg-green-50 text-green-700 ring-green-200'
                            : 'bg-slate-50 text-slate-500 ring-slate-200',
                        )}
                        title={`Doanh thu breakdown phủ ${Math.round(data.breakdown.coverageRatio * 100)}% DT Màn hình trong kỳ`}
                      >
                        DT network: {data.breakdown.attribution === 'campaign' ? 'gắn theo campaign (sub-id)' : 'gắn theo dự án'}
                        {' · '}phủ {Math.round(data.breakdown.coverageRatio * 100)}%
                        {!data.hasBreakdownRevenue && ' — chưa đủ để tin ROI segment'}
                      </span>
                    )}
                  </div>
                  <BreakdownTables keywords={data.breakdowns.keywords} searchTerms={data.breakdowns.searchTerms} segments={data.breakdowns.segments} sections="all" />
                </section>
              </>
            )}
            {!error && !data && loadingBox}
          </div>
        ) : (
          overview ? <PortfolioTable rows={overview} variant="data" onSelect={setOpenId} /> : loadingBox
        )
      )}

      {/* ── Tab Dữ liệu Network: quản lý pipeline breakdown + đối chiếu dữ liệu đã thu theo dự án ── */}
      {mode === 'network' && (
        <div className="space-y-5">
          {canManage && <BreakdownNetworkManager />}
          {netSelectedId
            ? <BreakdownDataPanel projectId={netSelectedId} from={fromStr} to={toStr} />
            : <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Chưa có dự án nào.</div>}
        </div>
      )}

      {/* ── Tab Đề xuất tối ưu ── */}
      {mode === 'advice' && (
        openId ? (
          <div className="space-y-5">
            {errorBox}
            {/* Lộ trình test camp mới — hiện cả khi CHƯA có metrics (lúc cần nhất) */}
            {!error && data && data.launchPlan && (
              <LaunchChecklist plan={data.launchPlan} projectId={openId} onSaved={() => setRefreshKey(k => k + 1)} />
            )}
            {!error && data && !data.hasMetrics && noMetricsBox}
            {!error && data && data.hasMetrics && (
              <>
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
              </>
            )}
            {!error && !data && loadingBox}
          </div>
        ) : (
          overview ? <PortfolioTable rows={overview} variant="advice" onSelect={setOpenId} /> : loadingBox
        )
      )}
    </div>
  )
}
