'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Command } from 'cmdk'
import { Search, LayoutDashboard, FolderKanban, DollarSign, Receipt, Building2, Settings, Layers, X } from 'lucide-react'
import { useProjectsContext } from '@/context/ProjectsContext'

const PAGES = [
  { label: 'Dashboard P&L',     path: '/dashboard',        icon: <LayoutDashboard size={14} /> },
  { label: 'Tổng Dự Án',        path: '/master-projects',  icon: <Layers size={14} /> },
  { label: 'Quản lý dự án',     path: '/projects',         icon: <FolderKanban size={14} /> },
  { label: 'Nhập doanh thu',    path: '/revenue',           icon: <DollarSign size={14} /> },
  { label: 'Nhập chi phí',      path: '/expenses',          icon: <Receipt size={14} /> },
  { label: 'Quản lý Bank',      path: '/banks',             icon: <Building2 size={14} /> },
  { label: 'Quản trị hệ thống', path: '/admin',             icon: <Settings size={14} /> },
]

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const { projects } = useProjectsContext()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const navigate = useCallback((path: string) => {
    router.push(path)
    setOpen(false)
  }, [router])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[20vh]">
      <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-lg mx-4">
        <Command className="bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
          <div className="flex items-center gap-2 px-4 border-b border-slate-200">
            <Search size={16} className="text-slate-400 shrink-0" />
            <Command.Input
              placeholder="Tìm trang, dự án..."
              className="flex-1 py-3.5 text-sm outline-none placeholder:text-slate-400 bg-transparent"
              autoFocus
            />
            <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-slate-100 text-slate-400 transition-colors">
              <X size={14} />
            </button>
          </div>

          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="py-8 text-center text-sm text-slate-400">
              Không tìm thấy kết quả.
            </Command.Empty>

            <Command.Group heading="Trang" className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-slate-400 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
              {PAGES.map(page => (
                <Command.Item
                  key={page.path}
                  value={page.label}
                  onSelect={() => navigate(page.path)}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-700 cursor-pointer aria-selected:bg-slate-100 aria-selected:text-slate-900 transition-colors"
                >
                  <span className="text-slate-400">{page.icon}</span>
                  {page.label}
                </Command.Item>
              ))}
            </Command.Group>

            {projects.length > 0 && (
              <Command.Group heading="Dự án" className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-slate-400 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 mt-1">
                {projects.map(p => (
                  <Command.Item
                    key={p.project_id}
                    value={`${p.name} ${p.project_id}`}
                    onSelect={() => navigate(`/projects/${p.project_id}`)}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm cursor-pointer aria-selected:bg-slate-100 transition-colors"
                  >
                    <FolderKanban size={14} className="text-slate-400 shrink-0" />
                    <span className="text-slate-700 truncate">{p.name}</span>
                    <span className="ml-auto font-mono text-xs text-slate-400 shrink-0">{p.project_id}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>

          <div className="border-t border-slate-100 px-3 py-2 flex items-center gap-3 text-xs text-slate-400">
            <span><kbd className="font-mono bg-slate-100 px-1 rounded">↑↓</kbd> điều hướng</span>
            <span><kbd className="font-mono bg-slate-100 px-1 rounded">↵</kbd> chọn</span>
            <span><kbd className="font-mono bg-slate-100 px-1 rounded">Esc</kbd> đóng</span>
          </div>
        </Command>
      </div>
    </div>
  )
}
