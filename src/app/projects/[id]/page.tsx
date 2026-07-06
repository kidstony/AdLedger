'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { ArrowLeft, Zap, Database, Monitor, Calendar, Banknote } from 'lucide-react'
import { MOCK_PNL_DAILY } from '@/lib/mock-data'
import { useProjectsContext } from '@/context/ProjectsContext'
import { supabase } from '@/lib/supabase'
import ProfitChart from '@/components/project-detail/ProfitChart'
import DateRangePicker from '@/components/ui/DateRangePicker'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { formatVNDFull, formatROI, formatVND, getProfitTextClass, getRoiTextClass, formatCid, cn } from '@/lib/utils'
import { AdDevice, PnlDaily, RentalGroup, OtherCost, STATUS_CONFIG } from '@/lib/types'
import { computeCidCostForDay } from '@/lib/costs'
import { allocateSpendRow, splitSpend } from '@/lib/attribution'
import { useAuth } from '@/context/AuthContext'
import ShareTab from '@/components/project/ShareTab'
import { useSharePermissions } from '@/hooks/useSharePermissions'

function localStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function defaultFrom(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

// Dòng bảng theo ngày kèm tổng chi phí đã tách QC / Thuê TK / CP khác
type ViewRow = PnlDaily & { cost: number; rentalDay: number; otherDay: number }

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { projects } = useProjectsContext()
  const { role, teamId: userTeamId } = useAuth()
  const sharePerms = useSharePermissions(id)
  const project = projects.find(p => p.project_id === id)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [fromStr, setFromStr] = useState(defaultFrom)
  const [toStr, setToStr]     = useState(() => localStr(new Date()))
  const [daily, setDaily]     = useState<PnlDaily[]>([])
  const [screenByDate, setScreenByDate] = useState<Map<string, number>>(new Map())
  const [rentalCost, setRentalCost] = useState(0)
  const [otherCost, setOtherCost]   = useState(0)
  const [qcSpend, setQcSpend]       = useState(0)
  const [isLoading, setIsLoading]   = useState(true)
  const [dataSource, setDataSource] = useState<'real' | 'mock'>('mock')
  const [teamUsers, setTeamUsers] = useState<{ user_id: string; full_name: string }[]>([])
  const [dataView, setDataView] = useState<'screen' | 'confirmed'>('screen')
  const [rentalByDate, setRentalByDate] = useState<Map<string, number>>(new Map())
  const [otherByDate, setOtherByDate]   = useState<Map<string, number>>(new Map())

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      fetch('/api/projects/team-users', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      }).then(r => r.json()).then((d: { user_id: string; full_name: string }[]) => {
        if (Array.isArray(d)) setTeamUsers(d)
      }).catch(() => {})
    })
  }, [])

  useEffect(() => {
    if (projects.length === 0) return
    setIsLoading(true)

    // Các ref-link project chung campaign / chung CID (để tách đúng slice chi phí).
    const campSiblings = project?.google_campaign_id
      ? projects.filter(p => p.google_campaign_id === project.google_campaign_id)
      : project ? [project] : []
    const cidSiblings = project?.cid
      ? projects.filter(p => p.cid === project.cid)
      : project ? [project] : []

    const spendPromise = project?.google_campaign_id
      ? supabase.from('ad_spend').select('campaign_id, date, spend, device, ad_group_id').eq('campaign_id', project.google_campaign_id).gte('date', fromStr).lte('date', toStr)
      : Promise.resolve({ data: [] as { campaign_id: string; date: string; spend: number; device: AdDevice; ad_group_id: string }[] })

    // Doanh thu của các sibling (chỉ khi chung campaign/CID) để làm cơ sở chia tay.
    const siblingIds = [...new Set([...campSiblings, ...cidSiblings].map(p => p.project_id))]
    const siblingRevPromise = siblingIds.length > 1
      ? supabase.from('affiliate_revenue').select('project_id, type, amount').in('project_id', siblingIds).gte('date', fromStr).lte('date', toStr)
      : Promise.resolve({ data: [] as { project_id: string; type: 'confirmed' | 'pending'; amount: number }[] })

    // affiliate_revenue table columns: project_id, date, type ('confirmed'|'pending'), amount
    const revPromise = supabase
      .from('affiliate_revenue')
      .select('date, type, amount')
      .eq('project_id', id)
      .gte('date', fromStr)
      .lte('date', toStr)

    // For cumulative projects: fetch the last pending value before `from` to compute delta
    const prevCumulativePromise = project?.screen_revenue_type === 'cumulative'
      ? supabase
          .from('affiliate_revenue')
          .select('amount')
          .eq('project_id', id)
          .eq('type', 'pending')
          .lt('date', fromStr)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null })

    // These API routes require a Bearer token (getCallerProfile) — attach the session token
    const authFetch = (url: string) => supabase.auth.getSession().then(({ data: { session } }) =>
      fetch(url, { headers: session ? { Authorization: `Bearer ${session.access_token}` } : {} }).then(r => r.json())
    ).catch(() => [])
    const rgPromise  = authFetch('/api/expenses/rental-groups')
    const ocPromise  = authFetch(`/api/expenses/other?from=${fromStr}&to=${toStr}`)

    Promise.all([spendPromise, revPromise, prevCumulativePromise, rgPromise, ocPromise, siblingRevPromise]).then(([spendRes, revRes, prevCumRes, rgRaw, ocRaw, sibRevRes]) => {
      const spendRows = (spendRes.data ?? []) as { campaign_id: string; date: string; spend: number; device: AdDevice; ad_group_id: string }[]
      const revRows   = (revRes.data   ?? []) as { date: string; type: 'confirmed' | 'pending'; amount: number }[]
      const rentalGroups: RentalGroup[] = Array.isArray(rgRaw) ? rgRaw : []
      const otherCosts: OtherCost[]     = Array.isArray(ocRaw) ? ocRaw : []

      // Cơ sở chia sibling (screen ưu tiên): tổng amount theo project_id.
      const sibRevRows = (sibRevRes.data ?? []) as { project_id: string; type: 'confirmed' | 'pending'; amount: number }[]
      const revenueBasis = new Map<string, number>()
      const confirmedBasis = new Map<string, number>()
      sibRevRows.forEach(r => {
        const m = r.type === 'pending' ? revenueBasis : confirmedBasis
        m.set(r.project_id, (m.get(r.project_id) ?? 0) + r.amount)
      })
      confirmedBasis.forEach((v, pid) => { if (!revenueBasis.get(pid)) revenueBasis.set(pid, v) })

      // Aggregate confirmed → revenue, pending → screen_revenue per date
      const revMap    = new Map<string, number>()
      const screenMap = new Map<string, number>()

      if (project?.screen_revenue_type === 'cumulative') {
        // Pending entries store running totals — convert to per-entry deltas
        const prevBaseline = (prevCumRes.data as { amount: number } | null)?.amount ?? 0
        const pendingEntries = revRows
          .filter(r => r.type === 'pending')
          .sort((a, b) => a.date.localeCompare(b.date))
        let prev = prevBaseline
        pendingEntries.forEach(r => {
          const delta = Math.max(0, r.amount - prev)
          if (delta > 0) screenMap.set(r.date, (screenMap.get(r.date) ?? 0) + delta)
          prev = r.amount
        })
        revRows.filter(r => r.type === 'confirmed').forEach(r => {
          revMap.set(r.date, (revMap.get(r.date) ?? 0) + r.amount)
        })
      } else {
        revRows.forEach(r => {
          if (r.type === 'confirmed') {
            revMap.set(r.date, (revMap.get(r.date) ?? 0) + r.amount)
          } else {
            screenMap.set(r.date, (screenMap.get(r.date) ?? 0) + r.amount)
          }
        })
      }

      // QC theo ngày = slice của project này (qua resolver device/ad_group/date_window;
      // fallback chia theo doanh thu khi nhiều ref chung campaign).
      const spendMap = new Map<string, number>()
      spendRows.forEach(row => {
        const portion = allocateSpendRow(row, campSiblings, revenueBasis).get(id) ?? 0
        if (portion) spendMap.set(row.date, (spendMap.get(row.date) ?? 0) + portion)
      })

      // ─── CP khác theo ngày ───────────────────────────────────────────────
      const projOther = otherCosts.filter(c => c.project_id === id)
      const otherMap = new Map<string, number>()
      projOther.forEach(c => otherMap.set(c.date, (otherMap.get(c.date) ?? 0) + c.amount))
      const other = projOther.reduce((s, c) => s + c.amount, 0)

      // ─── Thuê TK theo ngày — quy chi phí thuê thật về từng ngày lịch ──────
      const rentalByDateMap = new Map<string, number>()
      const rangeEnd = new Date(toStr + 'T00:00:00')
      for (let d = new Date(fromStr + 'T00:00:00'); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
        const ds = localStr(d)
        const daySpend = new Map([[project?.cid ?? '', spendMap.get(ds) ?? 0]])
        let rd = 0
        rentalGroups.forEach(rg => {
          rg.rental_group_cids?.forEach(ce => {
            const dayCost = computeCidCostForDay(ce.cid, rg, ds, daySpend)
            if (!dayCost) return
            if (ce.project_id === id) {
              rd += dayCost
            } else if (!ce.project_id && ce.cid === project?.cid) {
              // Không gán cụ thể: chia đều/theo doanh thu giữa các ref chung CID.
              rd += cidSiblings.length > 1
                ? (splitSpend(dayCost, cidSiblings, revenueBasis).get(id) ?? 0)
                : dayCost
            }
          })
        })
        if (rd > 0) rentalByDateMap.set(ds, rd)
      }
      const rental = [...rentalByDateMap.values()].reduce((s, v) => s + v, 0)

      // ─── Build daily rows ─────────────────────────────────────────────────
      if (spendRows.length === 0 && revRows.length === 0) {
        const mockDays = MOCK_PNL_DAILY.filter(d => d.project_id === id && d.date >= fromStr && d.date <= toStr)
        setDaily(mockDays)
        setScreenByDate(new Map())
        setQcSpend(mockDays.reduce((s, d) => s + d.spend, 0))
        setDataSource('mock')
      } else {
        const dates = [...new Set([...spendMap.keys(), ...revMap.keys(), ...screenMap.keys(), ...otherMap.keys(), ...rentalByDateMap.keys()])].sort()

        const rows = dates.map(date => {
          const spend   = spendMap.get(date) ?? 0
          const revenue = revMap.get(date)   ?? 0
          return {
            project_id: id,
            cid: project?.cid ?? '',
            name: project?.name ?? id,
            date,
            spend,
            revenue,
            profit: revenue - spend,
            roi: spend > 0 ? ((revenue - spend) / spend) * 100 : 0,
          }
        })
        setDaily(rows)
        setScreenByDate(screenMap)
        setQcSpend(rows.reduce((s, r) => s + r.spend, 0))
        setDataSource('real')
      }

      setRentalByDate(rentalByDateMap)
      setOtherByDate(otherMap)
      setRentalCost(rental)
      setOtherCost(other)

      setIsLoading(false)
    })
  }, [projects, project, id, fromStr, toStr])

  const totalSpend      = qcSpend + rentalCost + otherCost
  const isScreen        = dataView === 'screen'
  // Per-day rows: tổng chi phí = QC + Thuê TK + CP khác (thật theo ngày);
  // LN/ROI tính lại theo tổng chi phí; doanh thu đổi theo tab đang chọn.
  const viewRows: ViewRow[] = daily.map(r => {
    const rentalDay = rentalByDate.get(r.date) ?? 0
    const otherDay  = otherByDate.get(r.date) ?? 0
    const cost      = r.spend + rentalDay + otherDay
    const revenue   = isScreen ? (screenByDate.get(r.date) ?? 0) : r.revenue
    return { ...r, revenue, cost, rentalDay, otherDay,
      profit: revenue - cost, roi: cost > 0 ? ((revenue - cost) / cost) * 100 : 0 }
  })
  const viewRevenue     = viewRows.reduce((s, r) => s + r.revenue, 0)
  const viewProfit      = viewRevenue - totalSpend
  const viewRoi         = totalSpend > 0 ? (viewProfit / totalSpend) * 100 : 0
  const canShare        = role === 'super_admin' || (role === 'manager' && project?.team_id === userTeamId)
  const activeTab: 'info' | 'share' = (searchParams.get('tab') === 'share' && canShare) ? 'share' : 'info'
  function setActiveTab(tab: 'info' | 'share') {
    const p = new URLSearchParams(searchParams.toString())
    if (tab === 'share') p.set('tab', 'share'); else p.delete('tab')
    router.replace(`${pathname}?${p.toString()}`)
  }
  // Permission masking: non-members always see everything; members use resolved sharePerms
  const isMember        = role === 'member'
  const canViewRevenue  = !isMember || (sharePerms?.view_revenue   ?? false)
  const canViewProfit   = !isMember || (sharePerms?.view_profit    ?? false)
  const canViewAdspend  = !isMember || (sharePerms?.view_adspend   ?? false)
  const canInputRevenue = !isMember || (sharePerms?.input_revenue  ?? false)
  const canInputExpense = !isMember || (sharePerms?.input_expense  ?? false)
  const canConfirmPay   = !isMember || (sharePerms?.confirm_payment ?? false)

  if (!project && !isLoading && projects.length > 0) {
    return (
      <div className="p-6">
        <p className="text-slate-500">Không tìm thấy dự án.</p>
        <Link href="/dashboard" className="text-sm text-blue-600 hover:underline mt-2 inline-block">← Quay lại</Link>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-3">
          <ArrowLeft size={14} /> Quay lại Dashboard
        </Link>
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-slate-800">
            {project?.name ?? id}
          </h2>
          {!isLoading && (
            dataSource === 'real' ? (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-medium border border-green-200">
                <Zap size={10} /> Chi phí thật
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium border border-amber-200">
                <Database size={10} /> Demo data
              </span>
            )
          )}
        </div>
        {project && (
          <p className="text-sm text-slate-500 mt-0.5">
            CID: <span className="font-mono">{formatCid(project.cid)}</span> · {project.project_id}
            {project.google_campaign_id && (
              <span className="ml-2">· Campaign: <span className="font-mono">{project.google_campaign_id}</span></span>
            )}
          </p>
        )}
      </div>

      {/* Camp Manager info strip */}
      {project && ((project.statuses?.length ?? 0) > 0 || project.category || project.camp_start_date || project.affiliate_network) && (
        <div className="flex flex-wrap items-center gap-2 py-2 px-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
          {(project.statuses ?? []).map(s => (
            <span key={s} className={`px-2 py-0.5 rounded-full font-medium ${STATUS_CONFIG[s]?.badge ?? ''}`}>
              {STATUS_CONFIG[s]?.label}
            </span>
          ))}
          {project.category && (
            <span className="px-2 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: (project.category.color ?? '#6b7280') + '22', color: project.category.color ?? '#6b7280' }}>
              {project.category.name}
            </span>
          )}
          {project.camp_start_date && (
            <span className="flex items-center gap-1 text-slate-500">
              <Calendar size={10} />
              Lên camp: {new Date(project.camp_start_date).toLocaleDateString('vi-VN')}
            </span>
          )}
          {project.affiliate_network && (
            <span className="text-slate-500">Mạng: <span className="font-medium text-slate-700">{project.affiliate_network}</span></span>
          )}
          {project.person_in_charge && (
            <span className="text-slate-500">
              👤 <span className="font-medium text-slate-700">
                {teamUsers.find(u => u.user_id === project.person_in_charge)?.full_name ?? '—'}
              </span>
            </span>
          )}
          {project.note && (
            <span className="text-slate-500 truncate max-w-xs" title={project.note}>{project.note}</span>
          )}
        </div>
      )}

      {/* Tab bar — chỉ hiện với super_admin và manager của team sở hữu dự án */}
      {canShare && (
        <div className="flex gap-1 border-b border-slate-200">
          {(['info', 'share'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab === 'info' ? 'Thông tin' : 'Chia sẻ'}
            </button>
          ))}
        </div>
      )}

      {(!canShare || activeTab === 'info') && (<>
      {/* Date range picker + revenue-source switcher */}
      <div className="flex flex-wrap items-center gap-3">
        <DateRangePicker
          from={fromStr}
          to={toStr}
          onApply={(f, t) => { setFromStr(f); setToStr(t) }}
        />
        <div className="ml-auto flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
          <button
            onClick={() => setDataView('screen')}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              isScreen ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
          >
            <Monitor size={12} /> Tiền màn hình
          </button>
          <button
            onClick={() => setDataView('confirmed')}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              !isScreen ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
          >
            <Banknote size={12} /> Doanh thu thực
          </button>
        </div>
      </div>

      {/* Stats cards */}
      {isLoading ? (
        <div className="grid grid-cols-4 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
              <div className="h-3 w-24 bg-slate-200 rounded animate-pulse mb-3" />
              <div className="h-6 w-32 bg-slate-200 rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {/* Tổng Chi phí — with breakdown if rental or other > 0 */}
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Tổng Chi phí</p>
            <p className="text-lg font-semibold text-slate-700">{canViewAdspend ? formatVNDFull(totalSpend) : '****'}</p>
            {canViewAdspend && (rentalCost > 0 || otherCost > 0) && (
              <div className="mt-2.5 space-y-1 border-t border-slate-100 pt-2">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>Chi phí QC</span><span className="font-mono">{formatVND(qcSpend)}</span>
                </div>
                {rentalCost > 0 && (
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>Thuê TK</span><span className="font-mono">{formatVND(rentalCost)}</span>
                  </div>
                )}
                {otherCost > 0 && (
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>CP Khác</span><span className="font-mono">{formatVND(otherCost)}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
              {isScreen ? 'Tiền màn hình' : 'Doanh thu thực'}
            </p>
            <p className={`text-lg font-semibold ${isScreen ? 'text-amber-500' : 'text-blue-600'}`}>
              {canViewRevenue ? formatVNDFull(viewRevenue) : '****'}
            </p>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
              {isScreen ? 'LN màn hình' : 'Lợi nhuận'}
            </p>
            <p className={`text-lg font-semibold ${canViewProfit ? (isScreen ? 'text-amber-500' : getProfitTextClass(viewProfit)) : 'text-slate-400'}`}>
              {canViewProfit ? (viewProfit >= 0 ? '+' : '') + formatVNDFull(viewProfit) : '****'}
            </p>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">ROI</p>
            <p className={`text-lg font-semibold ${canViewProfit ? (isScreen ? 'text-amber-500' : getRoiTextClass(viewRoi)) : 'text-slate-400'}`}>
              {canViewProfit ? formatROI(viewRoi) : '****'}
            </p>
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
        <h3 className="text-sm font-medium text-slate-700 mb-4">Biểu đồ P&L</h3>
        {isLoading ? (
          <div className="h-80 bg-slate-50 rounded animate-pulse" />
        ) : daily.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-16">Chưa có dữ liệu trong khoảng thời gian này.</p>
        ) : (
          <ProfitChart data={viewRows.map(r => ({ ...r, spend: r.cost }))} />
        )}
      </div>

      {/* Daily table */}
      {!isLoading && daily.length > 0 && (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-auto max-h-80">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                <tr>
                  {(isScreen
                    ? ['Ngày', 'Tổng chi phí', 'Tiền màn hình', 'LN màn hình', 'ROI%']
                    : ['Ngày', 'Tổng chi phí', 'Doanh thu', 'Lợi nhuận', 'ROI%']
                  ).map(h => (
                    <th key={h} className="px-4 py-2.5 text-right first:text-left text-xs font-medium text-slate-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...viewRows].reverse().map(row => (
                  <tr key={row.date} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-xs text-slate-600 font-mono">{row.date}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600">
                      {!canViewAdspend ? '****' : row.cost > 0 ? (
                        <Tooltip>
                          <TooltipTrigger className="border-b border-dotted border-slate-300 cursor-help">
                            {formatVND(row.cost)}
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="flex flex-col gap-0.5 text-left min-w-[120px]">
                              <div className="flex justify-between gap-4"><span>QC</span><span className="font-mono">{formatVND(row.spend)}</span></div>
                              <div className="flex justify-between gap-4"><span>Thuê TK</span><span className="font-mono">{row.rentalDay > 0 ? formatVND(row.rentalDay) : '—'}</span></div>
                              <div className="flex justify-between gap-4"><span>CP khác</span><span className="font-mono">{row.otherDay > 0 ? formatVND(row.otherDay) : '—'}</span></div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono text-xs ${isScreen ? 'text-amber-500' : 'text-slate-600'}`}>
                      {canViewRevenue ? formatVND(row.revenue) : '****'}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono text-xs font-medium ${canViewProfit ? (isScreen ? 'text-amber-500' : getProfitTextClass(row.profit)) : 'text-slate-400'}`}>
                      {canViewProfit ? (row.profit >= 0 ? '+' : '') + formatVND(row.profit) : '****'}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono text-xs ${canViewProfit ? (isScreen ? 'text-amber-500' : getRoiTextClass(row.roi)) : 'text-slate-400'}`}>
                      {canViewProfit ? formatROI(row.roi) : '****'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>)}

      {canShare && activeTab === 'share' && project && (
        <ShareTab
          projectId={project.project_id}
          projectName={project.name}
          teamId={project.team_id ?? null}
        />
      )}
    </div>
  )
}
