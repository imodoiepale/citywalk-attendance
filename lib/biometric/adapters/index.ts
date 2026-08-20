import type { Adapter } from '../types'
import { genericAdapter } from './generic'
import { zktecoAdapter } from './zkteco'

// The seam. Supporting another vendor is one file here plus one line below —
// ingest, processing and every screen stay untouched.
const ADAPTERS: Record<string, Adapter> = {
  generic: genericAdapter,
  zkteco: zktecoAdapter,
}

export function getAdapter(name: string | null | undefined): Adapter {
  return ADAPTERS[(name ?? 'generic').toLowerCase()] ?? genericAdapter
}

export { genericAdapter, zktecoAdapter }
