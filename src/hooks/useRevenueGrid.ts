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
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set())

  const dates = useMemo(
    () => viewMode === 'week' ? getWeekDates(anchorDate) : [selectedDate],
    [viewMode, anchorDate, selectedDate]
  )

  // gridData = active tab's grid
  const gridData = activeTab === 'revenue' ? revenueGrid : screenGrid

  const fetchRevenue = useCallback(async (dateList: string[]) => {
    if (dateList.length === 0) return
    const from = dateList[0]
    const to = dateList[dateList.length - 1]
    setIsLoading(true)
    try {
      const res = await fetch(`/api/revenue?from=${from}&to=${to}`)
      if (!res.ok) return
      const rows: { project_id: string; date: string; revenue: number; screen_revenue: number }[] = await res.json()
      setRevenueGrid(prev => {
        const next = new Map(prev)
        rows.forEach(r => next.set(`${r.project_id}__${r.date}`, r.revenue))
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
    if (activeTab === 'revenue') {
      setRevenueGrid(prev => { const next = new Map(prev); next.set(key, value); return next })
    } else {
      setScreenGrid(prev => { const next = new Map(prev); next.set(key, value); return next })
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
      return {
        project_id,
        date,
        revenue:        revenueGrid.get(key) ?? savedRevenueRef.current.get(key) ?? 0,
        screen_revenue: screenGrid.get(key)  ?? savedScreenRef.current.get(key)  ?? 0,
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
          savedRevenueRef.current.set(`${r.project_id}__${r.date}`, r.revenue)
          savedScreenRef.current.set(`${r.project_id}__${r.date}`, r.screen_revenue)
        })
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
        if (orig !== undefined) next.set(key, orig); else next.delete(key)
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
    setDirtyKeys(new Set())
    setSaved(false)
  }, [dirtyKeys])

  const isAtToday = viewMode === 'week' ? anchorDate >= today : selectedDate >= today

  return {
    projects, dates, today, viewMode, anchorDate, selectedDate,
    activeTab, setActiveTab,
    gridData, dirtyKeys,
    isDirty: dirtyKeys.size > 0,
    isSaving, isLoading, saved, isAtToday,
    goBack, goForward, goToToday, goToDate, switchMode,
    updateCell, saveAll, discard,
  }
}
