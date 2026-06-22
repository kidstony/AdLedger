'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useProjectsContext } from '@/context/ProjectsContext'

export type ViewMode = 'week' | 'day'
export type RevenueTab = 'revenue' | 'screen'

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

function getWeekDates(anchor: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(anchor, i - 6))
}

type RevenueRow = {
  project_id: string
  date: string
  revenue: number
  screen_revenue: number
  note?: string | null
  payout_start_date?: string | null
  payout_end_date?: string | null
}

export function useRevenueGrid() {
  const { projects } = useProjectsContext()

  const today = todayStr()
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [anchorDate, setAnchorDate] = useState(today)
  const [selectedDate, setSelectedDate] = useState(today)
  const [activeTab, setActiveTab] = useState<RevenueTab>('revenue')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [revenueGrid, setRevenueGrid] = useState<Map<string, number>>(new Map())
  const [screenGrid, setScreenGrid] = useState<Map<string, number>>(new Map())
  const savedRevenueRef = useRef<Map<string, number>>(new Map())
  const savedScreenRef = useRef<Map<string, number>>(new Map())
  const clearedRef = useRef<Set<string>>(new Set())
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set())

  // For cumulative mode: previous day's screen values (one day before the visible window)
  const [prevScreenMap, setPrevScreenMap] = useState<Map<string, number>>(new Map())

  // Note and payout (billing period) per cell
  const [noteMap, setNoteMap] = useState<Map<string, string>>(new Map())
  const [payoutMap, setPayoutMap] = useState<Map<string, { start: string; end: string }>>(new Map())

  const dates = useMemo(
    () => viewMode === 'week' ? getWeekDates(anchorDate) : [selectedDate],
    [viewMode, anchorDate, selectedDate]
  )

  const gridData = activeTab === 'revenue' ? revenueGrid : screenGrid

  const fetchRevenue = useCallback(async (dateList: string[]) => {
    if (dateList.length === 0) return
    const from = dateList[0]
    const to = dateList[dateList.length - 1]
    setIsLoading(true)
    try {
      // Main fetch
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

      // Populate noteMap and payoutMap
      const nextNotes = new Map<string, string>()
      const nextPayouts = new Map<string, { start: string; end: string }>()
      rows.forEach(r => {
        if (r.note) nextNotes.set(`${r.project_id}__${r.date}`, r.note)
        if (r.payout_start_date && r.payout_end_date) {
          nextPayouts.set(`${r.project_id}__${r.date}`, { start: r.payout_start_date, end: r.payout_end_date })
        }
      })
      setNoteMap(nextNotes)
      setPayoutMap(nextPayouts)

      // Fetch previous day for cumulative delta calculation
      const prevDate = addDays(from, -1)
      const prevRes = await fetch(`/api/revenue?from=${prevDate}&to=${prevDate}`)
      if (prevRes.ok) {
        const prevRows: RevenueRow[] = await prevRes.json()
        const nextPrev = new Map<string, number>()
        prevRows.forEach(r => nextPrev.set(`${r.project_id}__${r.date}`, r.screen_revenue ?? 0))
        setPrevScreenMap(nextPrev)
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRevenue(dates)
  }, [dates, fetchRevenue])

  const goBack = useCallback(() => {
    if (viewMode === 'week') setAnchorDate(prev => addDays(prev, -7))
    else setSelectedDate(prev => addDays(prev, -1))
  }, [viewMode])

  const goForward = useCallback(() => {
    if (viewMode === 'week') {
      setAnchorDate(prev => { const next = addDays(prev, 7); return next > today ? today : next })
    } else {
      setSelectedDate(prev => { const next = addDays(prev, 1); return next > today ? today : next })
    }
  }, [viewMode, today])

  const goToToday = useCallback(() => {
    setAnchorDate(today)
    setSelectedDate(today)
  }, [today])

  const goToDate = useCallback((date: string) => {
    const capped = date > today ? today : date
    if (viewMode === 'week') setAnchorDate(capped)
    else setSelectedDate(capped)
  }, [viewMode, today])

  const switchMode = useCallback((mode: ViewMode) => {
    setViewMode(mode)
    if (mode === 'day') setSelectedDate(anchorDate)
    else setAnchorDate(selectedDate > today ? today : selectedDate)
  }, [anchorDate, selectedDate, today])

  const updateCell = useCallback((projectId: string, date: string, value: number) => {
    const key = `${projectId}__${date}`
    clearedRef.current.delete(key)
    if (activeTab === 'revenue') {
      setRevenueGrid(prev => { const next = new Map(prev); next.set(key, value); return next })
    } else {
      setScreenGrid(prev => { const next = new Map(prev); next.set(key, value); return next })
    }
    setDirtyKeys(prev => new Set(prev).add(key))
    setSaved(false)
  }, [activeTab])

  const clearCell = useCallback((projectId: string, date: string) => {
    const key = `${projectId}__${date}`
    clearedRef.current.add(key)
    if (activeTab === 'revenue') {
      setRevenueGrid(prev => { const next = new Map(prev); next.delete(key); return next })
    } else {
      setScreenGrid(prev => { const next = new Map(prev); next.delete(key); return next })
    }
    setDirtyKeys(prev => new Set(prev).add(key))
    setSaved(false)
  }, [activeTab])

  const saveAll = useCallback(async () => {
    if (dirtyKeys.size === 0) return
    setIsSaving(true)
    const rows = Array.from(dirtyKeys).map(key => {
      const sep = key.indexOf('__')
      const project_id = key.slice(0, sep)
      const date = key.slice(sep + 2)
      const wasCleared = clearedRef.current.has(key)
      return {
        project_id,
        date,
        revenue:        wasCleared ? 0 : (revenueGrid.get(key) ?? savedRevenueRef.current.get(key) ?? 0),
        screen_revenue: wasCleared ? 0 : (screenGrid.get(key)  ?? savedScreenRef.current.get(key)  ?? 0),
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
        setDirtyKeys(new Set())
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      }
    } finally {
      setIsSaving(false)
    }
  }, [dirtyKeys, revenueGrid, screenGrid])

  const discard = useCallback(() => {
    setRevenueGrid(prev => {
      const next = new Map(prev)
      dirtyKeys.forEach(key => {
        const orig = savedRevenueRef.current.get(key)
        if (orig !== undefined && orig > 0) next.set(key, orig); else next.delete(key)
      })
      return next
    })
    setScreenGrid(prev => {
      const next = new Map(prev)
      dirtyKeys.forEach(key => {
        const orig = savedScreenRef.current.get(key)
        if (orig !== undefined && orig > 0) next.set(key, orig); else next.delete(key)
      })
      return next
    })
    clearedRef.current.clear()
    setDirtyKeys(new Set())
    setSaved(false)
  }, [dirtyKeys])

  // Immediately save a note for a specific cell
  const saveNote = useCallback(async (projectId: string, date: string, note: string) => {
    const key = `${projectId}__${date}`
    setNoteMap(prev => { const next = new Map(prev); if (note) next.set(key, note); else next.delete(key); return next })
    await fetch('/api/revenue', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, date, note: note || null }),
    })
  }, [])

  // Immediately save billing period for a specific cell
  const savePayout = useCallback(async (projectId: string, date: string, start: string | null, end: string | null) => {
    const key = `${projectId}__${date}`
    setPayoutMap(prev => {
      const next = new Map(prev)
      if (start && end) next.set(key, { start, end }); else next.delete(key)
      return next
    })
    await fetch('/api/revenue', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, date, payout_start_date: start, payout_end_date: end }),
    })
  }, [])

  const isAtToday = viewMode === 'week' ? anchorDate >= today : selectedDate >= today

  return {
    projects, dates, today, viewMode, anchorDate, selectedDate,
    activeTab, setActiveTab,
    gridData, screenGrid, prevScreenMap,
    noteMap, payoutMap,
    dirtyKeys,
    isDirty: dirtyKeys.size > 0,
    isSaving, isLoading, saved, isAtToday,
    goBack, goForward, goToToday, goToDate, switchMode,
    updateCell, clearCell, saveAll, discard, saveNote, savePayout,
  }
}
