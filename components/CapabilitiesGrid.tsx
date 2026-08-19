import {
  CheckCircle2,
  MapPin,
  ScanFace,
  WifiOff,
  ClipboardCheck,
  CalendarClock,
  Wallet,
  CalendarRange,
  BarChart3,
  BellRing,
  Bot,
  ClipboardList,
  CalendarDays,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

interface Capability {
  title: string
  description: string
  icon: LucideIcon
  status: 'live' | 'wip'
}

const capabilities: Capability[] = [
  {
    title: 'Manual clock in/out',
    description: 'One-tap punch with a live shift timer on the dial.',
    icon: CheckCircle2,
    status: 'live',
  },
  {
    title: 'Punches saved to your account',
    description: 'Signed-in, backed by a real database — visible from any device.',
    icon: ClipboardCheck,
    status: 'live',
  },
  {
    title: 'Leave requests & approvals',
    description: 'Request your own leave, or have a manager/HR file it for you.',
    icon: ClipboardList,
    status: 'live',
  },
  {
    title: 'Calendar & daily hours',
    description: 'A month view of hours worked per day, plus a weekly progress ring.',
    icon: CalendarDays,
    status: 'live',
  },
  {
    title: 'Branch & org reports',
    description: 'Hours and leave, per branch or across every Citywalk brand.',
    icon: BarChart3,
    status: 'live',
  },
  {
    title: 'Role-based access & admin',
    description: 'Staff, Branch Manager, HR/Accounts, Admin — with an editable rights matrix.',
    icon: ShieldCheck,
    status: 'live',
  },
  {
    title: 'Sign-up with branch selection',
    description: 'New staff pick their branch when they create an account.',
    icon: Users,
    status: 'live',
  },
  {
    title: 'Geofenced punches',
    description: 'Only allow a punch from within branch premises.',
    icon: MapPin,
    status: 'wip',
  },
  {
    title: 'Biometric verification',
    description: 'Face or fingerprint check to stop buddy-punching.',
    icon: ScanFace,
    status: 'wip',
  },
  {
    title: 'Offline-first punching',
    description: 'Punch with no signal; sync automatically once online.',
    icon: WifiOff,
    status: 'wip',
  },
  {
    title: 'Punch correction & approval',
    description: 'A manager reviewing and approving edits to a missed or wrong punch (separate from leave approval, which is live).',
    icon: CalendarClock,
    status: 'wip',
  },
  {
    title: 'Payroll & overtime sync',
    description: 'Push approved hours straight into payroll runs.',
    icon: Wallet,
    status: 'wip',
  },
  {
    title: 'Shift scheduling & rota',
    description: 'Plan shifts and compare actual vs. scheduled hours.',
    icon: CalendarRange,
    status: 'wip',
  },
  {
    title: 'Reminders & notifications',
    description: 'Nudge staff who forget to clock in or out.',
    icon: BellRing,
    status: 'wip',
  },
  {
    title: 'AI Assistant',
    description: 'Anomaly detection, natural-language timesheet queries and smart shift suggestions.',
    icon: Bot,
    status: 'wip',
  },
]

export default function CapabilitiesGrid() {
  return (
    <div className="mx-auto w-full max-w-4xl">
      <h2 className="mb-1 text-center text-lg font-semibold text-foreground">Capabilities</h2>
      <p className="mb-5 text-center text-sm text-muted-foreground">
        What&rsquo;s live today, and what&rsquo;s on the roadmap — see{' '}
        <code className="rounded bg-secondary px-1 py-0.5 text-xs">docs/00-INDEX.md</code> in this
        repo for the full plan.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {capabilities.map((cap) => (
          <Card key={cap.title} className="h-full">
            <CardContent className="flex h-full flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <cap.icon className="h-5 w-5 text-primary-strong" strokeWidth={1.8} />
                <Badge variant={cap.status === 'live' ? 'success' : 'warning'}>
                  {cap.status === 'live' ? 'Live' : 'Work in Progress'}
                </Badge>
              </div>
              <h3 className="text-sm font-semibold text-foreground">{cap.title}</h3>
              <p className="text-xs text-muted-foreground">{cap.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
