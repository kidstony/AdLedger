'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { PnlSummary, SortColumn, SortDirection } from '@/lib/types'
import { formatVND, formatROI, getProfitRowClass, getProfitTextClass, getRoiTextClass, cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface Props {
  data: PnlSummary[]
  isLoading: boolean
}

const columns: { key: SortColumn | 'cid'; label: string; sortable: boolean; align: string }[] = [
  { key: 'name', label: 'Tên dự án', sortable: true, align: 'text-left' },
  { key: 'cid', label: 'CID', sortable: false, align: 'text-left' },
  { key: 'total_spend', label: 'Chi phí', sortable: true, align: 'text-right' },
  { key: 'total_revenue', label: 'Doanh thu', sortable: true, align: 'text-right' },
  { key: 'total_profit', label: 'Lợi nhuận', sortable: true, align: 'text-right' },
  { key: 'avg_roi', label: 'ROI%', sortable: true, align: 'text-right' },
]

function SortIcon({ col, sortCol, sortDir }: { col: string; sortCol: string; sortDir: SortDirection }) {
  if (col !== sortCol) return <ArrowUpDown size={12} className="text-slate-400" />
  return sortDir === 'asc'
    ? <ArrowUp size={12} className="text-slate-600" />
    : <ArrowDown size={12} className="text-slate-600" />
}

export default function PnlTable({ data, isLoading }: Props) {
  const router = useRouter()
  const [sortCol, setSortCol] = useState<SortColumn>('total_profit')
  const [sortDir, setSortDir] = useState<SortDirection>('asc')

  function handleSort(col: string) {
    if (col === 'cid') return
    const c = col as SortColumn
    if (c === sortCol) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(c)
      setSortDir('asc')
    }
  }

  const sorted = [...data].sort((a, b) => {
    const av = a[sortCol]
    const bv = b[sortCol]
    if (typeof av === 'string' && typeof bv === 'string') {
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    }
    return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
  })

  if (isLoading) {
    return (
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide w-10">#</th>
              {columns.map(c => (
                <th key={c.key} className={cn('px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide', c.align)}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 10 }).map((_, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="px-4 py-3"><div className="h-4 bg-slate-200 rounded animate-pulse w-6" /></td>
                {columns.map(c => (
                  <td key={c.key} className="px-4 py-3">
                    <div className="h-4 bg-slate-200 rounded animate-pulse" style={{ width: c.key === 'name' ? '160px' : '80px' }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="border border-slate-200 rounded-lg p-12 text-center">
        <p className="text-slate-500 text-sm">Không có dữ liệu trong khoảng thời gian này.</p>
      </div>
    )
  }

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="overflow-auto max-h-[calc(100vh-340px)]">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide w-10">#</th>
              {columns.map(c => (
                <th
                  key={c.key}
                  onClick={() => handleSort(c.key)}
                  className={cn(
                    'px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide',
                    c.align,
                    c.sortable && 'cursor-pointer select-none hover:text-slate-700'
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {c.sortable && <SortIcon col={c.key} sortCol={sortCol} sortDir={sortDir} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, idx) => (
              <tr
                key={row.project_id}
                onClick={() => router.push(`/projects/${row.project_id}`)}
                className={cn('border-b border-slate-100 cursor-pointer transition-colors', getProfitRowClass(row.total_profit))}
              >
                <td className="px-4 py-3 text-slate-400 text-xs">{idx + 1}</td>
                <td className="px-4 py-3 font-medium text-slate-800 max-w-[200px]">
                  <Tooltip>
                    <TooltipTrigger className="block truncate text-left w-full">{row.name}</TooltipTrigger>
                    <TooltipContent>{row.name} · {row.project_id}</TooltipContent>
                  </Tooltip>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-400">{row.cid}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-700">{formatVND(row.total_spend)}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-700">{formatVND(row.total_revenue)}</td>
                <td className={cn('px-4 py-3 text-right font-mono font-medium', getProfitTextClass(row.total_profit))}>
                  {row.total_profit >= 0 ? '+' : ''}{formatVND(row.total_profit)}
                </td>
                <td className={cn('px-4 py-3 text-right font-mono text-xs', getRoiTextClass(row.avg_roi))}>
                  {formatROI(row.avg_roi)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
        {sorted.length} dự án · Click vào hàng để xem chi tiết
      </div>
    </div>
  )
}
