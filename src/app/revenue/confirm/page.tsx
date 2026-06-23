'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useProjectsContext } from '@/context/ProjectsContext'
import { formatVND, cn } from '@/lib/utils'
import { ChevronLeft, Loader2 } from 'lucide-react'

interface PendingRow {
  project_id: string
  project_name: string
  date: string
  amount: number
}

function weekBounds(): { from: string; to: string } {
  const today = new Date()
  const dow = today.getDay()
  const monday = new Date(today)
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const f = (d: Date) => d.toISOString().split('T')[0]
  return { from: f(monday), to: f(sunday) }
}

function Checkbox({ checked, indeterminate }: { checked: boolean; indeterminate?: boolean }) {
  return (
    <div className={cn(
      'w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
      checked ? 'bg-emerald-500 border-emerald-500' : indeterminate ? 'bg-white border-blue-400' : 'bg-white border-slate-300'
    )}>
      {checked && (
        <svg width="8" height="6" fill="none" viewBox="0 0 8 6">
          <path d="M1 3L3 5.5 7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {indeterminate && !checked && <div className="w-2 h-0.5 bg-blue-400 rounded" />}
    </div>
  )
}

export default function PaymentConfirmPage() {
  const { projects } = useProjectsContext()
  const { from: defaultFrom, to: defaultTo } = weekBounds()

  const [fromDate, setFromDate]     = useState(defaultFrom)
  const [toDate, setToDate]         = useState(defaultTo)
  const [rows, setRows]             = useState<PendingRow[]>([])
  const [selected, setSelected]     = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading]   = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [showModal, setShowModal]   = useState(false)
  const [undoItems,  setUndoItems]  = useState<{ project_id: string; date: string; amount: number }[]>([])
  const [undoMsg,    setUndoMsg]    = useState<string | null>(null)
  const [undoCountdown, setUndoCountdown] = useState(0)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const projectMap = useMemo(
    () => new Map(projects.map(p => [p.project_id, p.name])),
    [projects]
  )

  const fetchPending = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/revenue?from=${fromDate}&to=${toDate}`)
      const data: Record<string, unknown>[] = await res.json()
      const pending: PendingRow[] = data
        .filter(r => r.type === 'pending' && ((r.amount as number) ?? 0) > 0)
        .map(r => ({
          project_id:   r.project_id as string,
          project_name: projectMap.get(r.project_id as string) ?? (r.project_id as string),
          date:         r.date as string,
          amount:       r.amount as number,
        }))
        .sort((a, b) => a.date.localeCompare(b.date) || a.project_name.localeCompare(b.project_name))
      setRows(pending)
      setSelected(new Set())
    } finally {
      setIsLoading(false)
    }
  }, [fromDate, toDate, projectMap])

  useEffect(() => {
    if (projects.length > 0) fetchPending()
  }, [fetchPending, projects.length])

  const allSelected  = rows.length > 0 && selected.size === rows.length
  const someSelected = selected.size > 0 && !allSelected

  // items that will actually be confirmed: selected subset OR all rows if nothing ticked
  const confirmItems = useMemo(
    () => selected.size > 0
      ? rows.filter(r => selected.has(`${r.project_id}__${r.date}`))
      : rows,
    [rows, selected]
  )
  const confirmTotal = useMemo(
    () => confirmItems.reduce((s, r) => s + r.amount, 0),
    [confirmItems]
  )
  const selectedTotal = useMemo(
    () => rows
      .filter(r => selected.has(`${r.project_id}__${r.date}`))
      .reduce((s, r) => s + r.amount, 0),
    [rows, selected]
  )

  // date range of selected rows (used in modal text for partial selection)
  const [minSelDate, maxSelDate] = useMemo(() => {
    const dates = rows
      .filter(r => selected.has(`${r.project_id}__${r.date}`))
      .map(r => r.date)
      .sort()
    return [dates[0] ?? '', dates[dates.length - 1] ?? '']
  }, [rows, selected])

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(rows.map(r => `${r.project_id}__${r.date}`)))
  }

  function toggleRow(key: string) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
  }

  // countdown tick
  useEffect(() => {
    if (undoCountdown <= 0) return
    const t = setTimeout(() => setUndoCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [undoCountdown])

  // when countdown expires, clear undo state
  useEffect(() => {
    if (undoCountdown === 0 && undoMsg) {
      setUndoMsg(null)
      setUndoItems([])
    }
  }, [undoCountdown, undoMsg])

  async function handleConfirm() {
    setIsConfirming(true)
    const items = confirmItems.map(r => ({ project_id: r.project_id, date: r.date, amount: r.amount }))
    const total = confirmTotal

    const res = await fetch('/api/revenue/confirm-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    })

    setIsConfirming(false)
    setShowModal(false)

    if (res.ok) {
      setUndoItems(items)
      setUndoMsg(`Đã xác nhận ${items.length} khoản (${formatVND(total)})`)
      setUndoCountdown(10)
      fetchPending()
    }
  }

  async function handleUndo() {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    const items = undoItems.map(({ project_id, date }) => ({ project_id, date }))
    setUndoMsg(null)
    setUndoItems([])
    setUndoCountdown(0)
    await fetch('/api/revenue/revert-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    })
    fetchPending()
  }

  const fmtDate = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const fmtSelDateRange = () => {
    if (!minSelDate) return ''
    if (minSelDate === maxSelDate) return `ngày ${fmtDate(minSelDate)}`
    return `từ ${fmtDate(minSelDate)} đến ${fmtDate(maxSelDate)}`
  }

  const isConfirmAll = selected.size === 0

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/revenue"
          className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 transition-colors"
        >
          <ChevronLeft size={18} />
        </Link>
        <h1 className="text-lg font-semibold text-slate-800">Xác nhận thanh toán</h1>
      </div>

      {/* Date range filter */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 whitespace-nowrap">Từ ngày</span>
          <input
            type="date" value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="text-xs border border-slate-200 rounded-md px-2 py-1.5 outline-none focus:ring-2 focus:ring-slate-200"
          />
        </div>
        <span className="text-slate-300">—</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 whitespace-nowrap">Đến ngày</span>
          <input
            type="date" value={toDate}
            onChange={e => setToDate(e.target.value)}
            className="text-xs border border-slate-200 rounded-md px-2 py-1.5 outline-none focus:ring-2 focus:ring-slate-200"
          />
        </div>
      </div>

      {/* Table card */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">

        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/60">
          <button
            onClick={toggleAll}
            className="flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-slate-800 transition-colors"
          >
            <Checkbox checked={allSelected} indeterminate={someSelected} />
            {allSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
          </button>

          <div className="text-xs text-slate-500">
            {selected.size > 0 ? (
              <>
                <span className="font-semibold text-slate-700">{selected.size}</span> khoản đã chọn
                {' · '}
                <span className="font-semibold text-emerald-700">{formatVND(selectedTotal)}</span>
              </>
            ) : (
              <span>{rows.length} khoản chờ xác nhận</span>
            )}
          </div>
        </div>

        {/* Column header */}
        {!isLoading && rows.length > 0 && (
          <div className="grid grid-cols-[28px_1fr_auto_auto] gap-3 px-4 py-2 border-b border-slate-100 bg-slate-50/30">
            <div />
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Dự án</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Ngày</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 text-right">Số tiền</div>
          </div>
        )}

        {/* Body */}
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-14 text-slate-400 text-sm">
            <Loader2 size={16} className="animate-spin" /> Đang tải...
          </div>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center">
            <div className="text-sm text-slate-400 mb-1">Không có khoản nào đang chờ xác nhận</div>
            <div className="text-xs text-slate-300">trong khoảng thời gian đã chọn</div>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {rows.map(row => {
              const key     = `${row.project_id}__${row.date}`
              const checked = selected.has(key)
              return (
                <div
                  key={key}
                  onClick={() => toggleRow(key)}
                  className={cn(
                    'grid grid-cols-[28px_1fr_auto_auto] gap-3 items-center px-4 py-3 cursor-pointer transition-colors hover:bg-slate-50',
                    checked && 'bg-emerald-50/50 hover:bg-emerald-50/70'
                  )}
                >
                  <Checkbox checked={checked} />
                  <div className="text-sm font-medium text-slate-700 truncate">{row.project_name}</div>
                  <div className="text-xs text-slate-400 whitespace-nowrap">{fmtDate(row.date)}</div>
                  <div className="font-mono text-sm font-semibold text-slate-800 text-right">{formatVND(row.amount)}</div>
                </div>
              )
            })}
          </div>
        )}

        {/* Footer */}
        {!isLoading && (
          <div className="px-4 py-3 border-t border-slate-100">
            {rows.length > 0 && (
              <div className="flex items-center justify-between mb-2.5 text-xs">
                {isConfirmAll
                  ? <span className="text-slate-500">Tất cả {rows.length} khoản</span>
                  : <span className="text-slate-500">{selected.size} khoản đã chọn</span>
                }
                <span className="font-semibold text-slate-800">{formatVND(confirmTotal)}</span>
              </div>
            )}
            <button
              onClick={() => setShowModal(true)}
              disabled={rows.length === 0}
              className={cn(
                'w-full py-2.5 rounded-lg text-sm font-semibold transition-colors',
                rows.length > 0
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800'
                  : 'bg-slate-100 text-slate-300 cursor-not-allowed'
              )}
            >
              {isConfirmAll
                ? `Xác nhận tất cả (${rows.length} khoản)`
                : `Xác nhận ${selected.size} khoản đã chọn`}
            </button>
          </div>
        )}
      </div>

      {/* Confirmation modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-5 w-[340px]">
            <h3 className="font-semibold text-slate-800 mb-2">Xác nhận thanh toán</h3>
            <p className="text-sm text-slate-600 mb-4">
              {isConfirmAll ? (
                <>
                  Xác nhận <span className="font-semibold">tất cả {rows.length} khoản</span> pending{' '}
                  từ <span className="font-semibold">{fmtDate(fromDate)}</span> đến{' '}
                  <span className="font-semibold">{fmtDate(toDate)}</span>, tổng{' '}
                  <span className="font-semibold text-emerald-700">{formatVND(confirmTotal)}</span>?
                </>
              ) : (
                <>
                  Xác nhận <span className="font-semibold">{selected.size} khoản</span> đã chọn,{' '}
                  tổng <span className="font-semibold text-emerald-700">{formatVND(confirmTotal)}</span>{' '}
                  {fmtSelDateRange()}?
                </>
              )}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                disabled={isConfirming}
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                onClick={handleConfirm}
                disabled={isConfirming}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-60"
              >
                {isConfirming && <Loader2 size={10} className="animate-spin" />}
                Đồng ý, xác nhận
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast with undo */}
      {undoMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-800 text-white text-sm px-4 py-3 rounded-lg shadow-lg flex items-center gap-3">
          <svg width="14" height="14" fill="none" viewBox="0 0 14 14">
            <path d="M2.5 7L5.5 10 11.5 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{undoMsg}</span>
          <button
            onClick={handleUndo}
            className="flex items-center gap-1.5 ml-2 px-2.5 py-1 text-xs font-semibold bg-white/15 hover:bg-white/25 rounded-md transition-colors"
          >
            ↩ Hoàn tác
          </button>
          <span className="text-slate-400 text-xs tabular-nums">{undoCountdown}s</span>
        </div>
      )}
    </div>
  )
}
