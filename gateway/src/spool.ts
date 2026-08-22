import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { log, errFields } from './log.ts'

// Anything that reaches the gateway must never be lost, including when the app,
// Supabase, the VPS network or the process itself is unavailable. Someone's
// shift quietly not existing is the one failure mode this system cannot have.
//
// So: every item is written to disk *before* any forward is attempted, and the
// file is deleted only after the app has acknowledged it. A crash between those
// two points causes a redelivery, not a loss — which is safe, because every
// item carries a stable identity and ingest is idempotent behind a unique
// index. At-least-once is the correct trade here; at-most-once loses punches.
//
// One file per item rather than one append-only log: acknowledging is then an
// unlink instead of a rewrite, and a single corrupt file quarantines itself
// instead of poisoning the whole queue.
//
// Generic over the item type because the gateway runs two of these — one for
// normalised scans, one for the raw-payload archive — and the retry, ordering
// and durability rules are identical for both.

export interface SpoolEntry<T> {
  file: string
  item: T
}

/** How an item names itself on disk: `sort` orders the queue, `id` dedupes it. */
export interface SpoolKey {
  sort: string
  id: string
}

export class Spool<T> {
  private readonly dir: string
  private readonly badDir: string
  private readonly keyOf: (item: T) => SpoolKey
  private seq = 0

  constructor(dir: string, keyOf: (item: T) => SpoolKey) {
    this.dir = dir
    this.badDir = path.join(dir, 'quarantine')
    this.keyOf = keyOf
    fs.mkdirSync(this.dir, { recursive: true })
    fs.mkdirSync(this.badDir, { recursive: true })
  }

  /**
   * Persists an item and returns its file path.
   *
   * The name is `<sort>-<hash of id>.json`: sorting by name replays in the
   * order things happened, and the hash means the same item arriving twice
   * overwrites one file instead of queueing two.
   */
  add(item: T): string {
    const key = this.keyOf(item)
    const stamp = key.sort.replace(/[:.]/g, '').replace('T', '-').replace('Z', '')
    const id = createHash('sha1').update(key.id).digest('hex').slice(0, 12)
    const file = path.join(this.dir, `${stamp}-${id}.json`)

    // Write to a temp name and rename: rename is atomic, so a reader can never
    // observe a half-written item even if the process dies mid-write.
    const tmp = `${file}.${process.pid}.${this.seq++}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(item), 'utf8')
    fs.renameSync(tmp, file)
    return file
  }

  /** Oldest-first batch of pending items. Unreadable files are quarantined, not skipped forever. */
  peek(limit: number): SpoolEntry<T>[] {
    const names = fs
      .readdirSync(this.dir)
      .filter((n) => n.endsWith('.json'))
      .sort()
      .slice(0, limit)

    const entries: SpoolEntry<T>[] = []
    for (const name of names) {
      const file = path.join(this.dir, name)
      try {
        entries.push({ file, item: JSON.parse(fs.readFileSync(file, 'utf8')) as T })
      } catch (e) {
        // Corrupt on disk. Move it aside so it stops blocking the queue head,
        // but keep it — it is still evidence that something happened.
        log.error('spool entry unreadable, quarantined', { file, ...errFields(e) })
        try {
          fs.renameSync(file, path.join(this.badDir, name))
        } catch {
          /* nothing further we can usefully do */
        }
      }
    }
    return entries
  }

  /** Called only after the app has acknowledged the batch. */
  ack(files: string[]): void {
    for (const file of files) {
      try {
        fs.unlinkSync(file)
      } catch (e) {
        // Already gone is fine; anything else means a redelivery, which is safe.
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
          log.warn('could not remove acknowledged spool entry', { file, ...errFields(e) })
        }
      }
    }
  }

  get pending(): number {
    return fs.readdirSync(this.dir).filter((n) => n.endsWith('.json')).length
  }

  get quarantined(): number {
    return fs.readdirSync(this.badDir).filter((n) => n.endsWith('.json')).length
  }
}
