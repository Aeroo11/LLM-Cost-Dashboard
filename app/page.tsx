import { Suspense } from "react";
import { Dashboard } from "@/components/dashboard";
import { Card } from "@/components/ui/card";
import { ChartSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function Home() {
  return (
    <main className="min-h-screen">
      {/*
        The dashboard reads its filters from the URL via useSearchParams, which
        needs a suspense boundary so the shell can still be prerendered.
      */}
      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard />
      </Suspense>
    </main>
  );
}

/**
 * Mirrors the real layout above the fold: header, filter bar, then the hero
 * KPI block as a 2x2 with the hero spanning both rows. It has to agree with
 * what the Dashboard renders in its own loading state, or the handover between
 * the two flashes.
 */
function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-6 w-64" />
        </div>
        <Skeleton className="h-8 w-40" />
      </div>

      <Card padded={false} className="mt-6 px-4 py-3">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="mt-3 h-6 w-2/3" />
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:grid-rows-2">
        <Card className="lg:col-span-2 lg:row-span-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-4 h-12 w-48" />
          <Skeleton className="mt-6 h-32 w-full" />
        </Card>
        {[0, 1, 2, 3].map((i) => (
          <Card key={i}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-4 h-7 w-28" />
            <Skeleton className="mt-3 h-3 w-32" />
          </Card>
        ))}
      </div>

      <ChartSkeleton height={260} className="mt-4" />
    </div>
  );
}
