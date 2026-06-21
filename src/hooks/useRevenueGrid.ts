'use client'

import { useState, useMemo, useCallback } from 'react'
import { MOCK_REVENUE } from '@/lib/mock-data'
import { useProjectsContext } from '@/context/ProjectsContext'

export type ViewMode = 'week' | 'day'

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

// Build initial grid from ALL mock revenue (not just recent dates)
function buildInitialGrid(): Map<string, number> {
  const map = new Map<string, number>()
  MOCK_REVENUE.forEach(r => {
    map.set(`${r.project_id}__${r.date}`, r.revenue)
  })
  return map
}

export function useRevenueGrid() {
  const { projects } = useProjectsContext()

  const today = todayStr()
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [anchorDate, setAnchorDate] = useState(today)
  const [selectedDate, setSelectedDate] = useState(today)

  // gridData holds ALL revenue across ALL dates — navigation never loses data
  const [gridData, setGridData] = useState<Map<string, number>>(buildInitialGrid)
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set())
  const [saved, setSaved] = useState(false)

  const dates = useMemo(
    () => viewMode === 'week' ? getWeekDates(anchorDate) : [selectedDate],
    [viewMode, anchorDate, selectedDate]
  )

  const goBack = useCallback(() => {
    if (viewMode === 'week') {
      setAnchorDate(prev => addDays(prev, -7))
    } else {
      setSelectedDate(prev => addDays(prev, -1))
    }
  }, [viewMode])

  const goForward = useCallback(() => {
    if (viewMode === 'week') {
      setAnchorDate(prev => {
        const next = addDays(prev, 7)
        return next > today ? today : next
      })
    } else {
      setSelectedDate(prev => {
        const next = addDays(prev, 1)
        return next > today ? today : next
      })
    }
  }, [viewMode, today])

  const goToToday = useCallback(() => {
    setAnchorDate(today)
    setSelectedDate(today)
  }, [today])

  const goToDate = useCallback((date: string) => {
    if (viewMode === 'week') {
      // anchor = date so it becomes the last column of the week
      const capped = date > today ? today : date
      setAnchorDate(capped)
    } else {
      const capped = date > today ? today : date
      setSelectedDate(capped)
    }
  }, [viewMode, today])

  const switchMode = useCallback((mode: ViewMode) => {
    setViewMode(mode)
    if (mode === 'day') {
      // Jump to the last visible date in week mode
      setSelectedDate(anchorDate)
    } else {
      // Jump to week containing selectedDate
      setAnchorDate(selectedDate > today ? today : selectedDate)
    }
  }, [anchorDate, selectedDate, today])

  const updateCell = useCallback((projectId: string, date: string, value: number) => {
    const key = `${projectId}__${date}`
    setGridData(prev => {
      const next = new Map(prev)
      next.set(key, value)
      return next
    })
    setDirtyKeys(prev => new Set(prev).add(key))
    setSaved(false)
  }, [])

  const saveAll = useCallback(() => {
    setDirtyKeys(new Set())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [])

  const discard = useCallback(() => {
    // Reset only dirty keys to original mock values
    setGridData(prev => {
      const next = new Map(prev)
      const original = buildInitialGrid()
      dirtyKeys.forEach(key => {
        const orig = original.get(key)
        if (orig !== undefined) next.set(key, orig)
        else next.delete(key)
      })
      return next
    })
    setDirtyKeys(new Set())
    setSaved(false)
  }, [dirtyKeys])

  const isAtToday = viewMode === 'week' ? anchorDate >= today : selectedDate >= today

  return {
    projects,
    dates,
    today,
    viewMode,
    anchorDate,
    selectedDate,
    gridData,
    dirtyKeys,
    isDirty: dirtyKeys.size > 0,
    saved,
    isAtToday,
    goBack,
    goForward,
    goToToday,
    goToDate,
    switchMode,
    updateCell,
    saveAll,
    discard,
  }
}
