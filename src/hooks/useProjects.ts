'use client'

import { useProjectsContext } from '@/context/ProjectsContext'

export function useProjects() {
  return useProjectsContext()
}
