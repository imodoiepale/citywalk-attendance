'use client'

import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { DoorOpen, Clock, RotateCw, Download, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  queueCommandAction, readCommandStatus,
  type CommandState, type CommandStatus,
} from '@/lib/biometric/device-actions'

// Commands an operator can send to one reader.
//
// The set is deliberately short. A generic "send any command" box would be more
// flexible and much worse: these devices accept `initsys` (factory reset) and
// `cleanuser` (wipe every enrolment), and those do not belong one mis-click
// away from "sync clock".

interface Action {
  command: string
  label: string
  hint: string
  icon: typeof DoorOpen
  /** Actions with a physical, immediate effect ask before firing. */
  confirm?: string
}

const ACTIONS: Action[] = [
  { command: 'getdevinfo', label: 'Refresh info', hint: 'Re-read model, firmware and capacity', icon: Download },
  { command: 'settime', label: 'Sync clock', hint: 'Set the device clock from the server', icon: Clock },
  { command: 'getnewlog', label: 'Pull missed scans', hint: 'Backfill punches recorded while offline', icon: Download },
  { command: 'getallusers', label: 'List users on device', hint: 'Read back who this reader holds', icon: Users },
  {
    command: 'opendoor', label: 'Open door', hint: 'Release the strike now',
    icon: DoorOpen, confirm: 'Open the door on this device now?',
  },
  {
    command: 'reboot', label: 'Reboot', hint: 'Restart the terminal',
    icon: RotateCw, confirm: 'Reboot this device? It will be offline for a minute or two.',
  },
]

function Submit({ label, icon: Icon }: { label: string; icon: typeof DoorOpen }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending} className="w-full justify-start">
      <Icon className="h-4 w-4" />
      {pending ? 'Sending…' : label}
    </Button>
  )
}

/**
 * Watches one queued command until it settles.
 *
 * The gateway polls for work every couple of seconds, so a result is not
 * instant. Showing "queued" rather than a spinner is the honest state: if the
 * device is offline the command stays queued until it reconnects, which is
 * intended behaviour and not a failure.
 */
function CommandProgress({ commandId }: { commandId: string }) {
  const [status, setStatus] = useState<CommandStatus | null>(null)

  useEffect(() => {
    let live = true
    const tick = async () => {
      const next = await readCommandStatus(commandId)
      if (!live) return
      setStatus(next)
      if (next && (next.status === 'queued' || next.status === 'sent')) {
        setTimeout(() => void tick(), 1500)
      }
    }
    void tick()
    return () => { live = false }
  }, [commandId])

  if (!status) return <p className="text-xs text-muted-foreground">Queued…</p>

  const tone =
    status.status === 'succeeded' ? 'text-success'
    : status.status === 'failed' || status.status === 'expired' ? 'text-destructive'
    : 'text-muted-foreground'

  const wording: Record<CommandStatus['status'], string> = {
    queued: 'Queued — waiting for the device to connect',
    sent: 'Sent, waiting for the device to answer',
    succeeded: 'Done',
    failed: 'Failed',
    expired: 'Expired before the device came back',
  }

  return (
    <p className={`text-xs ${tone}`}>
      {wording[status.status]}
      {status.error ? `: ${status.error}` : ''}
    </p>
  )
}

export default function DeviceActions({ serialNo, online }: { serialNo: string; online: boolean }) {
  const [state, formAction] = useActionState<CommandState, FormData>(queueCommandAction, {})

  return (
    <div className="space-y-3">
      {!online ? (
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
          This device is not currently connected. Commands will queue and go out the moment it
          reconnects — nothing is lost by sending them now.
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        {ACTIONS.map((action) => (
          <form
            key={action.command}
            action={formAction}
            onSubmit={(e) => {
              if (action.confirm && !window.confirm(action.confirm)) e.preventDefault()
            }}
          >
            <input type="hidden" name="serial_no" value={serialNo} />
            <input type="hidden" name="command" value={action.command} />
            <Submit label={action.label} icon={action.icon} />
            <p className="mt-1 text-xs text-muted-foreground">{action.hint}</p>
          </form>
        ))}
      </div>

      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      {state.commandId ? <CommandProgress commandId={state.commandId} /> : null}
    </div>
  )
}

/** Ask a reader to capture a fingerprint for one enrolment number. */
export function FingerprintEnrolForm({
  serials, defaultEnrollId, profileId, action,
}: {
  serials: { serial: string; name: string; online: boolean }[]
  defaultEnrollId: string
  profileId: string
  action: (prev: CommandState, data: FormData) => Promise<CommandState>
}) {
  const [state, formAction] = useActionState<CommandState, FormData>(action, {})

  if (serials.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No reader supports remote enrolment yet. A device must be connected on the cloud channel
        (port 7788) for this.
      </p>
    )
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="profile_id" value={profileId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="serial_no">Reader</Label>
          <select
            id="serial_no"
            name="serial_no"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {serials.map((s) => (
              <option key={s.serial} value={s.serial}>
                {s.name}{s.online ? '' : ' (offline)'}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="enroll_id">Enrollment number</Label>
          <Input id="enroll_id" name="enroll_id" defaultValue={defaultEnrollId} required />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        The reader will wait for a finger. Once captured, the template uploads here and copies to
        every other compatible reader automatically.
      </p>

      <Submit label="Start enrolment" icon={Users} />

      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      {state.commandId ? <CommandProgress commandId={state.commandId} /> : null}
    </form>
  )
}
