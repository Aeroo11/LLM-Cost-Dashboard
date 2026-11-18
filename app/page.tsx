import { Suspense } from "react";
import { Dashboard } from "@/components/dashboard";
import { DashboardShell } from "@/components/dashboard-shell";
import { ChartSkeleton, PanelSkeleton, Skeleton } from "@/components/ui/skeleton";

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

function DashboardSkeleton() {
  return (
    <DashboardShell>
      <div id="dashboard-main" tabIndex={-1} className="min-w-0 px-4 pb-10 sm:px-7 lg:px-8" aria-busy="true">
        <div className="flex flex-wrap items-center justify-between gap-3 py-5 sm:py-6">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-8 w-40" />
        </div>
        <Skeleton className="h-[42px] w-full" />
        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="bg-surface px-3.5 py-3.5 sm:px-5 sm:py-4">
              <Skeleton className="h-3 w-20 max-w-full" />
              <Skeleton className="mt-2 h-7 w-24 max-w-full" />
              <Skeleton className="mt-2 h-3 w-28 max-w-full" />
            </div>
          ))}
        </div>
        <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_304px]">
          <ChartSkeleton height={300} className="xl:min-h-[480px]" />
          <PanelSkeleton lines={3} />
        </div>
      </div>
    </DashboardShell>
  );
}
