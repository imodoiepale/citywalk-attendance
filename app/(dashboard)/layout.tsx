import { requireUser } from '@/lib/auth'
import AppShell from '@/components/shell/AppShell'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  return <AppShell user={user}>{children}</AppShell>
}
