// Where a batch ends up. The Forwarder owns durability, ordering, batching and
// backoff; a Delivery owns only "put these somewhere and say what happened".
// That split is what lets the same spool serve both the direct-to-Supabase path
// and the app-webhook path without either knowing about the other.

export type DeliveryOutcome =
  /** Stored. Remove from the spool. */
  | 'ok'
  /** Transient. Keep on disk and try again with backoff. */
  | 'retry'
  /** Permanently unusable. Remove, because retrying blocks everything behind it. */
  | 'drop'

export type Delivery<T> = (items: T[]) => Promise<DeliveryOutcome>
