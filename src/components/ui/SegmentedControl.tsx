'use client'

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SegOption {
  value: string
  label: ReactNode
  icon?: LucideIcon
  activeClass?: string // màu chữ khi active, vd 'text-amber-600' cho "Tiền màn hình"
}

interface Props {
  options: SegOption[]
  value: string
  onChange: (v: string) => void
  size?: 'sm' | 'md'
  className?: string
}

export default function SegmentedControl({ options, value, onChange, size = 'md', className }: Props) {
  return (
    <div className={cn('flex items-center gap-1 bg-slate-100 rounded-lg p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value
        const Icon = o.icon
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              'flex items-center gap-1.5 font-medium rounded-md transition-colors',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
              active
                ? cn('bg-white shadow-sm', o.activeClass ?? 'text-slate-800')
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {Icon && <Icon size={size === 'sm' ? 13 : 14} />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
