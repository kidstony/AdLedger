import { RentalGroup, RentalRateType } from './types'

export const MS_PER_DAY = 86400000

export function computeTimeFactor(
  rate_type: RentalRateType,
  from: string,
  to: string,
  period_from: string | null,
  period_to: string | null,
): number {
  const pStart = period_from ?? '1900-01-01'
  const pEnd   = period_to   ?? '9999-12-31'
  const oFrom  = from > pStart ? from : pStart
  const oTo    = to   < pEnd   ? to   : pEnd
  if (oFrom > oTo) return 0
  const days = Math.round((new Date(oTo + 'T00:00:00').getTime() - new Date(oFrom + 'T00:00:00').getTime()) / MS_PER_DAY) + 1
  if (rate_type === 'daily')   return days
  if (rate_type === 'weekly')  return days / 7
  if (rate_type === 'monthly') {
    let total = 0
    let cur = new Date(oFrom + 'T00:00:00')
    const end = new Date(oTo + 'T00:00:00')
    while (cur <= end) {
      const y = cur.getFullYear(), mon = cur.getMonth()
      const daysInMonth = new Date(y, mon + 1, 0).getDate()
      const monthEnd = new Date(y, mon + 1, 0)
      const chunkTo = end < monthEnd ? end : monthEnd
      const daysInChunk = Math.round((chunkTo.getTime() - cur.getTime()) / MS_PER_DAY) + 1
      total += daysInChunk / daysInMonth
      cur = new Date(y, mon + 1, 1)
    }
    return total
  }
  return 0
}

export function computeCidCost(
  cid: string,
  group: RentalGroup,
  from: string,
  to: string,
  adSpendByCid: Map<string, number>,
): number {
  if (group.rate_type === 'one_time') {
    const pd = group.payment_date ?? ''
    return pd >= from && pd <= to ? group.rate_value : 0
  }
  if (group.rate_type === 'percentage') {
    return (adSpendByCid.get(cid) ?? 0) * (group.rate_value / 100)
  }
  return group.rate_value * computeTimeFactor(group.rate_type, from, to, group.period_from, group.period_to)
}

export function computeGroupCost(group: RentalGroup, from: string, to: string, adSpendByCid: Map<string, number>): number {
  return (group.rental_group_cids ?? []).reduce(
    (sum, c) => sum + computeCidCost(c.cid, group, from, to, adSpendByCid), 0
  )
}
