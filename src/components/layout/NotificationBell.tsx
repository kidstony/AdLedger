'use client'

import { useState, useEffect, useRef } from 'react'
import { Bell, CheckCheck, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { AppNotification } from '@/lib/types'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const POLL_INTERVAL = 2 * 60 * 1000 // 2 phút

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  async function authFetch(url: string, opts?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession()
    return fetch(url, {
      ...opts,
      headers: { ...opts?.headers, 'Authorization': `Bearer ${session?.access_token ?? ''}` },
    })
  }

  async function fetchNotifications(showToast: boolean) {
    const res = await authFetch('/api/notifications')
    if (!res.ok) return
    const data: AppNotification[] = await res.json()

    if (showToast) {
      // Use functional updater to access current state without stale closure
      setNotifications(prev => {
        const prevIds = new Set(prev.map(n => n.id))
        const newUnread = data.filter(n => !n.is_read && !prevIds.has(n.id))
        newUnread.forEach(n => toast(n.title, { description: n.body ?? undefined, icon: '🔔' }))
        return data
      })
    } else {
      setNotifications(data)
    }
  }

  useEffect(() => {
    fetchNotifications(false)
    const interval = setInterval(() => fetchNotifications(true), POLL_INTERVAL)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const unread = notifications.filter(n => !n.is_read)

  async function markRead(id: string) {
    await authFetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
  }

  async function markAllRead() {
    await authFetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
  }

  function formatTime(dt: string) {
    const diff = Date.now() - new Date(dt).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'Vừa xong'
    if (m < 60) return `${m} phút trước`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h} giờ trước`
    return new Date(dt).toLocaleDateString('vi-VN')
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-1.5 text-slate-400 hover:text-white transition-colors rounded-md hover:bg-slate-800"
        aria-label="Thông báo"
      >
        <Bell size={16} />
        {unread.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-80 bg-white border border-slate-200 rounded-lg shadow-xl z-50">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-100">
            <span className="text-sm font-semibold text-slate-800">
              Thông báo {unread.length > 0 && <span className="text-red-500">({unread.length})</span>}
            </span>
            <div className="flex items-center gap-1">
              {unread.length > 0 && (
                <button onClick={markAllRead}
                  className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
                  <CheckCheck size={12} /> Đọc tất cả
                </button>
              )}
              <button onClick={() => setOpen(false)} className="ml-1 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">Không có thông báo nào</div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  onClick={() => {
                    markRead(n.id)
                    if (n.project_id) router.push(`/projects?tab=manage&highlight=${n.project_id}`)
                    setOpen(false)
                  }}
                  className={cn(
                    'px-3 py-2.5 border-b border-slate-50 cursor-pointer hover:bg-slate-50 transition-colors',
                    !n.is_read && 'bg-blue-50/50'
                  )}
                >
                  <div className="flex items-start gap-2">
                    <Bell size={12} className={cn('mt-0.5 shrink-0', n.is_read ? 'text-slate-400' : 'text-amber-500')} />
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-xs', n.is_read ? 'text-slate-600' : 'text-slate-800 font-medium')}>
                        {n.title}
                      </p>
                      {n.body && <p className="text-xs text-slate-400 truncate mt-0.5">{n.body}</p>}
                      <p className="text-[10px] text-slate-400 mt-0.5">{formatTime(n.created_at)}</p>
                    </div>
                    {!n.is_read && <span className="w-1.5 h-1.5 bg-blue-500 rounded-full shrink-0 mt-1" />}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
