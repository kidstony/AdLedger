'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { toast as sonnerToast } from 'sonner'
import { useProjectsContext } from '@/context/ProjectsContext'
import { supabase } from '@/lib/supabase'

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? ''
}

export type ViewMode = 'day' | 'week' | 'month' | 'all' | 'custom'
export type RevenueTab = 'revenue' | 'screen'

type HistoryChange = { key: string; tab: RevenueTab; old: number | undefined; val: number | undefined }
type HistoryEntry  = { changes: HistoryChange[] }

function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayStr(): string { return localDateStr(new Date()) }

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return localDateStr(d)
}

function addMonths(date: string, n: number): string {
  const d = new Date(date.slice(0, 7) + '-01T00:00:00')
  d.setMonth(d.getMonth() + n)
  return localDateStr(d).slice(0, 7) + '-01'
}

function getWeekDates(anchor: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(anchor, i - 6))
}

function getMonthDates(firstDay: string): string[] {
  const [y, m] = firstDay.slice(0, 7).split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  return Array.from({ length: days }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)
}

// New schema: one row per (project_id, date, type)
type RevenueRow = {
  project_id: string
  date: string
  type: 'confirmed' | 'pending'
  amount: number
  note?: string | null
  payout_start_date?: string | null
  payout_end_date?: string | null
  confirmed_at?: string | null
  cycle_end?: boolean | null
}

export function useRevenueGrid() {
  const { projects } = useProjectsContext()
  const today = todayStr()

  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [anchorDate, setAnchorDate] = useState(today)
  const [selectedDate, setSelectedDate] = useState(today)
  const [customFrom, setCustomFrom] = useState(() => addDays(today, -6))
  const [customTo,   setCustomTo]   = useState(today)
  const [refreshKey, setRefreshKey] = useState(0)
  const [activeTab, setActiveTab] = useState<RevenueTab>('screen')
  const [isLoading, setIsLoading] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  const [revenueGrid, setRevenueGrid] = useState<Map<string, number>>(new Map())
  const [screenGrid,  setScreenGrid]  = useState<Map<string, number>>(new Map())

  // Per-tab pending/cleared tracking (revenue tab = 'confirmed' type, screen tab = 'pending' type)
  const pendingRevenueKeysRef = useRef<Set<string>>(new Set())
  const pendingScreenKeysRef  = useRef<Set<string>>(new Set())
  const clearedRevenueRef     = useRef<Set<string>>(new Set())
  const clearedScreenRef      = useRef<Set<string>>(new Set())

  const revenueGridRef = useRef<Map<string, number>>(new Map())
  const screenGridRef  = useRef<Map<string, number>>(new Map())
  useEffect(() => { revenueGridRef.current = revenueGrid }, [revenueGrid])
  useEffect(() => { screenGridRef.current  = screenGrid  }, [screenGrid])

  const [prevScreenMap, setPrevScreenMap] = useState<Map<string, number>>(new Map())
  const [prevCycleEndMap, setPrevCycleEndMap] = useState<Map<string, boolean>>(new Map())
  const [cycleEndMap,    setCycleEndMap]   = useState<Map<string, boolean>>(new Map())
  const [noteMap,        setNoteMap]       = useState<Map<string, string>>(new Map())
  const [payoutMap,      setPayoutMap]     = useState<Map<string, { start: string; end: string }>>(new Map())
  const [statusMap,      setStatusMap]     = useState<Map<string, 'pending' | 'confirmed'>>(new Map())
  const [confirmedAtMap, setConfirmedAtMap] = useState<Map<string, string>>(new Map())

  // Undo / Redo
  const historyRef  = useRef<HistoryEntry[]>([])
  const futureRef   = useRef<HistoryEntry[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2000)
  }

  function syncUndoRedoState() {
    setCanUndo(historyRef.current.length > 0)
    setCanRedo(futureRef.current.length > 0)
  }

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const executeSave = useCallback(async () => {
    if (pendingRevenueKeysRef.current.size === 0 && pendingScreenKeysRef.current.size === 0) return
    setSaveStatus('saving')

    const revKeys = Array.from(pendingRevenueKeysRef.current)
    const scnKeys = Array.from(pendingScreenKeysRef.current)
    pendingRevenueKeysRef.current.clear()
    pendingScreenKeysRef.current.clear()

    const rows = [
      ...revKeys.map(key => {
        const sep = key.indexOf('__')
        return {
          project_id: key.slice(0, sep),
          date: key.slice(sep + 2),
          type: 'confirmed' as const,
          amount: clearedRevenueRef.current.has(key) ? 0 : (revenueGridRef.current.get(key) ?? 0),
        }
      }),
      ...scnKeys.map(key => {
        const sep = key.indexOf('__')
        return {
          project_id: key.slice(0, sep),
          date: key.slice(sep + 2),
          type: 'pending' as const,
          amount: clearedScreenRef.current.has(key) ? 0 : (screenGridRef.current.get(key) ?? 0),
        }
      }),
    ]

    try {
      const token = await getToken()
      const res = await fetch('/api/revenue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rows }),
      })
      if (res.ok) {
        clearedRevenueRef.current.clear()
        clearedScreenRef.current.clear()
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 3000)
      } else {
        const body = await res.json().catch(() => ({}))
        sonnerToast.error(`Lưu thất bại: ${body?.error ?? res.status}`)
        setSaveStatus('idle')
      }
    } catch (err) {
      sonnerToast.error(`Lỗi kết nối: ${err instanceof Error ? err.message : 'Unknown'}`)
      setSaveStatus('idle')
    }
  }, [])

  const flushSave = useCallback(async () => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    await executeSave()
  }, [executeSave])

  const scheduleAutoSave = useCallback((key: string, type: 'confirmed' | 'pending') => {
    if (type === 'confirmed') pendingRevenueKeysRef.current.add(key)
    else pendingScreenKeysRef.current.add(key)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(executeSave, 600)
  }, [executeSave])

  // Dates computed from view mode
  const dates = useMemo(() => {
    if (viewMode === 'day')    return [selectedDate]
    if (viewMode === 'week')   return getWeekDates(anchorDate)
    if (viewMode === 'month')  return getMonthDates(anchorDate.slice(0, 7) + '-01')
    if (viewMode === 'custom') {
      if (!customFrom || !customTo || customFrom > customTo) return []
      const result: string[] = []
      let d = customFrom
      while (d <= customTo && result.length < 62) {
        result.push(d)
        d = addDays(d, 1)
      }
      return result
    }
    return []
  }, [viewMode, anchorDate, selectedDate, customFrom, customTo])

  // For "all-time": aggregate grids by month, compute unique months
  const monthlyRevenueGrid = useMemo(() => {
    if (viewMode !== 'all') return new Map<string, number>()
    const r = new Map<string, number>()
    revenueGrid.forEach((v, k) => {
      const sep = k.indexOf('__')
      const pid  = k.slice(0, sep)
      const mkey = `${pid}__${k.slice(sep + 2, sep + 9)}-01`
      r.set(mkey, (r.get(mkey) ?? 0) + v)
    })
    return r
  }, [viewMode, revenueGrid])

  const monthlyScreenGrid = useMemo(() => {
    if (viewMode !== 'all') return new Map<string, number>()

    const cumulativeIds = new Set(
      projects.filter(p => p.screen_revenue_type === 'cumulative').map(p => p.project_id)
    )

    const byProject = new Map<string, { date: string; value: number }[]>()
    screenGrid.forEach((v, k) => {
      const sep = k.indexOf('__')
      const pid  = k.slice(0, sep)
      const date = k.slice(sep + 2)
      if (!byProject.has(pid)) byProject.set(pid, [])
      byProject.get(pid)!.push({ date, value: v })
    })

    const r = new Map<string, number>()
    byProject.forEach((entries, pid) => {
      if (!cumulativeIds.has(pid)) {
        entries.forEach(({ date, value }) => {
          const mkey = `${pid}__${date.slice(0, 7)}-01`
          r.set(mkey, (r.get(mkey) ?? 0) + value)
        })
      } else {
        entries.sort((a, b) => a.date.localeCompare(b.date))
        const lastPerMonth = new Map<string, number>()
        entries.forEach(({ date, value }) => {
          lastPerMonth.set(date.slice(0, 7), value)
        })
        let prevValue = 0
        Array.from(lastPerMonth.keys()).sort().forEach(month => {
          const last  = lastPerMonth.get(month)!
          const delta = last - prevValue
          r.set(`${pid}__${month}-01`, delta)
          prevValue = last
        })
      }
    })
    return r
  }, [viewMode, screenGrid, projects])

  const allTimeDates = useMemo(() => {
    if (viewMode !== 'all') return []
    const months = new Set<string>()
    const add = (g: Map<string, number>) => g.forEach((_, k) => {
      const date = k.slice(k.indexOf('__') + 2)
      months.add(date.slice(0, 7) + '-01')
    })
    add(revenueGrid); add(screenGrid)
    if (months.size === 0) months.add(today.slice(0, 7) + '-01')
    return Array.from(months).sort()
  }, [viewMode, revenueGrid, screenGrid, today])

  const effectiveDates = viewMode === 'all' ? allTimeDates : dates

  const gridData = useMemo(() => {
    if (viewMode === 'all') return activeTab === 'revenue' ? monthlyRevenueGrid : monthlyScreenGrid
    return activeTab === 'revenue' ? revenueGrid : screenGrid
  }, [viewMode, activeTab, revenueGrid, screenGrid, monthlyRevenueGrid, monthlyScreenGrid])

  // Fetch revenue whenever visible dates change
  const fetchRevenue = useCallback(async (dateList: string[]) => {
    if (dateList.length === 0) return
    const from = viewMode === 'all' ? '2020-01-01' : dateList[0]
    const to   = viewMode === 'all' ? today : (dateList[dateList.length - 1] ?? today)
    setIsLoading(true)
    try {
      const token = await getToken()
      const headers = { Authorization: `Bearer ${token}` }
      const res = await fetch(`/api/revenue?from=${from}&to=${to}`, { headers })
      if (!res.ok) return
      const rows: RevenueRow[] = await res.json()

      setRevenueGrid(prev => {
        const next = new Map(prev)
        rows.forEach(r => {
          const key = `${r.project_id}__${r.date}`
          if (pendingRevenueKeysRef.current.has(key)) return
          if (r.type === 'confirmed' && r.amount > 0) next.set(key, r.amount)
        })
        return next
      })
      setScreenGrid(prev => {
        const next = new Map(prev)
        rows.forEach(r => {
          const key = `${r.project_id}__${r.date}`
          if (pendingScreenKeysRef.current.has(key)) return
          if (r.type === 'pending' && r.amount > 0) next.set(key, r.amount)
        })
        return next
      })

      const nextNotes       = new Map<string, string>()
      const nextPayouts     = new Map<string, { start: string; end: string }>()
      const nextStatus      = new Map<string, 'pending' | 'confirmed'>()
      const nextConfirmedAt = new Map<string, string>()
      const nextCycleEnd    = new Map<string, boolean>()
      rows.forEach(r => {
        const k = `${r.project_id}__${r.date}`
        if (r.type === 'pending') {
          if (r.note) nextNotes.set(k, r.note)
          if (r.cycle_end) nextCycleEnd.set(k, true)
        }
        if (r.type === 'confirmed') {
          if (r.payout_start_date && r.payout_end_date) nextPayouts.set(k, { start: r.payout_start_date, end: r.payout_end_date })
          nextStatus.set(k, 'confirmed')
          if (r.confirmed_at) nextConfirmedAt.set(k, r.confirmed_at)
        }
      })
      setNoteMap(nextNotes)
      setPayoutMap(nextPayouts)
      setStatusMap(nextStatus)
      setConfirmedAtMap(nextConfirmedAt)
      setCycleEndMap(nextCycleEnd)

      if (viewMode !== 'all') {
        const prevDate = addDays(dateList[0], -1)
        const prevRes  = await fetch(`/api/revenue?from=${prevDate}&to=${prevDate}`, { headers })
        if (prevRes.ok) {
          const prevRows: RevenueRow[] = await prevRes.json()
          const nextPrev     = new Map<string, number>()
          const nextPrevCE   = new Map<string, boolean>()
          prevRows.forEach(r => {
            if (r.type === 'pending') {
              nextPrev.set(`${r.project_id}__${r.date}`, r.amount)
              if (r.cycle_end) nextPrevCE.set(`${r.project_id}__${r.date}`, true)
            }
          })
          setPrevScreenMap(nextPrev)
          setPrevCycleEndMap(nextPrevCE)
        }
      }
    } finally {
      setIsLoading(false)
    }
  }, [viewMode, today])

  useEffect(() => {
    if (viewMode === 'all') {
      fetchRevenue([])
    } else {
      fetchRevenue(dates)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates, viewMode, fetchRevenue, refreshKey])

  // Navigation
  const goBack = useCallback(() => {
    if (viewMode === 'week')  setAnchorDate(prev => addDays(prev, -7))
    else if (viewMode === 'day')   setSelectedDate(prev => addDays(prev, -1))
    else if (viewMode === 'month') setAnchorDate(prev => addMonths(prev, -1))
  }, [viewMode])

  const goForward = useCallback(() => {
    if (viewMode === 'week') {
      setAnchorDate(prev => { const n = addDays(prev, 7); return n > today ? today : n })
    } else if (viewMode === 'day') {
      setSelectedDate(prev => { const n = addDays(prev, 1); return n > today ? today : n })
    } else if (viewMode === 'month') {
      setAnchorDate(prev => {
        const n = addMonths(prev, 1)
        return n > today.slice(0, 7) + '-01' ? today.slice(0, 7) + '-01' : n
      })
    }
  }, [viewMode, today])

  const goToToday = useCallback(() => {
    setAnchorDate(today)
    setSelectedDate(today)
  }, [today])

  const switchMode = useCallback((mode: ViewMode) => {
    setViewMode(mode)
    if (mode === 'day')   setSelectedDate(prev => prev > today ? today : prev)
    if (mode === 'week')  setAnchorDate(today)
    if (mode === 'month') setAnchorDate(today.slice(0, 7) + '-01')
  }, [today])

  const setCustomRange = useCallback((from: string, to: string) => {
    setCustomFrom(from)
    setCustomTo(to)
    setViewMode('custom')
  }, [])

  const isAtToday = useMemo(() => {
    if (viewMode === 'day')    return selectedDate >= today
    if (viewMode === 'week')   return anchorDate >= today
    if (viewMode === 'month')  return anchorDate.slice(0, 7) >= today.slice(0, 7)
    if (viewMode === 'custom') return (customTo || '') >= today
    return true
  }, [viewMode, anchorDate, selectedDate, customTo, today])

  const refreshRevenue = useCallback(() => setRefreshKey(k => k + 1), [])

  // Update cell (overwrite, with undo history)
  const updateCell = useCallback((projectId: string, date: string, value: number, historyBatch?: HistoryChange[]) => {
    const key = `${projectId}__${date}`
    const tab = activeTab
    const type = tab === 'revenue' ? 'confirmed' : 'pending'
    const oldValue = tab === 'revenue' ? revenueGridRef.current.get(key) : screenGridRef.current.get(key)
    if (tab === 'revenue') clearedRevenueRef.current.delete(key)
    else clearedScreenRef.current.delete(key)

    if (tab === 'revenue') {
      setRevenueGrid(prev => { const n = new Map(prev); n.set(key, value); return n })
    } else {
      setScreenGrid(prev => { const n = new Map(prev); n.set(key, value); return n })
    }

    if (!historyBatch) {
      historyRef.current = [...historyRef.current.slice(-24), { changes: [{ key, tab, old: oldValue, val: value }] }]
      futureRef.current  = []
      syncUndoRedoState()
    }

    scheduleAutoSave(key, type)
  }, [activeTab, scheduleAutoSave])

  const clearCell = useCallback((projectId: string, date: string, historyBatch?: HistoryChange[]) => {
    const key = `${projectId}__${date}`
    const tab = activeTab
    const type = tab === 'revenue' ? 'confirmed' : 'pending'
    const oldValue = tab === 'revenue' ? revenueGridRef.current.get(key) : screenGridRef.current.get(key)
    if (oldValue === undefined) return

    if (tab === 'revenue') {
      clearedRevenueRef.current.add(key)
      setRevenueGrid(prev => { const n = new Map(prev); n.delete(key); return n })
    } else {
      clearedScreenRef.current.add(key)
      setScreenGrid(prev => { const n = new Map(prev); n.delete(key); return n })
    }

    if (!historyBatch) {
      historyRef.current = [...historyRef.current.slice(-24), { changes: [{ key, tab, old: oldValue, val: undefined }] }]
      futureRef.current  = []
      syncUndoRedoState()
    }

    scheduleAutoSave(key, type)
  }, [activeTab, scheduleAutoSave])

  // Apply a set of changes (used by undo/redo)
  const applyChanges = useCallback((changes: HistoryChange[], direction: 'undo' | 'redo') => {
    changes.forEach(({ key, tab, old, val }) => {
      const restore = direction === 'undo' ? old : val
      const type = tab === 'revenue' ? 'confirmed' : 'pending'
      if (restore === undefined) {
        if (tab === 'revenue') { clearedRevenueRef.current.add(key); setRevenueGrid(prev => { const n = new Map(prev); n.delete(key); return n }) }
        else { clearedScreenRef.current.add(key); setScreenGrid(prev => { const n = new Map(prev); n.delete(key); return n }) }
      } else {
        if (tab === 'revenue') { clearedRevenueRef.current.delete(key); setRevenueGrid(prev => { const n = new Map(prev); n.set(key, restore); return n }) }
        else { clearedScreenRef.current.delete(key); setScreenGrid(prev => { const n = new Map(prev); n.set(key, restore); return n }) }
      }
      scheduleAutoSave(key, type)
    })
  }, [scheduleAutoSave])

  const undo = useCallback(() => {
    const entry = historyRef.current.pop()
    if (!entry) return
    futureRef.current.push(entry)
    syncUndoRedoState()
    applyChanges(entry.changes, 'undo')
    showToast(`✓ Đã khôi phục ${entry.changes.length > 1 ? `${entry.changes.length} ô` : '1 ô'}`)
  }, [applyChanges])

  const redo = useCallback(() => {
    const entry = futureRef.current.pop()
    if (!entry) return
    historyRef.current.push(entry)
    syncUndoRedoState()
    applyChanges(entry.changes, 'redo')
    showToast(`✓ Đã làm lại ${entry.changes.length > 1 ? `${entry.changes.length} ô` : '1 ô'}`)
  }, [applyChanges])

  // Bulk-paste: record all changes as single history entry
  const bulkUpdateCells = useCallback((cells: { projectId: string; date: string; value: number }[]) => {
    const changes: HistoryChange[] = []
    cells.forEach(({ projectId, date, value }) => {
      const key = `${projectId}__${date}`
      const tab = activeTab
      const old = tab === 'revenue' ? revenueGridRef.current.get(key) : screenGridRef.current.get(key)
      changes.push({ key, tab, old, val: value })
      if (tab === 'revenue') {
        clearedRevenueRef.current.delete(key)
        setRevenueGrid(prev => { const n = new Map(prev); n.set(key, value); return n })
        pendingRevenueKeysRef.current.add(key)
      } else {
        clearedScreenRef.current.delete(key)
        setScreenGrid(prev => { const n = new Map(prev); n.set(key, value); return n })
        pendingScreenKeysRef.current.add(key)
      }
    })
    if (changes.length > 0) {
      historyRef.current = [...historyRef.current.slice(-24), { changes }]
      futureRef.current  = []
      syncUndoRedoState()
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(executeSave, 600)
  }, [activeTab, executeSave])

  // Bulk-clear: remove many cells as a single history entry (Excel-style range delete)
  const bulkClearCells = useCallback((cells: { projectId: string; date: string }[]) => {
    const changes: HistoryChange[] = []
    cells.forEach(({ projectId, date }) => {
      const key = `${projectId}__${date}`
      const tab = activeTab
      const old = tab === 'revenue' ? revenueGridRef.current.get(key) : screenGridRef.current.get(key)
      if (old === undefined) return // empty cell, nothing to clear
      changes.push({ key, tab, old, val: undefined })
      if (tab === 'revenue') {
        clearedRevenueRef.current.add(key)
        setRevenueGrid(prev => { const n = new Map(prev); n.delete(key); return n })
        pendingRevenueKeysRef.current.add(key)
      } else {
        clearedScreenRef.current.add(key)
        setScreenGrid(prev => { const n = new Map(prev); n.delete(key); return n })
        pendingScreenKeysRef.current.add(key)
      }
    })
    if (changes.length > 0) {
      historyRef.current = [...historyRef.current.slice(-24), { changes }]
      futureRef.current  = []
      syncUndoRedoState()
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(executeSave, 600)
  }, [activeTab, executeSave])

  const saveNote = useCallback(async (projectId: string, date: string, note: string) => {
    const key = `${projectId}__${date}`
    setNoteMap(prev => { const n = new Map(prev); if (note) n.set(key, note); else n.delete(key); return n })
    const token = await getToken()
    await fetch('/api/revenue', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ project_id: projectId, date, type: 'pending', note: note || null }),
    })
  }, [])

  const savePayout = useCallback(async (projectId: string, date: string, start: string | null, end: string | null) => {
    const key = `${projectId}__${date}`
    setPayoutMap(prev => {
      const n = new Map(prev)
      if (start && end) n.set(key, { start, end }); else n.delete(key)
      return n
    })
    const token = await getToken()
    await fetch('/api/revenue', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ project_id: projectId, date, type: 'confirmed', payout_start_date: start, payout_end_date: end }),
    })
  }, [])

  // "Chốt kỳ": đánh dấu ngày cuối kỳ trên dòng pending → delta luỹ kế ngày kế reset về 0
  const toggleCycleEnd = useCallback(async (projectId: string, date: string, value: boolean) => {
    const key = `${projectId}__${date}`
    setCycleEndMap(prev => { const n = new Map(prev); if (value) n.set(key, true); else n.delete(key); return n })
    const token = await getToken()
    await fetch('/api/revenue', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ project_id: projectId, date, type: 'pending', cycle_end: value }),
    })
  }, [])

  return {
    projects, today, viewMode, anchorDate, selectedDate,
    activeTab, setActiveTab,
    dates: effectiveDates,
    gridData, revenueGrid, screenGrid, prevScreenMap,
    noteMap, payoutMap,
    isLoading, saveStatus, isAtToday,
    canUndo, canRedo, toast, setToast,
    undo, redo,
    goBack, goForward, goToToday, switchMode,
    customFrom, customTo, setCustomRange, refreshRevenue,
    updateCell, clearCell, bulkUpdateCells, bulkClearCells,
    saveNote, savePayout, flushSave,
    statusMap, confirmedAtMap,
    cycleEndMap, prevCycleEndMap, toggleCycleEnd,
  }
}
