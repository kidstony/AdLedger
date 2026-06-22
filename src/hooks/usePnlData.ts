'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { MOCK_PNL_DAILY } from '@/lib/mock-data'
import { aggregatePnl, getDefaultDateRange } from '@/lib/utils'
import { DateRange, PnlSummary } from '@/lib/types'
import { useProjectsContext } from '@/context/ProjectsContext'
import { supabase } from '@/lib/supabase'

interface AdSpendRow {
  cid: string
  date: string
  spend: number
}

export function usePnlData() {
  const { projects } = useProjectsContext()
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange())
  const [isLoading, setIsLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [adSpendRows, setAdSpendRows] = useState<AdSpendRow[] | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)

  // Map project_id → project info
  const projectByCid = useMemo(
    () => new Map(projects.map(p => [p.cid, p])),
    [projects]
  )
  const projectNameMap = useMemo(
    () => new Map(projects.map(p => [p.project_id, p.name])),
    [projects]
  )
  const activeProjectIds = useMemo(
    () => new Set(projects.map(p => p.project_id)),
    [projects]
  )

  async function fetchAdSpend(range: DateRange) {
    const from = range.from.toISOString().split('T')[0]
    const to = range.to.toISOString().split('T')[0]
    const { data } = await supabase
      .from('ad_spend')
      .select('cid, date, spend')
      .gte('date', from)
      .lte('date', to)
    setAdSpendRows(data ?? [])
  }

  async function fetchLastSync() {
    const { data } = await supabase
      .from('sync_log')
      .select('synced_at')
      .eq('status', 'success')
      .order('synced_at', { ascending: false })
      .limit(1)
      .single()
    if (data) setLastSyncedAt(data.synced_at)
  }

  useEffect(() => {
    fetchAdSpend(dateRange)
    fetchLastSync()
  }, [dateRange]) // eslint-disable-line react-hooks/exhaustive-deps

  // Determine data source
  const dataSource: 'real' | 'mock' = (adSpendRows && adSpendRows.length > 0) ? 'real' : 'mock'

  const allSummaries = useMemo(() => {
    if (dataSource === 'real' && adSpendRows && adSpendRows.length > 0) {
      // Build summaries from real ad_spend data
      const map = new Map<string, PnlSummary>()
      adSpendRows.forEach(row => {
        const project = projectByCid.get(row.cid)
        if (!project) return
        const existing = map.get(project.project_id)
        if (!existing) {
          map.set(project.project_id, {
            project_id: project.project_id,
            cid: row.cid,
            name: project.name,
            mcc_id: project.mcc_id,
            total_spend: row.spend,
            total_revenue: 0,
            total_profit: -row.spend,
            avg_roi: 0,
          })
        } else {
          existing.total_spend += row.spend
          existing.total_profit -= row.spend
        }
      })
      map.forEach(s => {
        s.avg_roi = s.total_spend > 0 ? (s.total_profit / s.total_spend) * 100 : 0
      })
      return Array.from(map.values())
    }

    // Fallback: mock data
    const filteredDaily = MOCK_PNL_DAILY.filter(row => activeProjectIds.has(row.project_id))
    const summaries = aggregatePnl(filteredDaily, dateRange)
    summaries.forEach(s => {
      const name = projectNameMap.get(s.project_id)
      if (name) s.name = name
    })
    return summaries
  }, [dataSource, adSpendRows, projectByCid, projectNameMap, activeProjectIds, dateRange])

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

  const refresh = useCallback(async () => {
    setIsLoading(true)
    await Promise.all([fetchAdSpend(dateRange), fetchLastSync()])
    setIsLoading(false)
  }, [dateRange]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    data: filtered as PnlSummary[],
    allSummaries,
    totals: { ...totals, avgRoi },
    isLoading,
    dateRange,
    setDateRange,
    search,
    setSearch,
    refresh,
    dataSource,
    lastSyncedAt,
  }
}
