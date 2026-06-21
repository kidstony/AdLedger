'use client'

import { usePathname } from 'next/navigation'
import Sidebar from './Sidebar'

const AUTH_PAGES = ['/login']

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (AUTH_PAGES.includes(pathname)) return <>{children}</>

  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar />
      <main className="ml-60 min-h-screen">
        {children}
      </main>
    </div>
  )
}
