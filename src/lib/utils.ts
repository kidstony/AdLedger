import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { PnlDaily, PnlSummary, DateRange, UserRole } from './types'

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

export function formatMoneyByRole(value: number, role: UserRole | null, formatter: (v: number) => string): string {
  if (role === 'member') return '****'
  return formatter(value)
}

export function getPerformanceRowClass(profit: number, roi: number): string {
  if (profit < 0) return 'bg-red-50 hover:bg-red-100'
  if (roi >= 100)  return 'bg-green-50 hover:bg-green-100'
  if (roi >= 50)   return 'bg-emerald-50 hover:bg-emerald-100'
  return 'bg-white hover:bg-slate-50'
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
        total_rental: 0,
        total_other: 0,
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
  const to = new Date()
  const from = new Date(to.getFullYear(), to.getMonth(), 1)
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

export function exportToCsv(rows: Record<string, string | number | null | undefined>[], filename: string) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const esc = (v: string | number | null | undefined) => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))]
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
