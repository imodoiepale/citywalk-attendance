import type { Role } from '@/lib/rbac-catalog'

// Guided tours, keyed by route and role.
//
// Two rules shape these:
//
//  1. A tour must only point at things the viewer can actually see. Highlighting
//     an element that a role's permissions hid produces an overlay pointing at
//     nothing, which is worse than no tour.
//  2. Managers, HR and IT clock in like everyone else. Their tours therefore
//     start from the same clock steps as staff and then extend, rather than
//     being a separate track that skips the thing they have to do every day.

export interface TourStep {
  /** Matches a data-tour="…" attribute. Steps whose target is absent are skipped. */
  target: string
  title: string
  description: string
  side?: 'top' | 'bottom' | 'left' | 'right'
}

export interface TourDefinition {
  id: string
  title: string
  steps: TourStep[]
}

/** Everyone, on the dashboard: the daily job. */
const CLOCK_STEPS: TourStep[] = [
  {
    target: 'clock-header',
    title: "Today's date and time",
    description:
      'The live clock, in Nairobi time. This is the time your punches are recorded against, whatever the device says.',
    side: 'bottom',
  },
  {
    target: 'clock-dial',
    title: 'Hours worked today',
    description:
      'Counts up while you are clocked in. If you clock out for lunch and back in, it carries on from where it was — it does not restart.',
    side: 'bottom',
  },
  {
    target: 'clock-button',
    title: 'Clock in and out',
    description:
      'One tap to start your shift, one to end it. If your branch has a biometric reader, scanning there does the same thing automatically.',
    side: 'top',
  },
  {
    target: 'today-summary',
    title: 'Your week at a glance',
    description: 'Hours today, hours over the last seven days, and any leave you are waiting on.',
    side: 'top',
  },
]

const NAV_STEP: TourStep = {
  target: 'nav',
  title: 'Everything else',
  description: 'Your calendar, leave and reports live here. The screens you see depend on your role.',
  side: 'right',
}

const HELP_STEP: TourStep = {
  target: 'help-button',
  title: 'Stuck? Start here',
  description: 'This button replays the walkthrough for whichever screen you are on. It never goes away.',
  side: 'bottom',
}

const APPROVER_STEPS: TourStep[] = [
  {
    target: 'nav',
    title: 'Approvals and corrections are yours',
    description:
      "Leave requests from your branch wait for you under Approvals. Corrections — someone forgetting to clock out — wait under Corrections. Nobody else will action them.",
    side: 'right',
  },
]

export const TOURS: Record<string, Partial<Record<Role | 'default', TourDefinition>>> = {
  '/': {
    staff: {
      id: 'dashboard-staff-v1',
      title: 'Your daily clock',
      steps: [...CLOCK_STEPS, NAV_STEP, HELP_STEP],
    },
    branch_manager: {
      id: 'dashboard-manager-v1',
      title: 'Your clock, and your branch',
      steps: [...CLOCK_STEPS, ...APPROVER_STEPS, HELP_STEP],
    },
    hr_accounts: {
      id: 'dashboard-hr-v1',
      title: 'Your clock, and the whole company',
      steps: [
        ...CLOCK_STEPS,
        {
          target: 'nav',
          title: 'Every branch is yours',
          description:
            'Approvals, corrections, timesheets and reports cover all branches, not just the one you are attached to. Timesheets is where payroll numbers come from.',
          side: 'right',
        },
        HELP_STEP,
      ],
    },
    admin: {
      id: 'dashboard-admin-v1',
      title: 'Your clock, and the system',
      steps: [
        ...CLOCK_STEPS,
        {
          target: 'nav',
          title: 'You run the system',
          description:
            'Admin holds users, roles, branches, devices and settings. You also clock in like everyone else — this dial is yours too.',
          side: 'right',
        },
        HELP_STEP,
      ],
    },
  },

  '/calendar': {
    default: {
      id: 'calendar-v1',
      title: 'Your hours, day by day',
      steps: [
        {
          target: 'weekly-ring',
          title: 'This week against your target',
          description: 'Hours over the last seven days, measured against the org target.',
          side: 'bottom',
        },
        {
          target: 'month-calendar',
          title: 'Tap any day',
          description:
            'Darker means more hours worked. Tap a day to see the individual punches — and to ask for a correction if one is wrong.',
          side: 'top',
        },
      ],
    },
  },

  '/leave': {
    default: {
      id: 'leave-v1',
      title: 'Requesting leave',
      steps: [
        {
          target: 'request-leave',
          title: 'Ask for leave here',
          description:
            'Pick the type and dates. It opens in a panel — you do not lose this page. Your manager or HR decides, and you will be told the next time you open the app.',
          side: 'left',
        },
        {
          target: 'leave-list',
          title: 'Track what you asked for',
          description: 'Pending requests can still be cancelled. Decided ones show who decided and why.',
          side: 'top',
        },
      ],
    },
  },

  '/leave/approvals': {
    default: {
      id: 'approvals-v1',
      title: 'Deciding leave',
      steps: [
        {
          target: 'approval-tabs',
          title: 'Pending is your queue',
          description:
            'The number on each tab is how many requests are in it. Approved, Rejected and Cancelled are there for when you need to look back.',
          side: 'bottom',
        },
        {
          target: 'approval-filters',
          title: 'Narrow it down',
          description:
            'Search by name, or filter by branch and leave type. The counts show what each filter would leave.',
          side: 'bottom',
        },
        {
          target: 'approval-table',
          title: 'Approve or reject',
          description:
            'Use the ⋯ menu on a pending row. You can add a note — the person sees it with the decision.',
          side: 'top',
        },
      ],
    },
  },

  '/attendance/corrections': {
    default: {
      id: 'corrections-v1',
      title: 'Fixing wrong punches',
      steps: [
        {
          target: 'corrections-queue',
          title: 'Someone forgot to clock out',
          description:
            'Each card shows what was recorded against what is being proposed, and why. Approving rewrites the punch and updates every report.',
          side: 'top',
        },
      ],
    },
  },

  '/reports/timesheets': {
    default: {
      id: 'timesheets-v1',
      title: 'Timesheets and payroll export',
      steps: [
        {
          target: 'timesheet-filters',
          title: 'Choose the period',
          description:
            'Pay periods, months, or a custom range. Branch managers see their own branch; HR and Admin can pick any branch or all of them.',
          side: 'bottom',
        },
        {
          target: 'timesheet-export',
          title: 'Export for payroll',
          description:
            'Excel is the styled one people read. PDF is for signing off. CSV is for importing elsewhere. All three match the filters shown.',
          side: 'bottom',
        },
        {
          target: 'timesheet-table',
          title: 'Read across',
          description:
            'One row per person, one column per day. Collapse the day columns to see weeks instead. Overtime is anything past the daily target.',
          side: 'top',
        },
      ],
    },
  },

  '/admin/users': {
    default: {
      id: 'admin-users-v1',
      title: 'Managing people',
      steps: [
        {
          target: 'admin-links',
          title: 'The rest of the admin area',
          description: 'Role rights, branches, devices and org settings all live behind these.',
          side: 'bottom',
        },
        {
          target: 'admin-user-table',
          title: 'Roles and access',
          description:
            'Change someone’s role, or deactivate them to revoke access without deleting their history. Your own row is read-only — you cannot lock yourself out.',
          side: 'top',
        },
      ],
    },
  },

  '/admin/devices': {
    default: {
      id: 'admin-devices-v1',
      title: 'Biometric devices',
      steps: [
        {
          target: 'device-health',
          title: 'Is the estate healthy?',
          description:
            'Online means the reader checked in within the last 15 minutes. Offline or never-reported means scans are not reaching us — those shifts will be missing.',
          side: 'bottom',
        },
        {
          target: 'device-add',
          title: 'Add a reader',
          description:
            'Devices are identified by serial number. Set the purpose carefully: an access reader on a server-room door logs entry but must never clock anyone in.',
          side: 'left',
        },
        {
          target: 'device-links',
          title: 'Enrollments and unmatched scans',
          description:
            'A reader knows a person as a number. Map those numbers to staff under Enrollments. Anything unmapped waits under Unmatched scans — and is applied retroactively once you map it.',
          side: 'bottom',
        },
      ],
    },
  },
}

/**
 * The tour for a route and role, if there is one.
 *
 * Falls back to the route's `default` entry so a screen that is the same for
 * everyone only needs writing once.
 */
export function tourFor(routeKey: string, role: Role): TourDefinition | null {
  const byRole = TOURS[routeKey]
  if (!byRole) return null
  return byRole[role] ?? byRole.default ?? null
}
