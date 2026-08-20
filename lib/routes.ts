// One label map for every reachable route.
//
// Built separately from NAV rather than derived from it: NAV covers 8 of the 21
// dashboard routes, so a breadcrumb built from NAV alone has no label for /me,
// /leave/new, /calendar/[date], /admin/users/[id], /admin/branches,
// /admin/settings, /admin/permissions or any of the device screens.
//
// `href: null` marks a path segment that exists in the URL but has no page —
// /admin and /attendance are grouping folders, not routes. Rendering them as
// links would produce a crumb that 404s.

export interface RouteNode {
  /** Path segment as it appears in the URL. */
  segment: string
  label: string
  /** Null when the segment has no page of its own. */
  href: string | null
  /** True for [date] / [id] style segments, whose label comes from the page. */
  dynamic?: boolean
}

export const ROUTE_LABELS: Record<string, RouteNode> = {
  '/': { segment: '', label: 'Dashboard', href: '/' },

  '/me': { segment: 'me', label: 'My profile', href: '/me' },

  '/calendar': { segment: 'calendar', label: 'Calendar', href: '/calendar' },
  '/calendar/[date]': { segment: '[date]', label: 'Day', href: null, dynamic: true },

  '/leave': { segment: 'leave', label: 'Leave', href: '/leave' },
  '/leave/new': { segment: 'new', label: 'Request leave', href: '/leave/new' },
  '/leave/approvals': { segment: 'approvals', label: 'Approvals', href: '/leave/approvals' },

  // No page at /attendance — it only groups the corrections screen.
  '/attendance': { segment: 'attendance', label: 'Attendance', href: null },
  '/attendance/corrections': {
    segment: 'corrections',
    label: 'Corrections',
    href: '/attendance/corrections',
  },

  '/reports': { segment: 'reports', label: 'Reports', href: '/reports' },
  '/reports/timesheets': { segment: 'timesheets', label: 'Timesheets', href: '/reports/timesheets' },
  '/reports/builder': { segment: 'builder', label: 'Report builder', href: '/reports/builder' },

  // No page at /admin either — /admin/users is the landing screen.
  '/admin': { segment: 'admin', label: 'Admin', href: null },
  '/admin/users': { segment: 'users', label: 'Users', href: '/admin/users' },
  '/admin/users/[id]': { segment: '[id]', label: 'User', href: null, dynamic: true },
  '/admin/permissions': { segment: 'permissions', label: 'Role rights', href: '/admin/permissions' },
  '/admin/branches': { segment: 'branches', label: 'Branches', href: '/admin/branches' },
  '/admin/settings': { segment: 'settings', label: 'Org settings', href: '/admin/settings' },
  '/admin/audit': { segment: 'audit', label: 'Audit log', href: '/admin/audit' },
  '/admin/devices': { segment: 'devices', label: 'Devices', href: '/admin/devices' },
  '/admin/devices/enrollments': {
    segment: 'enrollments',
    label: 'Enrollments',
    href: '/admin/devices/enrollments',
  },
  '/admin/devices/unmatched': {
    segment: 'unmatched',
    label: 'Unmatched scans',
    href: '/admin/devices/unmatched',
  },
}

export interface Crumb {
  label: string
  href: string | null
}

/** A YYYY-MM-DD segment, which /calendar/[date] uses. */
const DATE_SEGMENT = /^\d{4}-\d{2}-\d{2}$/
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function labelForDynamic(segment: string): string {
  if (DATE_SEGMENT.test(segment)) {
    return new Date(`${segment}T12:00:00Z`).toLocaleDateString('en-KE', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
  }
  // A raw uuid is noise in a breadcrumb; the page supplies a real name via
  // `lastLabel` when it has one.
  if (UUID_SEGMENT.test(segment)) return 'Details'
  return segment
}

/**
 * Breadcrumb trail for a pathname, always rooted at the dashboard.
 *
 * `lastLabel` lets a page name its own final crumb — "James Epale" instead of
 * "Details" on /admin/users/[id] — without every page having to build the
 * whole trail.
 */
export function crumbsFor(pathname: string, lastLabel?: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: 'Dashboard', href: '/' }]
  if (pathname === '/') return crumbs

  const segments = pathname.split('/').filter(Boolean)
  let accumulated = ''

  segments.forEach((segment, index) => {
    accumulated += `/${segment}`
    const known = ROUTE_LABELS[accumulated]
    const isLast = index === segments.length - 1

    if (known) {
      crumbs.push({ label: known.label, href: known.href })
      return
    }

    // Unknown segment: either a dynamic one, or a route added without a label.
    // Look for a registered dynamic sibling before falling back.
    const parent = accumulated.slice(0, accumulated.lastIndexOf('/')) || '/'
    const dynamicKey = Object.keys(ROUTE_LABELS).find(
      (key) => key.startsWith(`${parent}/[`) && key.lastIndexOf('/') === parent.length
    )

    crumbs.push({
      label: dynamicKey ? labelForDynamic(segment) : labelForDynamic(segment),
      href: isLast ? null : accumulated,
    })
  })

  if (lastLabel && crumbs.length > 1) {
    crumbs[crumbs.length - 1] = { ...crumbs[crumbs.length - 1], label: lastLabel }
  }

  // The page you are on is not a link to itself.
  if (crumbs.length > 1) crumbs[crumbs.length - 1].href = null

  return crumbs
}

/** The current screen's own label, for the document title and tour lookup. */
export function routeKeyFor(pathname: string): string {
  if (ROUTE_LABELS[pathname]) return pathname

  // Collapse a dynamic segment back to its registered key so /calendar/2026-08-20
  // resolves to /calendar/[date].
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return '/'
  const parent = `/${segments.slice(0, -1).join('/')}`
  const dynamicKey = Object.keys(ROUTE_LABELS).find(
    (key) => key.startsWith(`${parent}/[`) && key.lastIndexOf('/') === parent.length
  )
  return dynamicKey ?? pathname
}
