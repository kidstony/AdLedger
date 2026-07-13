'use client'

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  label: string
  value?: ReactNode
  valueClass?: string // màu theo DESIGN_SYSTEM ('text-amber-500'…), caller quyết định
  icon?: LucideIcon
  iconWrapClass?: string // vd 'bg-blue-50 text-blue-600'
  sub?: ReactNode // dòng phụ dưới value (ref value / breakdown)
  active?: boolean // chế độ card-as-tab (expenses)
  onClick?: () => void
  loading?: boolean
}

export default function StatCard({
  label, value, valueClass, icon: Icon, iconWrapClass, sub, active, onClick, loading,
}: Props) {
  const body = (
    <>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
        {Icon && (
          <div className={cn('p-1.5 rounded-md', iconWrapClass ?? 'bg-slate-50 text-slate-600')}>
            <Icon size={14} />
          </div>
        )}
      </div>
      {loading ? (
        <div className="h-7 w-24 bg-slate-200 rounded animate-pulse" />
      ) : (
        <p className={cn('text-xl font-semibold', valueClass ?? 'text-slate-700')}>{value}</p>
      )}
      {sub && <div className="text-xs text-slate-400 mt-1.5">{sub}</div>}
    </>
  )

  const cls = cn(
    'bg-white rounded-lg border p-5 shadow-sm',
    active ? 'border-slate-400 ring-1 ring-slate-300' : 'border-slate-200',
    onClick && 'text-left w-full cursor-pointer transition-colors hover:border-slate-300',
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {body}
      </button>
    )
  }
  return <div className={cls}>{body}</div>
}
