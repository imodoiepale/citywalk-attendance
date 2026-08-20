import 'server-only'
import { createClient } from '@/lib/supabase/server'

export interface AuditEntry {
  id: number
  occurredAt: string
  source: 'user' | 'device' | 'system'
  actorId: string | null
  actorName: string | null
  actorEmail: string | null
  actorRole: string | null
  action: string
  entityType: string
  entityId: string | null
  summary: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

/**
 * Newest first. Capped rather than paged: the screen filters client-side so the
 * tab and filter counts describe the same set the table shows, and an audit
 * trail is read by recency in practice.
 */
export async function listAuditEntries(limit = 1000): Promise<AuditEntry[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('audit_log')
    .select('*')
    .order('occurred_at', { ascending: false })
    .limit(limit)

  return (data ?? []).map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    source: row.source,
    actorId: row.actor_id,
    actorName: row.actor_name,
    actorEmail: row.actor_email,
    actorRole: row.actor_role,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    before: row.before,
    after: row.after,
  }))
}
