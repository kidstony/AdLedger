'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useProjectsContext } from '@/context/ProjectsContext'
import { useAuth } from '@/context/AuthContext'
import BankTab from '@/components/projects/BankTab'
import PageHeader from '@/components/ui/PageHeader'

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
      <PageHeader title="Quản lý Bank" subtitle="Quản lý ngân hàng và tài khoản nhận tiền" />
      <BankTab projects={projects} />
    </div>
  )
}
