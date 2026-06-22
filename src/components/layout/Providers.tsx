'use client'

import { ReactNode } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ProjectsProvider } from '@/context/ProjectsContext'
import { MasterProjectsProvider } from '@/context/MasterProjectsContext'
import { AuthProvider } from '@/context/AuthContext'

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <MasterProjectsProvider>
        <ProjectsProvider>
          <TooltipProvider>
            {children}
          </TooltipProvider>
        </ProjectsProvider>
      </MasterProjectsProvider>
    </AuthProvider>
  )
}
