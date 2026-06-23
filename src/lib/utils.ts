import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { PnlDaily, PnlSummary, DateRange } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const usdFormatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function formatVND(amount: number): string {
  return '$' + usdFormatter.format(amount)
}

export function formatVNDFull(amount: number): string {
  return '$' + usdFormatter.format(amount)
}

export function formatROI(roi: number): string {
  return roi.toFixed(1) + '%'
}

export function getProfitRowClass(profit: number): string {
  return profit < 0
    ? 'bg-red-50 hover:bg-red-100'
    : 'bg-white hover:bg-slate-50'
}

export function getProfitTextClass(profit: number): string {
  return profit < 0 ? 'text-red-600' : 'text-green-600'
}

export function getRoiTextClass(roi: number): string {
  if (roi < 0) return 'text-red-600'
  if (roi > 100) return 'text-emerald-700 font-semibold'
  return 'text-green-600'
}

export function aggregatePnl(daily: PnlDaily[], dateRange: DateRange): PnlSummary[] {
  const from = dateRange.from.toISOString().split('T')[0]
  const to = dateRange.to.toISOString().split('T')[0]

  const filtered = daily.filter(r => r.date >= from && r.date <= to)

  const map = new Map<string, PnlSummary>()

  filtered.forEach(row => {
    const existing = map.get(row.project_id)
    if (!existing) {
      map.set(row.project_id, {
        project_id: row.project_id,
        cid: row.cid,
        name: row.name,
        mcc_id: '',
        total_spend: row.spend,
        total_revenue: row.revenue,
        total_profit: row.profit,
        avg_roi: 0,
        total_screen_revenue: 0,
        total_pending: 0,
      })
    } else {
      existing.total_spend += row.spend
      existing.total_revenue += row.revenue
      existing.total_profit += row.profit
    }
  })

  map.forEach(summary => {
    summary.avg_roi = summary.total_spend > 0
      ? (summary.total_profit / summary.total_spend) * 100
      : 0
  })

  return Array.from(map.values())
}

export function getDefaultDateRange(): DateRange {
  const to = new Date('2026-06-21')
  const from = new Date('2026-06-21')
  from.setDate(from.getDate() - 29)
  return { from, to }
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function formatCid(cid: string): string {
  const digits = cid.replace(/\D/g, '')
  if (digits.length !== 10) return cid
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
}
