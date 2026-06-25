'use client'

import { createContext, useContext, useState, ReactNode } from 'react'
import { DateRange } from '@/lib/types'
import { getDefaultDateRange } from '@/lib/utils'

interface DateRangeContextValue {
  dateRange: DateRange
  setDateRange: (range: DateRange) => void
  fromStr: string
  toStr: string
}

const DateRangeContext = createContext<DateRangeContextValue | null>(null)

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange())

  const fromStr = dateRange.from.toISOString().split('T')[0]
  const toStr   = dateRange.to.toISOString().split('T')[0]

  return (
    <DateRangeContext.Provider value={{ dateRange, setDateRange, fromStr, toStr }}>
      {children}
    </DateRangeContext.Provider>
  )
}

export function useDateRange() {
  const ctx = useContext(DateRangeContext)
  if (!ctx) throw new Error('useDateRange must be used within DateRangeProvider')
  return ctx
}
