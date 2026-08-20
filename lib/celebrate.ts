// Confetti in the Citywalk palette, fired when someone's leave is approved.
//
// Gated on prefers-reduced-motion — the same rule the dial's animations follow.
// A burst of moving particles is exactly the kind of thing that setting exists
// to suppress, and the toast still carries the message without it.

const GOLD = ['#FFD000', '#E6B300', '#D7A900', '#B58B00', '#FFFFFF']

export async function celebrate() {
  if (typeof window === 'undefined') return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  // Imported on demand so the library is not in the bundle for the many page
  // loads that never celebrate anything.
  const confetti = (await import('canvas-confetti')).default

  const fire = (particleRatio: number, options: Record<string, unknown>) => {
    confetti({
      origin: { y: 0.7 },
      colors: GOLD,
      disableForReducedMotion: true,
      particleCount: Math.floor(200 * particleRatio),
      ...options,
    })
  }

  // Layered bursts rather than one blast: a single emit reads as a glitch,
  // staggered spreads read as a celebration.
  fire(0.25, { spread: 26, startVelocity: 55 })
  fire(0.2, { spread: 60 })
  fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 })
  fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 })
  fire(0.1, { spread: 120, startVelocity: 45 })
}
