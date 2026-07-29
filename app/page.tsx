import { Suspense } from "react";
import { Dashboard } from "@/components/dashboard";

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
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="h-8 w-56 animate-pulse rounded bg-surface-2" />
      <div className="mt-6 h-14 animate-pulse rounded-xl bg-surface" />
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-surface" />
        ))}
      </div>
      <div className="mt-4 h-80 animate-pulse rounded-xl bg-surface" />
    </div>
  );
}
