import { redirect } from 'next/navigation'

export default function Page() {
  redirect('/projects?tab=master')
}
