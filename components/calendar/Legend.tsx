// Explains only the two markers that are not self-evident.
//
// The old "Less → More" colour scale described a heatmap that no longer
// exists: hours are now a number and a progress bar, which need no key. A
// legend for something the reader can already read is just noise.
export default function Legend() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-full bg-primary" />
        Today
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-brand-gold" />
        Approved leave
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-1 w-6 overflow-hidden rounded-full bg-border">
          <span className="block h-full w-2/3 rounded-full bg-primary" />
        </span>
        Progress to your daily target
      </span>
    </div>
  )
}
