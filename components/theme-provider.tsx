'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type { ComponentProps } from 'react'

// Thin wrapper, same shape as citywalk-portals-hub's, so both apps are
// configured identically. next-themes injects a blocking script that sets the
// class before first paint — without it a dark-mode user gets a white flash on
// every navigation.
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
