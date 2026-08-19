import { Badge } from '@/components/ui/badge'
import { ROLE_META, type Role } from '@/lib/rbac-catalog'
import SignOutButton from './SignOutButton'

export default function UserMenu({
  fullName,
  branchName,
  role,
  compact = false,
}: {
  fullName: string
  branchName: string
  role: Role
  /** Avatar + sign-out only — the mobile header has no room for the full card. */
  compact?: boolean
}) {
  const initials = fullName
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <div
          title={`${fullName} — ${branchName}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-ink to-primary text-xs font-semibold text-brand-gold"
        >
          {initials}
        </div>
        <SignOutButton fullName={fullName} />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-ink to-primary text-xs font-semibold text-brand-gold">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{fullName}</p>
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs text-muted-foreground">{branchName}</span>
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
            {ROLE_META[role].label}
          </Badge>
        </div>
      </div>
      <SignOutButton fullName={fullName} />
    </div>
  )
}
