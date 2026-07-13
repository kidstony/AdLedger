'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  tabs: { key: string; label: ReactNode }[]
  active: string
  onChange: (key: string) => void
  className?: string
}

export default function TabBar({ tabs, active, onChange, className }: Props) {
  return (
    <div className={cn('flex gap-1 border-b border-slate-200', className)}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={cn(
            'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
            active === t.key
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
