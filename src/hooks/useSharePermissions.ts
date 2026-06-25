'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { SharePermissions } from '@/lib/types'

// Chỉ fetch khi role === 'member'. Với admin/manager trả về null (họ luôn có full access theo role).
export function useSharePermissions(projectId: string | null): SharePermissions | null {
  const { role } = useAuth()
  const [perms, setPerms] = useState<SharePermissions | null>(null)

  useEffect(() => {
    if (role !== 'member' || !projectId) {
      setPerms(null)
      return
    }

    let cancelled = false

    async function fetch_() {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token ?? ''
      const res = await fetch(`/api/projects/${projectId}/my-permissions`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!cancelled && res.ok) setPerms(await res.json())
    }

    fetch_()
    return () => { cancelled = true }
  }, [role, projectId])

  return perms
}
