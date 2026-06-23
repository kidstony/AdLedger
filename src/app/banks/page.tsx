'use client'

import { useProjectsContext } from '@/context/ProjectsContext'
import BankTab from '@/components/projects/BankTab'

export default function BanksPage() {
  const { projects } = useProjectsContext()

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
