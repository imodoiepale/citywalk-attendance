import { LogOut } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ROLE_META, type Role } from '@/lib/rbac-catalog'
import { signOutAction } from '@/app/(auth)/actions'

export default function UserMenu({
  fullName,
  branchName,
  role,
}: {
  fullName: string
  branchName: string
  role: Role
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-ink to-primary text-xs font-semibold text-brand-gold">
        {fullName
          .split(' ')
          .map((part) => part[0])
          .slice(0, 2)
          .join('')
          .toUpperCase()}
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
      <form action={signOutAction}>
        <button
          type="submit"
          aria-label="Sign out"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}
