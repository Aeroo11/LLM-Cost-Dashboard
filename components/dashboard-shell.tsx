"use client";

import type { ComponentProps, MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { Activity, ChartNoAxesCombined, LayoutDashboard, Menu, Network, SlidersHorizontal, Table2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { dashboardViewHref, type DashboardView } from "@/lib/dashboard-views";

const SECTIONS = [
  { label: "Overview", view: "overview", icon: LayoutDashboard },
  { label: "Cost breakdown", view: "cost-breakdown", icon: ChartNoAxesCombined },
  { label: "Anomalies", view: "anomalies", icon: TriangleAlert },
  { label: "Simulator", view: "simulator", icon: SlidersHorizontal },
  { label: "Requests", view: "requests", icon: Table2 },
] as const;

interface ViewNavigation {
  getViewHref?: (view: DashboardView) => string;
  onViewNavigate?: (view: DashboardView) => void;
}

export function DashboardViewLink({ view, getViewHref = dashboardViewHref, onViewNavigate, ...props }:
  ViewNavigation & Omit<ComponentProps<typeof Link>, "href" | "onNavigate"> & { view: DashboardView }) {
  return (
    <Link
      {...props}
      href={getViewHref(view)}
      prefetch={false}
      onNavigate={(event) => {
        if (!onViewNavigate) return;
        event.preventDefault();
        onViewNavigate(view);
      }}
    />
  );
}

function Brand(navigation: ViewNavigation) {
  return (
    <DashboardViewLink view="overview" {...navigation} className="inline-flex items-center gap-2.5 rounded-control text-base font-semibold tracking-tight focus-visible:ring-2 focus-visible:ring-accent">
      <span className="grid size-8 shrink-0 place-items-center rounded-control bg-accent text-surface" aria-hidden>
        <Activity size={17} strokeWidth={2} />
      </span>
      TokenWatch
    </DashboardViewLink>
  );
}

function Navigation({ active, onClick, ...navigation }: ViewNavigation & { active: DashboardView; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  return (
    <nav aria-label="Dashboard sections" className="grid gap-1">
      {SECTIONS.map(({ label, view, icon: Icon }) => (
        <DashboardViewLink
          key={view}
          view={view}
          {...navigation}
          aria-current={active === view ? "page" : undefined}
          onClick={onClick}
          className={cn(
            "flex min-h-10 items-center gap-2.5 rounded-control px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-accent",
            active === view ? "bg-accent-soft font-semibold text-accent" : "font-medium text-text-muted hover:bg-surface-2 hover:text-text",
          )}
        >
          <Icon size={16} strokeWidth={1.65} className="shrink-0" aria-hidden />
          {label}
        </DashboardViewLink>
      ))}
    </nav>
  );
}

export function DashboardShell({ children, view = "overview", ...navigation }: ViewNavigation & {
  children: ReactNode;
  view?: DashboardView;
}) {
  function closeMobileMenu(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.currentTarget.closest("details")?.removeAttribute("open");
  }

  return (
    <div className="mx-auto min-h-screen max-w-[1760px] lg:grid lg:grid-cols-[200px_minmax(0,1fr)]">
      <a href="#dashboard-main" className="sr-only z-50 rounded-control bg-surface px-3 py-2 text-sm font-medium text-accent focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:ring-2 focus:ring-accent">
        Skip to dashboard
      </a>
      <aside className="hidden border-r border-border bg-surface lg:block">
        <div className="sticky top-0 flex h-dvh flex-col px-3.5 py-5">
          <div className="mb-5 border-b border-border px-2 pb-5"><Brand {...navigation} /></div>
          <Navigation active={view} {...navigation} />
          <div className="mt-auto flex items-center gap-2 rounded-control bg-surface-2 px-3 py-2.5 text-xs font-medium text-text-muted">
            <Network size={14} aria-hidden className="shrink-0" />
            Simulated traffic
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 sm:px-6 lg:hidden">
          <Brand {...navigation} />
          <details className="relative">
            <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-control border border-border px-3 text-sm text-text-muted hover:text-text focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
              <Menu size={15} aria-hidden /> Menu
            </summary>
            <div className="absolute right-0 top-full z-30 mt-2 w-48 rounded-panel border border-border bg-surface p-2 shadow-pop">
              <Navigation active={view} onClick={closeMobileMenu} {...navigation} />
            </div>
          </details>
        </div>
        {children}
      </div>
    </div>
  );
}
