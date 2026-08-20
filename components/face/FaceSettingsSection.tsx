import { ScanFace, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowNumber,
  TableRowNumberHead,
} from '@/components/ui/table'
import { updateFaceSettingsAction } from '@/lib/admin/actions'
import type { AppSettings } from '@/lib/settings'
import type { FaceRosterRow } from '@/lib/face/queries'

const STATUS: Record<
  string,
  { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }
> = {
  enrolled: { label: 'Active', variant: 'success' },
  pending: { label: 'Awaiting camera', variant: 'warning' },
  failed: { label: 'Rejected', variant: 'destructive' },
  revoked: { label: 'Removed', variant: 'secondary' },
  none: { label: 'No photo', variant: 'secondary' },
}

export default function FaceSettingsSection({
  settings,
  roster,
}: {
  settings: AppSettings
  roster: FaceRosterRow[]
}) {
  const enrolled = roster.filter((r) => r.status === 'enrolled').length
  const missing = roster.filter((r) => r.status === 'none').length

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ScanFace className="h-4 w-4 text-primary-strong" strokeWidth={1.8} />
            Face recognition
          </h2>
          <Badge variant={settings.faceEnabled ? 'success' : 'secondary'}>
            {settings.faceEnabled ? 'On' : 'Off'}
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground">
          Staff add their own photo from their profile, with recorded consent. The photo is sent to
          Citywalk&rsquo;s cameras, which do the matching and return an ID &mdash; this app never
          stores a face template. Switching this on only opens enrolment; the cameras still need
          pointing at the ingest endpoint.
        </p>

        {/* Turning this on starts collecting biometric data, so the obligation
            is stated at the switch rather than buried in a policy document. */}
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span>
            A face photo is biometric personal data under Kenya&rsquo;s Data Protection Act. Bump the
            consent version whenever the wording changes &mdash; staff who agreed to an older version
            are asked again.
          </span>
        </div>

        <form action={updateFaceSettingsAction} className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              id="face_enabled"
              name="face_enabled"
              type="checkbox"
              defaultChecked={settings.faceEnabled}
              className="h-4 w-4 rounded border-input"
            />
            <Label htmlFor="face_enabled" className="text-sm">
              Allow staff to enrol a face photo
            </Label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="face_min_confidence" className="text-xs">
                Match confidence
              </Label>
              <Input
                id="face_min_confidence"
                name="face_min_confidence"
                type="number"
                step="0.005"
                min="0.5"
                max="1"
                defaultValue={settings.faceMinConfidence}
                className="h-8 text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Below this, a match is not treated as an identification.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="face_retention_days" className="text-xs">
                Keep photos for (days)
              </Label>
              <Input
                id="face_retention_days"
                name="face_retention_days"
                type="number"
                min="1"
                defaultValue={settings.faceRetentionDays}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="face_reenroll_days" className="text-xs">
                Re-enrol after (days)
              </Label>
              <Input
                id="face_reenroll_days"
                name="face_reenroll_days"
                type="number"
                min="1"
                defaultValue={settings.faceReenrollDays}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="face_consent_version" className="text-xs">
                Consent version
              </Label>
              <Input
                id="face_consent_version"
                name="face_consent_version"
                defaultValue={settings.faceConsentVersion}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <Button type="submit" size="sm">
            Save face settings
          </Button>
        </form>

        <div className="space-y-2 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Enrolment roster</h3>
            {/* Driven from staff, not from enrolments, so the people *without* a
                photo appear — which is the question actually being asked. */}
            <p className="text-xs text-muted-foreground">
              {enrolled} enrolled &middot; {missing} without a photo
            </p>
          </div>
          <Table containerClassName="max-h-72 overflow-y-auto rounded-lg border border-border">
            <TableHeader>
              <TableRow>
                <TableRowNumberHead className="sticky top-0 z-10 bg-secondary" />
                <TableHead className="sticky top-0 z-10 bg-secondary">Staff</TableHead>
                <TableHead className="sticky top-0 z-10 bg-secondary">Branch</TableHead>
                <TableHead className="sticky top-0 z-10 bg-secondary">Face</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roster.map((row, index) => {
                const status = STATUS[row.status] ?? STATUS.none
                return (
                  <TableRow key={row.profileId}>
                    <TableRowNumber value={index + 1} />
                    <TableCell>
                      <div className="font-medium text-foreground">{row.fullName}</div>
                      <div className="text-xs text-muted-foreground">{row.email}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.branchName ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
