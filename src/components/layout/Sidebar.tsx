'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { BarChart3, FolderOpen, DollarSign, LogOut, ShieldCheck, Layers, Plug, Receipt } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'

const navItems = [
  { href: '/dashboard', label: 'Dashboard P&L', icon: BarChart3, roles: ['admin', 'manager', 'employee'] },
  { href: '/master-projects', label: 'Tổng Dự Án', icon: Layers, roles: ['admin', 'manager'] },
  { href: '/projects', label: 'Quản lý dự án', icon: FolderOpen, roles: ['admin', 'manager', 'employee'] },
  { href: '/revenue', label: 'Nhập doanh thu', icon: DollarSign, roles: ['admin', 'manager', 'employee'] },
  { href: '/expenses', label: 'Nhập Chi Phí', icon: Receipt, roles: ['admin', 'manager'] },
  { href: '/admin', label: 'Quản trị hệ thống', icon: ShieldCheck, roles: ['admin'] },
  { href: '/admin/integrations', label: 'Tích hợp', icon: Plug, roles: ['admin'] },
]

const roleBadge: Record<string, { label: string; className: string }> = {
  admin:    { label: 'Quản trị',    className: 'bg-purple-900 text-purple-300' },
  manager:  { label: 'Trưởng phòng', className: 'bg-blue-900 text-blue-300' },
  employee: { label: 'Nhân viên',   className: 'bg-slate-700 text-slate-400' },
}

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, role, signOut } = useAuth()

  async function handleSignOut() {
    await signOut()
    router.push('/login')
  }

  return (
    <aside className="fixed left-0 top-0 h-screen w-60 bg-slate-900 flex flex-col z-20">
      <div className="px-6 py-5 border-b border-slate-700">
        <h1 className="text-white font-bold text-lg tracking-tight">P&L Tracker</h1>
        <p className="text-slate-400 text-xs mt-0.5">Affiliate Dashboard</p>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems
          .filter(item => !role || item.roles.includes(role))
          .map(({ href, label, icon: Icon }) => {
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

      <div className="px-4 py-4 border-t border-slate-700 space-y-2">
        {user && (
          <div className="px-2">
            <p className="text-slate-300 text-xs font-medium truncate">{user.email}</p>
            {role && (
              <span className={cn('inline-block text-[10px] px-1.5 py-0.5 rounded mt-0.5 font-medium', roleBadge[role]?.className)}>
                {roleBadge[role]?.label}
              </span>
            )}
          </div>
        )}
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 w-full px-2 py-1.5 text-slate-400 hover:text-white text-xs rounded hover:bg-slate-800 transition-colors"
        >
          <LogOut size={13} /> Đăng xuất
        </button>
      </div>
    </aside>
  )
}
