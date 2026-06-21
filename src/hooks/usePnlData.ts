'use client'

import { useState, useMemo, useCallback } from 'react'
import { MOCK_PNL_DAILY } from '@/lib/mock-data'
import { aggregatePnl, getDefaultDateRange } from '@/lib/utils'
import { DateRange, PnlSummary } from '@/lib/types'
import { useProjectsContext } from '@/context/ProjectsContext'

export function usePnlData() {
  const { projects } = useProjectsContext()
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange())
  const [isLoading, setIsLoading] = useState(false)
  const [search, setSearch] = useState('')

  const activeProjectIds = useMemo(
    () => new Set(projects.map(p => p.project_id)),
    [projects]
  )

  // Build a project name map so updated names reflect in dashboard too
  const projectNameMap = useMemo(
    () => new Map(projects.map(p => [p.project_id, p.name])),
    [projects]
  )

  const filteredDaily = useMemo(
    () => MOCK_PNL_DAILY.filter(row => activeProjectIds.has(row.project_id)),
    [activeProjectIds]
  )

  const allSummaries = useMemo(() => {
    const summaries = aggregatePnl(filteredDaily, dateRange)
    // Sync project names from context (in case user renamed a project)
    summaries.forEach(s => {
      const name = projectNameMap.get(s.project_id)
      if (name) s.name = name
    })
    return summaries
  }, [filteredDaily, dateRange, projectNameMap])

  const filtered = useMemo(() => {
    if (!search.trim()) return allSummaries
    const q = search.toLowerCase()
    return allSummaries.filter(
      s => s.name.toLowerCase().includes(q) || s.project_id.includes(q)
    )
  }, [allSummaries, search])

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, s) => ({
        spend: acc.spend + s.total_spend,
        revenue: acc.revenue + s.total_revenue,
        profit: acc.profit + s.total_profit,
      }),
      { spend: 0, revenue: 0, profit: 0 }
    )
  }, [filtered])

  const avgRoi = totals.spend > 0 ? (totals.profit / totals.spend) * 100 : 0

  const refresh = useCallback(() => {
    setIsLoading(true)
    setTimeout(() => setIsLoading(false), 800)
  }, [])

  return {
    data: filtered as PnlSummary[],
    totals: { ...totals, avgRoi },
    isLoading,
    dateRange,
    setDateRange,
    search,
    setSearch,
    refresh,
  }
}
