'use client'

import { useEffect, useState } from 'react'

// Nhớ lựa chọn hiển thị (toggle view, tab…) qua localStorage — đỡ 1 click mỗi lần vào trang.
// SSR-safe: khởi tạo bằng defaultValue, đọc localStorage sau khi mount (tránh hydration mismatch).
export function useLocalPref<T extends string>(key: string, defaultValue: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(defaultValue)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(`pref:${key}`)
      if (stored != null) setValue(stored as T)
    } catch { /* private mode / SSR */ }
  }, [key])

  const set = (v: T) => {
    setValue(v)
    try { window.localStorage.setItem(`pref:${key}`, v) } catch { /* ignore */ }
  }

  return [value, set]
}
