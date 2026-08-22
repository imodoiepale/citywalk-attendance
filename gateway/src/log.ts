// Structured single-line JSON logs. The gateway runs unattended on a VPS and
// the log is the only witness to what a terminal sent, so every line has to be
// greppable and machine-readable without a log shipper.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const
export type Level = keyof typeof LEVELS

const threshold = LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? LEVELS.info

function emit(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (LEVELS[level] < threshold) return
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields })
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n')
  else process.stdout.write(line + '\n')
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => emit('debug', msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit('info', msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit('warn', msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit('error', msg, f),
}

/** Errors are not JSON-serialisable; this makes them so without losing the stack. */
export function errFields(e: unknown): Record<string, unknown> {
  if (e instanceof Error) return { error: e.message, stack: e.stack }
  return { error: String(e) }
}
