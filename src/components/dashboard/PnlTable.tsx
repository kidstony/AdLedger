'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUp, ArrowDown, ArrowUpDown, Monitor } from 'lucide-react'
import { PnlSummary, SortColumn, SortDirection } from '@/lib/types'
import { formatVND, formatROI, getPerformanceRowClass, getProfitTextClass, getRoiTextClass, formatMoneyByRole, cn, formatCid } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import TableSkeleton from '@/components/ui/TableSkeleton'
import EmptyState from '@/components/ui/EmptyState'
import { useAuth } from '@/context/AuthContext'

interface Props {
  data: PnlSummary[]
  isLoading: boolean
}

const columns: { key: string; label: string; sortable: boolean; align: string; icon?: boolean }[] = [
  { key: 'name',                 label: 'Tên dự án',      sortable: true,  align: 'text-left' },
  { key: 'cid',                  label: 'CID',             sortable: false, align: 'text-left' },
  { key: 'total_spend',          label: 'Chi phí QC',      sortable: true,  align: 'text-right' },
  { key: 'total_rental',         label: 'Thuê TK',         sortable: true,  align: 'text-right' },
  { key: 'total_other',          label: 'CP Khác',         sortable: true,  align: 'text-right' },
  { key: 'total_revenue',        label: 'Doanh thu',       sortable: true,  align: 'text-right' },
  { key: 'total_screen_revenue', label: 'DT Màn hình',     sortable: false, align: 'text-right', icon: true },
  { key: 'total_profit',         label: 'Lợi nhuận',       sortable: true,  align: 'text-right' },
  { key: 'est_profit',           label: 'LN ước tính',     sortable: false, align: 'text-right', icon: true },
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

const nonSortable = new Set(['cid', 'total_screen_revenue', 'est_profit'])

export default function PnlTable({ data, isLoading }: Props) {
  const router = useRouter()
  const { role } = useAuth()
  const fmt = (v: number) => formatMoneyByRole(v, role, formatVND)
  const fmtRoi = (v: number) => role === 'member' ? '****' : formatROI(v)
  const [sortCol, setSortCol] = useState<SortColumn>('avg_roi')
  const [sortDir, setSortDir] = useState<SortDirection>('desc')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [topN, setTopN] = useState<number | null>(null)

  function handleSort(col: string) {
    if (nonSortable.has(col)) return
    const c = col as SortColumn
    if (c === sortCol) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(c)
      setSortDir('asc')
    }
  }

  const sorted = useMemo(() => [...data].sort((a, b) => {
    const av = a[sortCol]
    const bv = b[sortCol]
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

  if (isLoading) return <TableSkeleton rows={10} cols={columns.length + 1} />

  if (data.length === 0) return <EmptyState message="Không có dữ liệu trong khoảng thời gian này." />

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
        <div className="ml-auto flex items-center gap-3">
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
            {displayed.length !== data.length
              ? <><span className="font-medium text-slate-600">{displayed.length}</span> / {data.length} dự án</>
              : <>{data.length} dự án</>
            }
          </span>
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
            {displayed.map((row, idx) => (
              <tr
                key={row.project_id}
                onClick={() => router.push(`/projects/${row.project_id}`)}
                className={cn('border-b border-slate-100 cursor-pointer transition-colors', getPerformanceRowClass(row.total_profit, row.avg_roi))}
              >
                <td className="px-4 py-3 text-slate-400 text-xs">{idx + 1}</td>
                <td className="px-4 py-3 font-medium text-slate-800 max-w-[200px]">
                  <Tooltip>
                    <TooltipTrigger className="block truncate text-left w-full">{row.name}</TooltipTrigger>
                    <TooltipContent>{row.name} · {row.project_id}</TooltipContent>
                  </Tooltip>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-400">{formatCid(row.cid)}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-700">{fmt(row.total_spend)}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-500">
                  {row.total_rental > 0 ? fmt(row.total_rental) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-right font-mono text-slate-500">
                  {row.total_other > 0 ? fmt(row.total_other) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-right font-mono text-slate-700">{fmt(row.total_revenue)}</td>
                <td className="px-4 py-3 text-right font-mono text-amber-500">
                  {row.total_screen_revenue > 0 ? fmt(row.total_screen_revenue) : <span className="text-slate-300">—</span>}
                </td>
                <td className={cn('px-4 py-3 text-right font-mono font-medium', role === 'member' ? 'text-slate-400' : getProfitTextClass(row.total_profit))}>
                  {role === 'member' ? '****' : (row.total_profit >= 0 ? '+' : '') + formatVND(row.total_profit)}
                </td>
                {(() => {
                  const totalCost = row.total_spend + row.total_rental + row.total_other
                  const est = row.total_revenue + row.total_screen_revenue - totalCost
                  return (
                    <td className={cn('px-4 py-3 text-right font-mono font-medium', role === 'member' ? 'text-slate-400' : row.total_screen_revenue > 0 ? (est >= 0 ? 'text-amber-500' : 'text-red-500') : 'text-slate-300')}>
                      {role === 'member' ? '****' : row.total_screen_revenue > 0 ? (est >= 0 ? '+' : '') + formatVND(est) : '—'}
                    </td>
                  )
                })()}
                <td className={cn('px-4 py-3 text-right font-mono text-xs', role === 'member' ? 'text-slate-400' : getRoiTextClass(row.avg_roi))}>
                  {fmtRoi(row.avg_roi)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
        {displayed.length !== data.length
          ? <><span className="font-medium">{displayed.length}</span> / {data.length} dự án · Click vào hàng để xem chi tiết</>
          : <>{data.length} dự án · Click vào hàng để xem chi tiết</>
        }
      </div>
    </div>
  )
}
