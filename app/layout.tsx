import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted rather than next/font/google. The Google Fonts fetch happens at
// BUILD time, so a build machine that cannot reach fonts.googleapis.com fails
// the whole deploy — which is exactly what happened here. Shipping the woff2
// from @fontsource-variable/inter makes the build hermetic, and it is the same
// typeface, still preloaded and self-hosted the way next/font/google would
// have ended up serving it anyway.
const inter = localFont({
  src: [
    {
      path: "../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
      style: "normal",
    },
    {
      path: "../node_modules/@fontsource-variable/inter/files/inter-latin-wght-italic.woff2",
      style: "italic",
    },
  ],
  variable: "--font-inter",
  display: "swap",
  weight: "100 900",
  fallback: ["system-ui", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
});

const APP_NAME = "Citywalk Attendance";
const APP_DEFAULT_TITLE = "Citywalk Attendance";
const APP_TITLE_TEMPLATE = "%s · Citywalk Attendance";
const APP_DESCRIPTION = "Clock in and out, track shifts and hours across Citywalk branches";

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: {
    default: APP_DEFAULT_TITLE,
    template: APP_TITLE_TEMPLATE,
  },
  description: APP_DESCRIPTION,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/logo-mark.png", type: "image/png" }],
    apple: [{ url: "/logo-mark.png", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: APP_DEFAULT_TITLE,
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: {
      default: APP_DEFAULT_TITLE,
      template: APP_TITLE_TEMPLATE,
    },
    description: APP_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#0B0D10",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <link rel="icon" href="/logo-mark.png" type="image/png" />
      </head>
      {/* suppressHydrationWarning here for the same reason it is on <html>:
          browser extensions inject attributes into these two elements before
          React hydrates. Observed in the wild on this app: cz-shortcut-listen
          (ColorZilla) and contenteditable on <body>, and aria-autocomplete on
          password fields from password managers. Those mismatches are noise we
          cannot fix from here. It is deliberately NOT applied any deeper —
          inside the app a mismatch is our bug and should stay loud. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
