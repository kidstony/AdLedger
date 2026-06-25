'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { BarChart3, FolderOpen, DollarSign, LogOut, Layers, Plug, Receipt, Building2, Users, UsersRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'

const roleBadge: Record<string, { label: string; className: string }> = {
  super_admin: { label: 'Super Admin', className: 'bg-red-900 text-red-300' },
  manager:     { label: 'Manager',     className: 'bg-blue-900 text-blue-300' },
  member:      { label: 'Member',      className: 'bg-slate-700 text-slate-400' },
  admin:       { label: 'Admin',       className: 'bg-purple-900 text-purple-300' },
  employee:    { label: 'Nhân viên',   className: 'bg-slate-700 text-slate-400' },
}

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, role, teamId, signOut } = useAuth()

  const mainItems = [
    { href: '/dashboard',          label: 'Dashboard P&L',    icon: BarChart3,  roles: ['super_admin', 'manager', 'member', 'admin', 'employee'] },
    { href: '/master-projects',    label: 'Tổng Dự Án',       icon: Layers,     roles: ['super_admin', 'manager', 'admin'] },
    { href: '/projects',           label: 'Quản lý dự án',    icon: FolderOpen, roles: ['super_admin', 'manager', 'member', 'admin', 'employee'] },
    { href: '/revenue',            label: 'Nhập doanh thu',   icon: DollarSign, roles: ['super_admin', 'manager', 'admin'] },
    { href: '/expenses',           label: 'Nhập Chi Phí',     icon: Receipt,    roles: ['super_admin', 'manager', 'admin'] },
    { href: '/banks',              label: 'Quản lý Bank',     icon: Building2,  roles: ['super_admin', 'manager', 'admin'] },
    { href: teamId ? `/teams/${teamId}` : '#', label: 'Thành viên team', icon: UsersRound, roles: ['manager'] },
    { href: '/admin/integrations', label: 'Tích hợp',         icon: Plug,       roles: ['super_admin', 'admin'] },
  ]

  const adminItems = [
    { href: '/teams', label: 'Quản lý Team', icon: UsersRound },
    { href: '/users', label: 'Quản lý User', icon: Users },
  ]

  async function handleSignOut() {
    await signOut()
    router.push('/login')
  }

  const visibleMain = mainItems.filter(item => !role || item.roles.includes(role))

  function NavLink({ href, label, icon: Icon }: { href: string; label: string; icon: React.ElementType }) {
    const active = pathname === href || (href !== '/dashboard' && href !== '#' && pathname.startsWith(href + '/'))
    return (
      <Link
        href={href}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
          active ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
        )}
      >
        <Icon size={16} />
        {label}
      </Link>
    )
  }

  return (
    <aside className="fixed left-0 top-0 h-screen w-60 bg-slate-900 flex flex-col z-20">
      <div className="px-6 py-5 border-b border-slate-700">
        <h1 className="text-white font-bold text-lg tracking-tight">P&L Tracker</h1>
        <p className="text-slate-400 text-xs mt-0.5">Affiliate Dashboard</p>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {visibleMain.map(item => <NavLink key={item.href} {...item} />)}

        {role === 'super_admin' && (
          <>
            <div className="px-3 pt-3 pb-1">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Quản trị</p>
            </div>
            {adminItems.map(item => <NavLink key={item.href} {...item} />)}
          </>
        )}
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
