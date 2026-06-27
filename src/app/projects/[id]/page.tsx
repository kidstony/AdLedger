'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { ArrowLeft, Zap, Database, Monitor, Calendar } from 'lucide-react'
import { MOCK_PNL_DAILY } from '@/lib/mock-data'
import { useProjectsContext } from '@/context/ProjectsContext'
import { supabase } from '@/lib/supabase'
import ProfitChart from '@/components/project-detail/ProfitChart'
import DateRangePicker from '@/components/ui/DateRangePicker'
import { formatVNDFull, formatROI, formatVND, getProfitTextClass, getRoiTextClass, formatCid } from '@/lib/utils'
import { PnlDaily, RentalGroup, OtherCost, STATUS_CONFIG } from '@/lib/types'
import { computeCidCost } from '@/lib/costs'
import { useAuth } from '@/context/AuthContext'
import ShareTab from '@/components/project/ShareTab'
import { useSharePermissions } from '@/hooks/useSharePermissions'

function localStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function defaultFrom(): string {
  const d = new Date()
  d.setDate(d.getDate() - 29)
  return localStr(d)
}

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

    const spendPromise = project?.google_campaign_id
      ? supabase.from('ad_spend').select('date, spend').eq('campaign_id', project.google_campaign_id).gte('date', fromStr).lte('date', toStr)
      : Promise.resolve({ data: [] as { date: string; spend: number }[] })

    // affiliate_revenue table columns: project_id, date, type ('confirmed'|'pending'), amount
    const revPromise = supabase
      .from('affiliate_revenue')
      .select('date, type, amount')
      .eq('project_id', id)
      .gte('date', fromStr)
      .lte('date', toStr)

    const rgPromise  = fetch('/api/expenses/rental-groups').then(r => r.json()).catch(() => [])
    const ocPromise  = fetch(`/api/expenses/other?from=${fromStr}&to=${toStr}`).then(r => r.json()).catch(() => [])

    Promise.all([spendPromise, revPromise, rgPromise, ocPromise]).then(([spendRes, revRes, rgRaw, ocRaw]) => {
      const spendRows = (spendRes.data ?? []) as { date: string; spend: number }[]
      const revRows   = (revRes.data   ?? []) as { date: string; type: 'confirmed' | 'pending'; amount: number }[]
      const rentalGroups: RentalGroup[] = Array.isArray(rgRaw) ? rgRaw : []
      const otherCosts: OtherCost[]     = Array.isArray(ocRaw) ? ocRaw : []

      // Aggregate confirmed → revenue, pending → screen_revenue per date
      const revMap    = new Map<string, number>()
      const screenMap = new Map<string, number>()
      revRows.forEach(r => {
        if (r.type === 'confirmed') {
          revMap.set(r.date, (revMap.get(r.date) ?? 0) + r.amount)
        } else {
          screenMap.set(r.date, (screenMap.get(r.date) ?? 0) + r.amount)
        }
      })

      // ─── Build daily rows ─────────────────────────────────────────────────
      if (spendRows.length === 0 && revRows.length === 0) {
        const mockDays = MOCK_PNL_DAILY.filter(d => d.project_id === id && d.date >= fromStr && d.date <= toStr)
        setDaily(mockDays)
        setScreenByDate(new Map())
        setQcSpend(mockDays.reduce((s, d) => s + d.spend, 0))
        setDataSource('mock')
      } else {
        const spendMap = new Map(spendRows.map(r => [r.date, r.spend]))
        const dates = [...new Set([...spendMap.keys(), ...revMap.keys()])].sort()

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

      // ─── Rental cost for this project ────────────────────────────────────
      const adSpendByCid = new Map<string, number>()
      if (project?.cid) {
        adSpendByCid.set(project.cid, spendRows.reduce((s, r) => s + r.spend, 0))
      }
      let rental = 0
      rentalGroups.forEach(rg => {
        rg.rental_group_cids?.forEach(cidEntry => {
          if (cidEntry.project_id === id || (!cidEntry.project_id && cidEntry.cid === project?.cid)) {
            rental += computeCidCost(cidEntry.cid, rg, fromStr, toStr, adSpendByCid)
          }
        })
      })
      setRentalCost(rental)

      // ─── Other costs for this project ─────────────────────────────────────
      const other = otherCosts
        .filter(c => c.project_id === id)
        .reduce((s, c) => s + c.amount, 0)
      setOtherCost(other)

      setIsLoading(false)
    })
  }, [projects, project, id, fromStr, toStr])

  const totalSpend      = qcSpend + rentalCost + otherCost
  const totalRevenue    = daily.reduce((s, d) => s + d.revenue, 0)
  const totalScreen     = [...screenByDate.values()].reduce((s, v) => s + v, 0)
  const totalProfit     = totalRevenue - totalSpend
  const roi             = totalSpend > 0 ? (totalProfit / totalSpend) * 100 : 0
  const hasScreen       = totalScreen > 0
  const estimatedProfit = totalRevenue + totalScreen - totalSpend
  const estimatedRoi    = totalSpend > 0 ? (estimatedProfit / totalSpend) * 100 : 0
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
      {/* Date range picker */}
      <DateRangePicker
        from={fromStr}
        to={toStr}
        onApply={(f, t) => { setFromStr(f); setToStr(t) }}
      />

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
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Tổng Doanh thu</p>
            <p className="text-lg font-semibold text-blue-600">{canViewRevenue ? formatVNDFull(totalRevenue) : '****'}</p>
            {canViewRevenue && hasScreen && (
              <div className="mt-1.5 flex items-center justify-between text-xs">
                <span className="text-slate-400 flex items-center gap-1"><Monitor size={10} /> Chờ về</span>
                <span className="text-amber-500 font-medium">+{formatVNDFull(totalScreen)}</span>
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Lợi nhuận</p>
            <p className={`text-lg font-semibold ${canViewProfit ? getProfitTextClass(totalProfit) : 'text-slate-400'}`}>
              {canViewProfit ? formatVNDFull(totalProfit) : '****'}
            </p>
            {canViewProfit && hasScreen && (
              <div className="mt-1.5 flex items-center justify-between text-xs">
                <span className="text-slate-400 flex items-center gap-1"><Monitor size={10} /> Ước tính</span>
                <span className={`font-medium ${estimatedProfit >= 0 ? 'text-amber-500' : 'text-red-400'}`}>
                  {estimatedProfit >= 0 ? '+' : ''}{formatVNDFull(estimatedProfit)}
                </span>
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">ROI</p>
            <p className={`text-lg font-semibold ${canViewProfit ? getRoiTextClass(roi) : 'text-slate-400'}`}>
              {canViewProfit ? formatROI(roi) : '****'}
            </p>
            {hasScreen && (
              <div className="mt-1.5 flex items-center justify-between text-xs">
                <span className="text-slate-400 flex items-center gap-1"><Monitor size={10} /> Ước tính</span>
                <span className={`font-medium ${estimatedRoi >= 0 ? 'text-amber-500' : 'text-red-400'}`}>
                  {canViewProfit ? formatROI(estimatedRoi) : '****'}
                </span>
              </div>
            )}
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
          <ProfitChart data={daily} />
        )}
      </div>

      {/* Daily table */}
      {!isLoading && daily.length > 0 && (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-auto max-h-80">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                <tr>
                  {['Ngày', 'Chi phí QC', 'Doanh thu', 'DT Màn hình', 'Lợi nhuận', 'LN ước tính', 'ROI%'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-right first:text-left text-xs font-medium text-slate-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...daily].reverse().map(row => (
                  <tr key={row.date} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-xs text-slate-600 font-mono">{row.date}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600">
                      {canViewAdspend ? formatVND(row.spend) : '****'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600">
                      {canViewRevenue ? formatVND(row.revenue) : '****'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-amber-500">
                      {canViewRevenue
                        ? (screenByDate.get(row.date) ?? 0) > 0
                          ? formatVND(screenByDate.get(row.date)!)
                          : <span className="text-slate-300">—</span>
                        : '****'}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono text-xs font-medium ${canViewProfit ? getProfitTextClass(row.profit) : 'text-slate-400'}`}>
                      {canViewProfit ? (row.profit >= 0 ? '+' : '') + formatVND(row.profit) : '****'}
                    </td>
                    {(() => {
                      const screen = screenByDate.get(row.date) ?? 0
                      const est = row.revenue + screen - row.spend
                      if (!canViewProfit) return <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-400">****</td>
                      return screen > 0 ? (
                        <td className={`px-4 py-2.5 text-right font-mono text-xs font-medium ${est >= 0 ? 'text-amber-500' : 'text-red-500'}`}>
                          {est >= 0 ? '+' : ''}{formatVND(est)}
                        </td>
                      ) : (
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-300">—</td>
                      )
                    })()}
                    <td className={`px-4 py-2.5 text-right font-mono text-xs ${canViewProfit ? getRoiTextClass(row.roi) : 'text-slate-400'}`}>
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
