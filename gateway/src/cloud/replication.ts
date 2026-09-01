import { open, type TemplateKey } from './crypto.ts'
import { setUserInfo } from './commands.ts'
import type { Persistence } from './persistence.ts'
import type { DeviceSession } from './session.ts'
import { log, errFields } from '../log.ts'

export interface CredentialReplicatorDeps {
  persistence: Persistence
  templateKeys: TemplateKey[]
  sessionFor(serial: string): DeviceSession | undefined
  onlineSerials(): string[]
  pollIntervalMs?: number
  batchSize?: number
}

export class CredentialReplicator {
  private readonly deps: CredentialReplicatorDeps
  private readonly pollIntervalMs: number
  private readonly batchSize: number
  private timer: NodeJS.Timeout | null = null
  private ticking = false

  constructor(deps: CredentialReplicatorDeps) {
    this.deps = deps
    this.pollIntervalMs = deps.pollIntervalMs ?? 5_000
    this.batchSize = deps.batchSize ?? 25
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs)
    this.timer.unref?.()
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      await Promise.all(this.deps.onlineSerials().map((serial) => this.flushDevice(serial)))
    } finally {
      this.ticking = false
    }
  }

  async flushDevice(serial: string): Promise<void> {
    const session = this.deps.sessionFor(serial)
    if (!session) return

    const rows = await this.deps.persistence.claimPendingCredentials(serial, this.batchSize)
    for (const row of rows) {
      try {
        const template = open(
          { ciphertext: row.template_sealed, keyId: row.template_key_id },
          this.deps.templateKeys
        )
        const reply = await session.request(
          setUserInfo({
            enrollId: row.external_user_id,
            backupNum: row.backup_num,
            record: template,
            name: row.full_name ?? undefined,
          })
        )
        const ok = reply.result !== false
        await this.deps.persistence.updateCredentialState(
          serial,
          row.credential_id,
          ok,
          ok ? null : String(reply.reason ?? 'device refused the credential')
        )
      } catch (e) {
        await this.deps.persistence.updateCredentialState(
          serial,
          row.credential_id,
          false,
          e instanceof Error ? e.message : String(e)
        )
        log.warn('credential replication failed', {
          serial,
          credentialId: row.credential_id,
          ...errFields(e),
        })
      }
    }
  }
}
