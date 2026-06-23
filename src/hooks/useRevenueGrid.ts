'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useProjectsContext } from '@/context/ProjectsContext'

export type ViewMode = 'day' | 'week' | 'month' | 'all' | 'custom'
export type RevenueTab = 'revenue' | 'screen'

type HistoryChange = { key: string; tab: RevenueTab; old: number | undefined; val: number | undefined }
type HistoryEntry  = { changes: HistoryChange[] }

function todayStr(): string { return new Date().toISOString().split('T')[0] }

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

function addMonths(date: string, n: number): string {
  const d = new Date(date.slice(0, 7) + '-01T00:00:00')
  d.setMonth(d.getMonth() + n)
  return d.toISOString().split('T')[0].slice(0, 7) + '-01'
}

function getWeekDates(anchor: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(anchor, i - 6))
}

function getMonthDates(firstDay: string): string[] {
  const [y, m] = firstDay.slice(0, 7).split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  return Array.from({ length: days }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)
}

type RevenueRow = {
  project_id: string
  date: string
  revenue: number
  screen_revenue: number
  note?: string | null
  payout_start_date?: string | null
  payout_end_date?: string | null
  status?: string | null
  confirmed_at?: string | null
}

export function useRevenueGrid() {
  const { projects } = useProjectsContext()
  const today = todayStr()

  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [anchorDate, setAnchorDate] = useState(today)     // week end / month first-day
  const [selectedDate, setSelectedDate] = useState(today) // day mode
  const [customFrom, setCustomFrom] = useState(() => addDays(today, -6))
  const [customTo,   setCustomTo]   = useState(today)
  const [refreshKey, setRefreshKey] = useState(0)
  const [activeTab, setActiveTab] = useState<RevenueTab>('revenue')
  const [isLoading, setIsLoading] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  const [revenueGrid, setRevenueGrid] = useState<Map<string, number>>(new Map())
  const [screenGrid,  setScreenGrid]  = useState<Map<string, number>>(new Map())
  const savedRevenueRef = useRef<Map<string, number>>(new Map())
  const savedScreenRef  = useRef<Map<string, number>>(new Map())
  const clearedRef      = useRef<Set<string>>(new Set())

  // Refs always holding current grid values (needed inside callbacks without stale deps)
  const revenueGridRef = useRef<Map<string, number>>(new Map())
  const screenGridRef  = useRef<Map<string, number>>(new Map())
  useEffect(() => { revenueGridRef.current = revenueGrid }, [revenueGrid])
  useEffect(() => { screenGridRef.current  = screenGrid  }, [screenGrid])

  const [prevScreenMap, setPrevScreenMap] = useState<Map<string, number>>(new Map())
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

  // Auto-save (debounced 600ms)
  const pendingKeysRef = useRef<Set<string>>(new Set())
  const saveTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)

  const executeSave = useCallback(async () => {
    if (pendingKeysRef.current.size === 0) return
    setSaveStatus('saving')
    const keys = Array.from(pendingKeysRef.current)
    pendingKeysRef.current.clear()

    const rows = keys.map(key => {
      const sep = key.indexOf('__')
      const project_id = key.slice(0, sep)
      const date = key.slice(sep + 2)
      const cleared = clearedRef.current.has(key)
      return {
        project_id,
        date,
        revenue:        cleared ? 0 : (revenueGridRef.current.get(key) ?? savedRevenueRef.current.get(key) ?? 0),
        screen_revenue: cleared ? 0 : (screenGridRef.current.get(key)  ?? savedScreenRef.current.get(key)  ?? 0),
      }
    })

    try {
      const res = await fetch('/api/revenue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      if (res.ok) {
        rows.forEach(r => {
          const k = `${r.project_id}__${r.date}`
          savedRevenueRef.current.set(k, r.revenue)
          savedScreenRef.current.set(k, r.screen_revenue)
        })
        clearedRef.current.clear()
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 3000)
      } else {
        setSaveStatus('idle')
      }
    } catch {
      setSaveStatus('idle')
    }
  }, [])

  const scheduleAutoSave = useCallback((key: string) => {
    pendingKeysRef.current.add(key)
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
    // 'all' — derived from loaded data below
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

    // Separate daily entries per project for processing
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
        // Daily project: sum all values in each month
        entries.forEach(({ date, value }) => {
          const mkey = `${pid}__${date.slice(0, 7)}-01`
          r.set(mkey, (r.get(mkey) ?? 0) + value)
        })
      } else {
        // Cumulative project: per month take the LAST value, then compute monthly delta
        entries.sort((a, b) => a.date.localeCompare(b.date))
        const lastPerMonth = new Map<string, number>()
        entries.forEach(({ date, value }) => {
          lastPerMonth.set(date.slice(0, 7), value) // later dates overwrite → last value wins
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
      const res = await fetch(`/api/revenue?from=${from}&to=${to}`)
      if (!res.ok) return
      const rows: RevenueRow[] = await res.json()

      setRevenueGrid(prev => {
        const next = new Map(prev)
        rows.forEach(r => { if ((r.revenue ?? 0) > 0) next.set(`${r.project_id}__${r.date}`, r.revenue) })
        return next
      })
      setScreenGrid(prev => {
        const next = new Map(prev)
        rows.forEach(r => { if ((r.screen_revenue ?? 0) > 0) next.set(`${r.project_id}__${r.date}`, r.screen_revenue) })
        return next
      })
      rows.forEach(r => {
        savedRevenueRef.current.set(`${r.project_id}__${r.date}`, r.revenue)
        savedScreenRef.current.set(`${r.project_id}__${r.date}`, r.screen_revenue ?? 0)
      })

      const nextNotes       = new Map<string, string>()
      const nextPayouts     = new Map<string, { start: string; end: string }>()
      const nextStatus      = new Map<string, 'pending' | 'confirmed'>()
      const nextConfirmedAt = new Map<string, string>()
      rows.forEach(r => {
        const k = `${r.project_id}__${r.date}`
        if (r.note) nextNotes.set(k, r.note)
        if (r.payout_start_date && r.payout_end_date) {
          nextPayouts.set(k, { start: r.payout_start_date, end: r.payout_end_date })
        }
        if (r.status === 'confirmed') nextStatus.set(k, 'confirmed')
        if (r.confirmed_at) nextConfirmedAt.set(k, r.confirmed_at)
      })
      setNoteMap(nextNotes)
      setPayoutMap(nextPayouts)
      setStatusMap(nextStatus)
      setConfirmedAtMap(nextConfirmedAt)

      if (viewMode !== 'all') {
        const prevDate = addDays(dateList[0], -1)
        const prevRes  = await fetch(`/api/revenue?from=${prevDate}&to=${prevDate}`)
        if (prevRes.ok) {
          const prevRows: RevenueRow[] = await prevRes.json()
          const nextPrev = new Map<string, number>()
          prevRows.forEach(r => nextPrev.set(`${r.project_id}__${r.date}`, r.screen_revenue ?? 0))
          setPrevScreenMap(nextPrev)
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
    if (mode === 'week')  setAnchorDate(today) // always reset to current week
    if (mode === 'month') setAnchorDate(today.slice(0, 7) + '-01')
  }, [today])

  const setCustomRange = useCallback((from: string, to: string) => {
    setCustomFrom(from)
    setCustomTo(to)
    setViewMode('custom')
  }, [])

  // Determine if at "today" boundary (forward button disabled)
  const isAtToday = useMemo(() => {
    if (viewMode === 'day')    return selectedDate >= today
    if (viewMode === 'week')   return anchorDate >= today
    if (viewMode === 'month')  return anchorDate.slice(0, 7) >= today.slice(0, 7)
    if (viewMode === 'custom') return (customTo || '') >= today
    return true // all-time nav disabled
  }, [viewMode, anchorDate, selectedDate, customTo, today])

  const refreshRevenue = useCallback(() => setRefreshKey(k => k + 1), [])

  // Update cell (with undo history)
  const updateCell = useCallback((projectId: string, date: string, value: number, historyBatch?: HistoryChange[]) => {
    const key = `${projectId}__${date}`
    const tab = activeTab
    const oldValue = tab === 'revenue' ? revenueGridRef.current.get(key) : screenGridRef.current.get(key)
    clearedRef.current.delete(key)

    if (tab === 'revenue') {
      setRevenueGrid(prev => { const n = new Map(prev); n.set(key, value); return n })
    } else {
      setScreenGrid(prev => { const n = new Map(prev); n.set(key, value); return n })
    }

    // Add to history (historyBatch is used for bulk paste - caller aggregates externally)
    if (!historyBatch) {
      historyRef.current = [...historyRef.current.slice(-24), { changes: [{ key, tab, old: oldValue, val: value }] }]
      futureRef.current  = []
      syncUndoRedoState()
    }

    scheduleAutoSave(key)
  }, [activeTab, scheduleAutoSave])

  const clearCell = useCallback((projectId: string, date: string, historyBatch?: HistoryChange[]) => {
    const key = `${projectId}__${date}`
    const tab = activeTab
    const oldValue = tab === 'revenue' ? revenueGridRef.current.get(key) : screenGridRef.current.get(key)
    if (oldValue === undefined) return // nothing to clear

    clearedRef.current.add(key)
    if (tab === 'revenue') {
      setRevenueGrid(prev => { const n = new Map(prev); n.delete(key); return n })
    } else {
      setScreenGrid(prev => { const n = new Map(prev); n.delete(key); return n })
    }

    if (!historyBatch) {
      historyRef.current = [...historyRef.current.slice(-24), { changes: [{ key, tab, old: oldValue, val: undefined }] }]
      futureRef.current  = []
      syncUndoRedoState()
    }

    scheduleAutoSave(key)
  }, [activeTab, scheduleAutoSave])

  // Apply a set of changes (used by undo/redo)
  const applyChanges = useCallback((changes: HistoryChange[], direction: 'undo' | 'redo') => {
    changes.forEach(({ key, tab, old, val }) => {
      const restore = direction === 'undo' ? old : val
      if (restore === undefined) {
        clearedRef.current.add(key)
        if (tab === 'revenue') setRevenueGrid(prev => { const n = new Map(prev); n.delete(key); return n })
        else setScreenGrid(prev => { const n = new Map(prev); n.delete(key); return n })
      } else {
        clearedRef.current.delete(key)
        if (tab === 'revenue') setRevenueGrid(prev => { const n = new Map(prev); n.set(key, restore); return n })
        else setScreenGrid(prev => { const n = new Map(prev); n.set(key, restore); return n })
      }
      scheduleAutoSave(key)
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
      clearedRef.current.delete(key)
      if (tab === 'revenue') setRevenueGrid(prev => { const n = new Map(prev); n.set(key, value); return n })
      else setScreenGrid(prev => { const n = new Map(prev); n.set(key, value); return n })
      pendingKeysRef.current.add(key)
    })
    if (changes.length > 0) {
      historyRef.current = [...historyRef.current.slice(-24), { changes }]
      futureRef.current  = []
      syncUndoRedoState()
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(executeSave, 600)
  }, [activeTab, executeSave])

  const confirmCell = useCallback(async (projectId: string, date: string) => {
    const res = await fetch('/api/revenue/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, date }),
    })
    if (!res.ok) return
    const { confirmed_at, revenue: confirmedRevenue } = await res.json()
    const key = `${projectId}__${date}`
    const ts  = confirmed_at || new Date().toISOString()

    setStatusMap(prev => { const n = new Map(prev); n.set(key, 'confirmed'); return n })
    setConfirmedAtMap(prev => { const n = new Map(prev); n.set(key, ts); return n })

    // Reflect confirmed revenue in local state so revenue tab shows it immediately
    if ((confirmedRevenue ?? 0) > 0) {
      setRevenueGrid(prev => {
        const n = new Map(prev)
        if (!n.has(key) || (n.get(key) ?? 0) === 0) n.set(key, confirmedRevenue)
        return n
      })
      savedRevenueRef.current.set(key, confirmedRevenue)
    }
  }, [])

  const saveNote = useCallback(async (projectId: string, date: string, note: string) => {
    const key = `${projectId}__${date}`
    setNoteMap(prev => { const n = new Map(prev); if (note) n.set(key, note); else n.delete(key); return n })
    await fetch('/api/revenue', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, date, note: note || null }),
    })
  }, [])

  const savePayout = useCallback(async (projectId: string, date: string, start: string | null, end: string | null) => {
    const key = `${projectId}__${date}`
    setPayoutMap(prev => {
      const n = new Map(prev)
      if (start && end) n.set(key, { start, end }); else n.delete(key)
      return n
    })
    await fetch('/api/revenue', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, date, payout_start_date: start, payout_end_date: end }),
    })
  }, [])

  return {
    projects, today, viewMode, anchorDate, selectedDate,
    activeTab, setActiveTab,
    dates: effectiveDates,
    gridData, screenGrid, prevScreenMap,
    noteMap, payoutMap,
    isLoading, saveStatus, isAtToday,
    canUndo, canRedo, toast, setToast,
    undo, redo,
    goBack, goForward, goToToday, switchMode,
    customFrom, customTo, setCustomRange, refreshRevenue,
    updateCell, clearCell, bulkUpdateCells,
    saveNote, savePayout, confirmCell,
    statusMap, confirmedAtMap,
  }
}
