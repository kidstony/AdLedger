import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type StatusTone = 'green' | 'amber' | 'red' | 'blue' | 'indigo' | 'slate'

// Class tĩnh (không nội suy) để Tailwind giữ lại khi purge.
const TONES: Record<StatusTone, string> = {
  green: 'bg-green-50 text-green-700 border-green-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  slate: 'bg-slate-100 text-slate-500 border-slate-200',
}

interface Props {
  tone: StatusTone
  icon?: LucideIcon
  spin?: boolean
  className?: string
  children: ReactNode
}

export default function StatusPill({ tone, icon: Icon, spin, className, children }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {Icon && <Icon size={11} className={spin ? 'animate-spin' : undefined} />}
      {children}
    </span>
  )
}
