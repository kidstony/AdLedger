'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Project, MasterProject } from '@/lib/types'

interface Props {
  mode: 'add' | 'edit'
  initialData?: Project
  existingIds: string[]
  masterProjects: MasterProject[]
  onSave: (project: Project) => void
  onClose: () => void
}

export default function ProjectFormDialog({ mode, initialData, existingIds, masterProjects, onSave, onClose }: Props) {
  const [form, setForm] = useState<Project>(
    initialData ?? { project_id: '', cid: '0000000000', name: '', mcc_id: 'uncategorized', master_project_id: null }
  )
  const [errors, setErrors] = useState<Partial<Record<keyof Project, string>>>({})

  function validate(): boolean {
    const errs: Partial<Record<keyof Project, string>> = {}
    if (!form.project_id.match(/^proj\d{3}$/)) errs.project_id = 'Định dạng: proj001'
    if (mode === 'add' && existingIds.includes(form.project_id)) errs.project_id = 'ID đã tồn tại'
    if (!form.name.trim()) errs.name = 'Bắt buộc nhập tên'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  function handleSave() {
    if (validate()) {
      onSave(form)
      onClose()
    }
  }

  function field(key: 'project_id' | 'name', label: string, placeholder: string, disabled = false) {
    return (
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-600">{label}</label>
        <Input
          value={form[key]}
          disabled={disabled}
          placeholder={placeholder}
          onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          className={errors[key] ? 'border-red-400' : ''}
        />
        {errors[key] && <p className="text-xs text-red-500">{errors[key]}</p>}
      </div>
    )
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'add' ? 'Thêm dự án mới' : 'Chỉnh sửa dự án'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {field('project_id', 'Project ID', 'proj001', mode === 'edit')}
          {field('name', 'Tên dự án', 'Thời trang nữ 001')}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Tổng Dự Án (tuỳ chọn)</label>
            <select
              value={form.master_project_id ?? ''}
              onChange={e => setForm(f => ({ ...f, master_project_id: e.target.value || null }))}
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
            >
              <option value="">— Chưa phân nhóm —</option>
              {masterProjects.map(mp => <option key={mp.id} value={mp.id}>{mp.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Hủy</Button>
            <Button onClick={handleSave}>Lưu</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
