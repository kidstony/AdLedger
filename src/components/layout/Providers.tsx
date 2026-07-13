'use client'

import { ReactNode } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ConfirmProvider } from '@/components/ui/ConfirmDialog'
import { ProjectsProvider } from '@/context/ProjectsContext'
import { MasterProjectsProvider } from '@/context/MasterProjectsContext'
import { AuthProvider } from '@/context/AuthContext'
import { DateRangeProvider } from '@/context/DateRangeContext'
import { Toaster } from 'sonner'
import CommandPalette from '@/components/ui/CommandPalette'

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <DateRangeProvider>
        <MasterProjectsProvider>
          <ProjectsProvider>
            <TooltipProvider>
              <ConfirmProvider>
                {children}
                <CommandPalette />
                <Toaster position="bottom-right" richColors closeButton />
              </ConfirmProvider>
            </TooltipProvider>
          </ProjectsProvider>
        </MasterProjectsProvider>
      </DateRangeProvider>
    </AuthProvider>
  )
}
