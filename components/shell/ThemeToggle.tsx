'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'

/**
 * Sun/moon crossfade, matching the hub's TopActions control.
 *
 * The icons are swapped by the `dark:` variant in CSS rather than by reading
 * the theme in JS, so they are already correct in the server-rendered HTML.
 * `resolvedTheme` is only read inside the click handler, which cannot run
 * before hydration — so there is no mismatch to guard against and no need for a
 * mounted flag.
 */
export default function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      aria-label="Toggle light and dark mode"
      title="Toggle theme"
      className={cn(
        'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 ease-standard hover:bg-card-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
    >
      <Sun
        className="h-[18px] w-[18px] rotate-0 scale-100 transition-all duration-200 ease-standard dark:-rotate-90 dark:scale-0"
        strokeWidth={1.8}
        aria-hidden="true"
      />
      <Moon
        className="absolute h-[18px] w-[18px] rotate-90 scale-0 transition-all duration-200 ease-standard dark:rotate-0 dark:scale-100"
        strokeWidth={1.8}
        aria-hidden="true"
      />
    </button>
  )
}
