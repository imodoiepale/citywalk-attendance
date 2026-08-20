import { requirePermission } from '@/lib/auth'
import { getSettings } from '@/lib/settings'
import { getFaceRoster } from '@/lib/face/queries'
import FaceSettingsSection from '@/components/face/FaceSettingsSection'
import { updateSettingsAction } from '@/lib/admin/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const FIELDS = [
  {
    name: 'dailyTargetHours',
    label: 'Daily target (hours)',
    hint: 'Full sweep of the dial, and the point overtime starts counting.',
    step: '0.25',
  },
  {
    name: 'weeklyTargetHours',
    label: 'Weekly target (hours)',
    hint: "The calendar's weekly progress ring.",
    step: '0.5',
  },
  {
    name: 'approachingThresholdHours',
    label: 'Approaching warning (hours)',
    hint: 'Dial turns amber here. Must be at or below the daily target.',
    step: '0.25',
  },
  {
    name: 'gracePeriodMinutes',
    label: 'Grace period (minutes)',
    hint: 'Allowance before a late clock-in counts as late.',
    step: '1',
  },
  {
    name: 'maxShiftHours',
    label: 'Maximum shift (hours)',
    hint: 'Shifts longer than this are flagged as likely forgotten clock-outs.',
    step: '0.5',
  },
] as const

export default async function AdminSettingsPage() {
  await requirePermission('admin.settings', 'full')
  const [settings, roster] = await Promise.all([getSettings(), getFaceRoster()])

  const values: Record<string, number> = {
    dailyTargetHours: settings.dailyTargetHours,
    weeklyTargetHours: settings.weeklyTargetHours,
    approachingThresholdHours: settings.approachingThresholdHours,
    gracePeriodMinutes: settings.gracePeriodMinutes,
    maxShiftHours: settings.maxShiftHours,
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-foreground sm:text-xl">Org settings</h1>
        <p className="text-xs text-muted-foreground">
          These drive the dial, the calendar heatmap and the overtime column on every timesheet.
          Changing them applies everywhere immediately — no deploy.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <form action={updateSettingsAction} className="space-y-4">
            {FIELDS.map((field) => (
              <div key={field.name} className="space-y-1">
                <Label htmlFor={field.name} className="text-sm">
                  {field.label}
                </Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type="number"
                  min="0"
                  step={field.step}
                  required
                  defaultValue={values[field.name]}
                  className="max-w-[12rem]"
                />
                <p className="text-xs text-muted-foreground">{field.hint}</p>
              </div>
            ))}

            <div className="border-t border-border pt-3">
              <Button type="submit">Save settings</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <FaceSettingsSection settings={settings} roster={roster} />
    </div>
  )
}
