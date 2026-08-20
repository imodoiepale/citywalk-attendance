import { PageSkeleton, Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <PageSkeleton>
      <Skeleton className="mx-auto h-36 w-36 rounded-full" />
      <Skeleton className="h-80 w-full rounded-2xl" />
    </PageSkeleton>
  )
}
