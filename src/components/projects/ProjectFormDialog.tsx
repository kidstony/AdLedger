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

function nextProjectId(existingIds: string[]): string {
  const nums = existingIds
    .map(id => parseInt(id.replace('proj', ''), 10))
    .filter(n => !isNaN(n))
  const max = nums.length > 0 ? Math.max(...nums) : 0
  return `proj${String(max + 1).padStart(3, '0')}`
}

export default function ProjectFormDialog({ mode, initialData, existingIds, masterProjects, onSave, onClose }: Props) {
  const [form, setForm] = useState<Project>(
    initialData ?? { project_id: nextProjectId(existingIds), cid: '0000000000', name: '', mcc_id: 'uncategorized', master_project_id: null }
  )
  const [errors, setErrors] = useState<Partial<Record<keyof Project, string>>>({})

  function validate(): boolean {
    const errs: Partial<Record<keyof Project, string>> = {}
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

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'add' ? 'Thêm dự án mới' : 'Chỉnh sửa dự án'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {mode === 'edit' && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Project ID</label>
              <Input value={form.project_id} disabled className="text-slate-400" />
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Tên dự án</label>
            <Input
              value={form.name}
              placeholder="Thời trang nữ 001"
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className={errors.name ? 'border-red-400' : ''}
              autoFocus
            />
            {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
          </div>
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
