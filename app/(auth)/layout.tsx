import Image from 'next/image'
import ThemeToggle from '@/components/shell/ThemeToggle'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      {/* Artwork panel. The same render the Portal Hub uses on its Attendance
          card, so arriving here from the hub feels continuous. Hidden below lg:
          on a branch phone the form should own the screen. */}
      <div className="relative hidden w-1/2 shrink-0 overflow-hidden border-r border-border bg-brand-ink lg:block">
        <Image
          src="/hero-attendance.png"
          alt=""
          fill
          priority
          sizes="50vw"
          className="object-cover object-center opacity-90"
        />
        {/* Scrim so the copy stays readable over the busiest part of the art. */}
        <div className="absolute inset-0 bg-gradient-to-t from-brand-ink via-brand-ink/40 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-10">
          <h2 className="max-w-sm text-2xl font-bold leading-tight text-white">
            One place for every shift, across every Citywalk branch.
          </h2>
          <p className="mt-2 max-w-sm text-sm text-white/70">
            Clock in and out, request leave, and see your hours — from the shop floor or your phone.
          </p>
        </div>
      </div>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex justify-end p-4">
          <ThemeToggle />
        </div>

        <div className="flex flex-1 items-center justify-center px-4 pb-16">
          <div className="w-full max-w-sm space-y-6">
            <div className="flex flex-col items-center gap-2 text-center">
              <Image
                src="/logo-wordmark.png"
                alt="Citywalk"
                width={158}
                height={53}
                priority
                className="h-auto w-[150px] dark:brightness-0 dark:invert"
              />
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Attendance
              </span>
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
