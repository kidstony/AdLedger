'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useProjectsContext } from '@/context/ProjectsContext'
import { useAuth } from '@/context/AuthContext'
import BankTab from '@/components/projects/BankTab'

export default function BanksPage() {
  const { projects } = useProjectsContext()
  const { role } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (role === 'member') router.replace('/dashboard')
  }, [role, router])

  if (role === 'member') return null

  return (
    <div className="p-6 space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-800">Quản lý Bank</h2>
        <p className="text-sm text-slate-500 mt-0.5">Quản lý ngân hàng và tài khoản nhận tiền</p>
      </div>
      <BankTab projects={projects} />
    </div>
  )
}
