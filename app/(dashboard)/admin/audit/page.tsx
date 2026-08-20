import { requirePermission } from '@/lib/auth'
import { listAuditEntries } from '@/lib/audit/queries'
import AuditTable from '@/components/audit/AuditTable'

export default async function AuditPage() {
  // Deliberately gated on admin.users rather than a branch-level right: an
  // audit trail names who did what to whom, which is a governance surface
  // rather than an operational one.
  await requirePermission('admin.users', 'full')
  const entries = await listAuditEntries()

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-foreground sm:text-xl">Audit log</h1>
        <p className="text-xs text-muted-foreground">
          Every privileged action — role and permission changes, settings, enrollments — with who
          did it and what changed. Actor names are kept even if that account is later deleted.
        </p>
      </div>

      <AuditTable entries={entries} nowIso={new Date().toISOString()} />
    </div>
  )
}
