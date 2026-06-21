'use client'

import { ReactNode } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ProjectsProvider } from '@/context/ProjectsContext'

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ProjectsProvider>
      <TooltipProvider>
        {children}
      </TooltipProvider>
    </ProjectsProvider>
  )
}
