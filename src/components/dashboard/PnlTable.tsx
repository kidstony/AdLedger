'use client'

import { useState, useMemo, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUp, ArrowDown, ArrowUpDown, Monitor, Search, Download, Layers, ChevronDown, ChevronRight } from 'lucide-react'
import { PnlSummary, SortColumn, SortDirection } from '@/lib/types'
import { formatVND, formatROI, getPerformanceRowClass, getProfitTextClass, getRoiTextClass, cn, formatCid } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import TableSkeleton from '@/components/ui/TableSkeleton'
import EmptyState from '@/components/ui/EmptyState'
import { useAuth } from '@/context/AuthContext'
import { useProjectsContext } from '@/context/ProjectsContext'
import { useMasterProjectsContext } from '@/context/MasterProjectsContext'

interface Props {
  data: PnlSummary[]
  isLoading: boolean
  view: 'screen' | 'confirmed'
  search?: string
  onSearchChange?: (v: string) => void
  onExport?: () => void
}

const columns: { key: string; label: string; sortable: boolean; align: string; icon?: boolean }[] = [
  { key: 'name',                 label: 'Tên dự án',      sortable: true,  align: 'text-left' },
  { key: 'cid',                  label: 'CID',             sortable: false, align: 'text-left' },
  { key: 'total_cost',           label: 'Tổng CP',         sortable: true,  align: 'text-right' },
  { key: 'total_revenue',        label: 'Doanh thu',       sortable: true,  align: 'text-right' },
  { key: 'total_screen_revenue', label: 'DT Màn hình',     sortable: false, align: 'text-right', icon: true },
  { key: 'total_profit',         label: 'Lợi nhuận',       sortable: true,  align: 'text-right' },
  { key: 'avg_roi',              label: 'ROI%',            sortable: true,  align: 'text-right' },
]

type FilterKey = 'all' | 'profit' | 'loss' | 'roi50' | 'roi100'

const FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
  { key: 'all',    label: 'Tất cả' },
  { key: 'profit', label: 'Có lãi' },
  { key: 'loss',   label: 'Lỗ' },
  { key: 'roi50',  label: 'ROI > 50%' },
  { key: 'roi100', label: 'ROI > 100%' },
]

const TOP_N_OPTIONS = [
  { value: null, label: 'Tất cả' },
  { value: 5,    label: 'Top 5' },
  { value: 10,   label: 'Top 10' },
  { value: 20,   label: 'Top 20' },
]

function SortIcon({ col, sortCol, sortDir }: { col: string; sortCol: string; sortDir: SortDirection }) {
  if (col !== sortCol) return <ArrowUpDown size={12} className="text-slate-400" />
  return sortDir === 'asc'
    ? <ArrowUp size={12} className="text-slate-600" />
    : <ArrowDown size={12} className="text-slate-600" />
}

const nonSortable = new Set(['cid', 'total_screen_revenue'])

export default function PnlTable({ data, isLoading, view, search, onSearchChange, onExport }: Props) {
  const router = useRouter()
  const { role } = useAuth()
  const { projects } = useProjectsContext()
  const { masterProjects } = useMasterProjectsContext()
  const isScreen = view === 'screen'

  // Per-column visibility checks — respect effective_permissions custom overrides
  function fallback(row: (typeof data)[0]): boolean {
    return row.share_access_level === 'reporter' || row.share_access_level === 'editor'
  }
  function canSeeRevenue(row: (typeof data)[0]): boolean {
    if (role !== 'member') return true
    if (row.effective_permissions) return row.effective_permissions.view_revenue
    return fallback(row)
  }
  function canSeeSpend(row: (typeof data)[0]): boolean {
    if (role !== 'member') return true
    if (row.effective_permissions) return row.effective_permissions.view_adspend
    return fallback(row)
  }
  function canSeeProfit(row: (typeof data)[0]): boolean {
    if (role !== 'member') return true
    if (row.effective_permissions) return row.effective_permissions.view_profit
    return fallback(row)
  }
  const [sortCol, setSortCol] = useState<SortColumn | 'total_cost'>('avg_roi')
  const [sortDir, setSortDir] = useState<SortDirection>('desc')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [topN, setTopN] = useState<number | null>(null)
  const [grouped, setGrouped] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const costOf = (s: PnlSummary) => s.total_spend + s.total_rental + s.total_other

  function handleSort(col: string) {
    if (nonSortable.has(col)) return
    const c = col as SortColumn | 'total_cost'
    if (c === sortCol) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(c)
      setSortDir('asc')
    }
  }

  const sorted = useMemo(() => [...data].sort((a, b) => {
    const av = sortCol === 'total_cost' ? costOf(a) : a[sortCol]
    const bv = sortCol === 'total_cost' ? costOf(b) : b[sortCol]
    if (typeof av === 'string' && typeof bv === 'string') {
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    }
    return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
  }), [data, sortCol, sortDir])

  const displayed = useMemo(() => {
    let rows = sorted
    if (filter === 'profit') rows = rows.filter(r => r.total_profit > 0)
    if (filter === 'loss')   rows = rows.filter(r => r.total_profit < 0)
    if (filter === 'roi50')  rows = rows.filter(r => r.avg_roi > 50)
    if (filter === 'roi100') rows = rows.filter(r => r.avg_roi > 100)
    if (topN) rows = rows.slice(0, topN)
    return rows
  }, [sorted, filter, topN])

  // ── Group-by-master-project ────────────────────────────────────────────────
  // Reuses the exact relationship model of MasterProjectsTab: project_id →
  // master_project_id, then a master-level aggregate with ROI = profit/cost.
  const projectMasterMap = useMemo(
    () => new Map(projects.map(p => [p.project_id, p.master_project_id ?? null])),
    [projects]
  )
  const masterNameMap = useMemo(
    () => new Map(masterProjects.map(m => [m.id, m.name])),
    [masterProjects]
  )

  type MasterGroup = {
    kind: 'master'
    id: string
    name: string
    children: PnlSummary[]
    total_spend: number; total_rental: number; total_other: number
    cost: number; revenue: number; screenRevenue: number; profit: number; roi: number
    spendVisible: boolean; revenueVisible: boolean; profitVisible: boolean
  }
  type TopRow = MasterGroup | { kind: 'project'; row: PnlSummary }

  // Build the tree from the already-sorted rows so children keep column order.
  const groupedRows = useMemo<TopRow[]>(() => {
    const order: string[] = []
    const byMaster = new Map<string, PnlSummary[]>()
    const orphans: TopRow[] = []
    for (const row of sorted) {
      const mId = projectMasterMap.get(row.project_id) ?? null
      if (mId && masterNameMap.has(mId)) {
        if (!byMaster.has(mId)) { byMaster.set(mId, []); order.push(mId) }
        byMaster.get(mId)!.push(row)
      } else {
        orphans.push({ kind: 'project', row })
      }
    }
    const masters: TopRow[] = order.map(mId => {
      const children = byMaster.get(mId)!
      let cost = 0, revenue = 0, screenRevenue = 0, profit = 0
      let total_spend = 0, total_rental = 0, total_other = 0
      let spendVisible = false, revenueVisible = false, profitVisible = false
      for (const c of children) {
        if (canSeeSpend(c))   { cost += costOf(c); total_spend += c.total_spend; total_rental += c.total_rental; total_other += c.total_other; spendVisible = true }
        if (canSeeRevenue(c)) { revenue += c.total_revenue; screenRevenue += c.total_screen_revenue; revenueVisible = true }
        if (canSeeProfit(c))  { profit += c.total_profit; profitVisible = true }
      }
      const roi = cost > 0 ? (profit / cost) * 100 : 0
      return { kind: 'master', id: mId, name: masterNameMap.get(mId)!, children, total_spend, total_rental, total_other, cost, revenue, screenRevenue, profit, roi, spendVisible, revenueVisible, profitVisible }
    })
    return [...masters, ...orphans]
  }, [sorted, projectMasterMap, masterNameMap, role]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sort top-level rows by the active column, then apply filter tab + Top-N.
  const topProfit = (t: TopRow) => t.kind === 'master' ? t.profit : t.row.total_profit
  const topRoi    = (t: TopRow) => t.kind === 'master' ? t.roi : t.row.avg_roi
  const topSortValue = (t: TopRow): number | string => {
    if (t.kind === 'master') {
      switch (sortCol) {
        case 'name': return t.name
        case 'total_cost': return t.cost
        case 'total_revenue': return t.revenue
        case 'total_profit': return t.profit
        default: return t.roi // avg_roi (screen/cid columns are not sortable)
      }
    }
    const r = t.row
    if (sortCol === 'total_cost') return costOf(r)
    const v = r[sortCol as keyof PnlSummary]
    return typeof v === 'number' || typeof v === 'string' ? v : 0
  }

  const groupedDisplayed = useMemo(() => {
    const rows = [...groupedRows].sort((a, b) => {
      const av = topSortValue(a), bv = topSortValue(b)
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
    let out = rows
    if (filter === 'profit') out = out.filter(t => topProfit(t) > 0)
    if (filter === 'loss')   out = out.filter(t => topProfit(t) < 0)
    if (filter === 'roi50')  out = out.filter(t => topRoi(t) > 50)
    if (filter === 'roi100') out = out.filter(t => topRoi(t) > 100)
    if (topN) out = out.slice(0, topN)
    return out
  }, [groupedRows, sortCol, sortDir, filter, topN]) // eslint-disable-line react-hooks/exhaustive-deps

  const shownCount = grouped ? groupedDisplayed.length : displayed.length
  const totalCount = grouped ? groupedRows.length : data.length
  const countNoun  = grouped ? 'tổng dự án' : 'dự án'

  if (isLoading) return <TableSkeleton rows={10} cols={columns.length + 1} />

  if (data.length === 0) return <EmptyState message="Không có dữ liệu trong khoảng thời gian này." />

  // The 5 numeric cells (cost → ROI) for a real project row — shared by flat,
  // orphan and child rows so styling/permission logic stays in one place.
  function projectValueCells(row: PnlSummary) {
    return (
      <>
        <td className="px-4 py-3 text-right font-mono text-slate-700">
          {!canSeeSpend(row) ? '****' : costOf(row) > 0 ? (
            <Tooltip>
              <TooltipTrigger className="border-b border-dotted border-slate-300 cursor-help">
                {formatVND(costOf(row))}
              </TooltipTrigger>
              <TooltipContent>
                <div className="flex flex-col gap-0.5 text-left min-w-[120px]">
                  <div className="flex justify-between gap-4"><span>QC</span><span className="font-mono">{formatVND(row.total_spend)}</span></div>
                  <div className="flex justify-between gap-4"><span>Thuê TK</span><span className="font-mono">{row.total_rental > 0 ? formatVND(row.total_rental) : '—'}</span></div>
                  <div className="flex justify-between gap-4"><span>CP khác</span><span className="font-mono">{row.total_other > 0 ? formatVND(row.total_other) : '—'}</span></div>
                </div>
              </TooltipContent>
            </Tooltip>
          ) : <span className="text-slate-300">—</span>}
        </td>
        <td className={cn('px-4 py-3 text-right font-mono', isScreen ? 'text-slate-300' : 'text-slate-700 font-medium')}>
          {canSeeRevenue(row) ? formatVND(row.total_revenue) : '****'}
        </td>
        <td className={cn('px-4 py-3 text-right font-mono', isScreen ? 'text-amber-500 font-medium' : 'text-amber-300')}>
          {!canSeeRevenue(row) ? '****' : row.total_screen_revenue > 0 ? formatVND(row.total_screen_revenue) : <span className="text-slate-300">—</span>}
        </td>
        <td className={cn('px-4 py-3 text-right font-mono font-medium', !canSeeProfit(row) ? 'text-slate-400' : isScreen ? (row.total_profit >= 0 ? 'text-amber-500' : 'text-red-500') : getProfitTextClass(row.total_profit))}>
          {canSeeProfit(row) ? (row.total_profit >= 0 ? '+' : '') + formatVND(row.total_profit) : '****'}
        </td>
        <td className={cn('px-4 py-3 text-right font-mono text-xs', !canSeeProfit(row) ? 'text-slate-400' : isScreen ? (row.avg_roi >= 0 ? 'text-amber-500' : 'text-red-500') : getRoiTextClass(row.avg_roi))}>
          {canSeeProfit(row) ? formatROI(row.avg_roi) : '****'}
        </td>
      </>
    )
  }

  // A full project <tr>. `isChild` = indented row under an expanded master.
  function projectRow(row: PnlSummary, rank: number | null, isChild: boolean) {
    return (
      <tr
        key={row.project_id}
        onClick={() => router.push(`/projects/${row.project_id}`)}
        className={cn('border-b border-slate-100 cursor-pointer transition-colors', getPerformanceRowClass(row.total_profit, row.avg_roi))}
      >
        <td className="px-4 py-3 text-slate-400 text-xs">{rank ?? ''}</td>
        <td className={cn('px-4 py-3 font-medium text-slate-800 max-w-[200px]', isChild && 'pl-10 font-normal text-slate-600 text-xs')}>
          <Tooltip>
            <TooltipTrigger className="block truncate text-left w-full">{row.name}</TooltipTrigger>
            <TooltipContent>{row.name} · {row.project_id}</TooltipContent>
          </Tooltip>
        </td>
        <td className="px-4 py-3 font-mono text-xs text-slate-400">{formatCid(row.cid)}</td>
        {projectValueCells(row)}
      </tr>
    )
  }

  // A master aggregate <tr> — click toggles its children; never navigates.
  function masterRow(g: Extract<TopRow, { kind: 'master' }>, rank: number) {
    const open = expandedIds.has(g.id)
    return (
      <tr
        onClick={() => toggleExpand(g.id)}
        className={cn('border-b border-slate-100 cursor-pointer transition-colors font-medium', getPerformanceRowClass(g.profit, g.roi))}
      >
        <td className="px-4 py-3 text-slate-400 text-xs">{rank}</td>
        <td className="px-4 py-3 font-semibold text-slate-800 max-w-[200px]">
          <div className="flex items-center gap-1.5">
            {open ? <ChevronDown size={14} className="text-slate-400 shrink-0" /> : <ChevronRight size={14} className="text-slate-400 shrink-0" />}
            <span className="truncate">{g.name}</span>
          </div>
        </td>
        <td className="px-4 py-3">
          <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full whitespace-nowrap">{g.children.length} CID</span>
        </td>
        <td className="px-4 py-3 text-right font-mono text-slate-700">
          {!g.spendVisible ? '****' : g.cost > 0 ? (
            <Tooltip>
              <TooltipTrigger className="border-b border-dotted border-slate-300 cursor-help">
                {formatVND(g.cost)}
              </TooltipTrigger>
              <TooltipContent>
                <div className="flex flex-col gap-0.5 text-left min-w-[120px]">
                  <div className="flex justify-between gap-4"><span>QC</span><span className="font-mono">{formatVND(g.total_spend)}</span></div>
                  <div className="flex justify-between gap-4"><span>Thuê TK</span><span className="font-mono">{g.total_rental > 0 ? formatVND(g.total_rental) : '—'}</span></div>
                  <div className="flex justify-between gap-4"><span>CP khác</span><span className="font-mono">{g.total_other > 0 ? formatVND(g.total_other) : '—'}</span></div>
                </div>
              </TooltipContent>
            </Tooltip>
          ) : <span className="text-slate-300">—</span>}
        </td>
        <td className={cn('px-4 py-3 text-right font-mono', isScreen ? 'text-slate-300' : 'text-slate-700 font-medium')}>
          {g.revenueVisible ? formatVND(g.revenue) : '****'}
        </td>
        <td className={cn('px-4 py-3 text-right font-mono', isScreen ? 'text-amber-500 font-medium' : 'text-amber-300')}>
          {!g.revenueVisible ? '****' : g.screenRevenue > 0 ? formatVND(g.screenRevenue) : <span className="text-slate-300">—</span>}
        </td>
        <td className={cn('px-4 py-3 text-right font-mono font-semibold', !g.profitVisible ? 'text-slate-400' : isScreen ? (g.profit >= 0 ? 'text-amber-500' : 'text-red-500') : getProfitTextClass(g.profit))}>
          {g.profitVisible ? (g.profit >= 0 ? '+' : '') + formatVND(g.profit) : '****'}
        </td>
        <td className={cn('px-4 py-3 text-right font-mono text-xs font-semibold', !g.profitVisible ? 'text-slate-400' : isScreen ? (g.roi >= 0 ? 'text-amber-500' : 'text-red-500') : getRoiTextClass(g.roi))}>
          {g.profitVisible ? formatROI(g.roi) : '****'}
        </td>
      </tr>
    )
  }

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-white border-b border-slate-200 flex-wrap">
        <div className="flex items-center gap-1">
          {FILTER_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setFilter(opt.key)}
              className={cn(
                'px-2.5 py-1 text-xs rounded-full font-medium transition-colors',
                filter === opt.key
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-slate-200" />
        <button
          onClick={() => setGrouped(g => !g)}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full font-medium transition-colors',
            grouped
              ? 'bg-slate-800 text-white'
              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
          )}
        >
          <Layers size={13} /> Gom theo tổng dự án
        </button>
        <div className="ml-auto flex items-center gap-3">
          {onSearchChange && (
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm dự án..."
                value={search ?? ''}
                onChange={e => onSearchChange(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-md bg-white outline-none focus:ring-2 focus:ring-slate-300 w-44"
              />
            </div>
          )}
          <select
            value={topN ?? ''}
            onChange={e => setTopN(e.target.value ? Number(e.target.value) : null)}
            className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 outline-none focus:ring-1 focus:ring-slate-300"
          >
            {TOP_N_OPTIONS.map(opt => (
              <option key={opt.label} value={opt.value ?? ''}>{opt.label}</option>
            ))}
          </select>
          <span className="text-xs text-slate-400">
            {shownCount !== totalCount
              ? <><span className="font-medium text-slate-600">{shownCount}</span> / {totalCount} {countNoun}</>
              : <>{totalCount} {countNoun}</>
            }
          </span>
          {onExport && (
            <button
              onClick={onExport}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Download size={13} /> Export CSV
            </button>
          )}
        </div>
      </div>

      <div className="overflow-auto max-h-[calc(100vh-380px)]">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide w-10">#</th>
              {columns.map(c => (
                <th
                  key={c.key}
                  onClick={() => handleSort(c.key)}
                  className={cn(
                    'px-4 py-3 text-xs font-medium uppercase tracking-wide',
                    c.align,
                    c.icon ? 'text-amber-400' : 'text-slate-500',
                    c.sortable && 'cursor-pointer select-none hover:text-slate-700'
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.icon && <Monitor size={11} />}
                    {c.label}
                    {c.sortable && <SortIcon col={c.key} sortCol={sortCol} sortDir={sortDir} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!grouped
              ? displayed.map((row, idx) => projectRow(row, idx + 1, false))
              : groupedDisplayed.map((t, idx) =>
                  t.kind === 'project'
                    ? projectRow(t.row, idx + 1, false)
                    : (
                      <Fragment key={t.id}>
                        {masterRow(t, idx + 1)}
                        {expandedIds.has(t.id) && t.children.map(child => projectRow(child, null, true))}
                      </Fragment>
                    )
                )}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
        {shownCount !== totalCount
          ? <><span className="font-medium">{shownCount}</span> / {totalCount} {countNoun} · Click vào hàng để xem chi tiết</>
          : <>{totalCount} {countNoun} · Click vào hàng để xem chi tiết</>
        }
      </div>
    </div>
  )
}
