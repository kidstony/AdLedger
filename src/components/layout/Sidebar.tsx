'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, FolderOpen, DollarSign } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/dashboard', label: 'Dashboard P&L', icon: BarChart3 },
  { href: '/projects', label: 'Quản lý dự án', icon: FolderOpen },
  { href: '/revenue', label: 'Nhập doanh thu', icon: DollarSign },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="fixed left-0 top-0 h-screen w-60 bg-slate-900 flex flex-col z-20">
      <div className="px-6 py-5 border-b border-slate-700">
        <h1 className="text-white font-bold text-lg tracking-tight">P&L Tracker</h1>
        <p className="text-slate-400 text-xs mt-0.5">Affiliate Dashboard</p>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
                active
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              )}
            >
              <Icon size={16} />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="px-6 py-3 border-t border-slate-700">
        <p className="text-slate-500 text-xs">100 CID · 10 MCC</p>
      </div>
    </aside>
  )
}
