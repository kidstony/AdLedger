'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'

// Bọc hành động async cho nút bấm: quản lý pending + toast lỗi (và toast thành công nếu khai báo).
// <Button disabled={pending} onClick={() => run()}>{pending ? <Loader2 className="animate-spin"/> : <Icon/>}…</Button>
export function useAsyncAction<A extends unknown[]>(
  fn: (...args: A) => Promise<unknown>,
  opts?: { success?: string; errorPrefix?: string },
) {
  const [pending, setPending] = useState(false)
  const { success, errorPrefix } = opts ?? {}

  const run = useCallback(
    async (...args: A) => {
      setPending(true)
      try {
        await fn(...args)
        if (success) toast.success(success)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        toast.error(errorPrefix ? `${errorPrefix}: ${msg}` : msg)
      } finally {
        setPending(false)
      }
    },
    [fn, success, errorPrefix],
  )

  return { run, pending }
}
