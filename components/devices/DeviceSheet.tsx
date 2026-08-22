'use client'

import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { saveDeviceAction, type DeviceFormState } from '@/lib/biometric/actions'
import type { DeviceRow } from '@/lib/biometric/queries'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save device'}
    </Button>
  )
}

function DeviceForm({
  device,
  branches,
  onSuccess,
  onCancel,
  firstFieldRef,
}: {
  device?: DeviceRow
  branches: { id: string; name: string }[]
  onSuccess: () => void
  onCancel: () => void
  firstFieldRef: React.RefObject<HTMLInputElement | null>
}) {
  // Mirrors the server rule: only an attendance device needs a branch, so the
  // form has to react to the purpose being changed.
  const [purpose, setPurpose] = useState<string>(device?.purpose ?? 'attendance')
  const [state, formAction] = useActionState<DeviceFormState, FormData>(saveDeviceAction, {})

  useEffect(() => {
    if (state.ok) onSuccess()
  }, [state, onSuccess])

  return (
    <form action={formAction} className="space-y-4">
          {device ? <input type="hidden" name="id" value={device.id} /> : null}

          {state.error ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {state.error}
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="serial_no">Serial number</Label>
              <Input
                id="serial_no"
                name="serial_no"
                required
                ref={firstFieldRef}
                defaultValue={device?.serialNo}
                placeholder="AIO9214760077"
                className="uppercase"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">Device name</Label>
              <Input
                id="name"
                name="name"
                required
                defaultValue={device?.name}
                placeholder="HQ IN"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vendor">Protocol vendor</Label>
              <Select id="vendor" name="vendor" defaultValue={device?.vendor ?? 'zkteco'}>
                <option value="zkteco">ZKTeco</option>
                <option value="ebkn">EBKN / EN-K190</option>
                <option value="cams">Cams</option>
                <option value="generic">Generic</option>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="purpose">Purpose</Label>
              <Select
                id="purpose"
                name="purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
              >
                <option value="attendance">Attendance clock</option>
                <option value="access">Access control (restricted area)</option>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Access readers log scans but never create punches — a trip to the server room is
                not a shift.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="direction">Used for</Label>
              <Select id="direction" name="direction" defaultValue={device?.direction ?? 'both'}>
                <option value="both">In and out (toggles)</option>
                <option value="in">In only</option>
                <option value="out">Out only</option>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="branch_id">Branch</Label>
              <Select id="branch_id" name="branch_id" defaultValue={device?.branchId ?? ''}>
                <option value="">
                  {purpose === 'attendance' ? 'Select a branch…' : 'None (restricted area)'}
                </option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="location_label">Location label</Label>
              <Input
                id="location_label"
                name="location_label"
                defaultValue={device?.locationLabel ?? ''}
                placeholder="Server room"
              />
              <p className="text-[11px] text-muted-foreground">
                Shown instead of the branch for readers that guard a room.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="model">Model</Label>
              <Input id="model" name="model" defaultValue={device?.model ?? 'TFT500P'} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="node_id">Node ID</Label>
              <Input id="node_id" name="node_id" type="number" min="0" defaultValue={device?.nodeId ?? ''} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ip_address">IP address</Label>
              <Input
                id="ip_address"
                name="ip_address"
                defaultValue={device?.ipAddress ?? ''}
                placeholder="192.168.11.20"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="port">Port</Label>
              <Input id="port" name="port" type="number" min="1" defaultValue={device?.port ?? 4370} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="is_active"
              name="is_active"
              type="checkbox"
              defaultChecked={device?.isActive ?? true}
              className="h-4 w-4 rounded border-input"
            />
            <Label htmlFor="is_active" className="text-sm">
              Active — scans from this device are accepted
            </Label>
          </div>

          <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <SubmitButton />
          </div>
    </form>
  )
}

export default function DeviceSheet({
  device,
  branches,
  trigger,
}: {
  /** Omitted when adding. */
  device?: DeviceRow
  branches: { id: string; name: string }[]
  trigger?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : (
        <Button size="sm" data-tour="device-add" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          Add device
        </Button>
      )}

      <Dialog
        open={open}
        onClose={close}
        title={device ? `Edit ${device.name}` : 'Add a device'}
        description="Readers are identified by serial number — names and IP addresses change, serials do not."
        initialFocusRef={firstFieldRef}
      >
        {/* Remounted per open so a previous success or error does not persist. */}
        {open ? (
          <DeviceForm
            key={device?.id ?? 'new'}
            device={device}
            branches={branches}
            firstFieldRef={firstFieldRef}
            onSuccess={close}
            onCancel={close}
          />
        ) : null}
      </Dialog>
    </>
  )
}
