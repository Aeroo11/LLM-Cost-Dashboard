export const DASHBOARD_VIEWS = {
  overview: "Cost Overview",
  "cost-breakdown": "Cost breakdown",
  anomalies: "Anomalies",
  simulator: "Simulator",
  requests: "Requests",
} as const;

export type DashboardView = keyof typeof DASHBOARD_VIEWS;

export function parseDashboardView(raw: string | null): DashboardView {
  return raw && Object.hasOwn(DASHBOARD_VIEWS, raw) ? raw as DashboardView : "overview";
}

export function dashboardViewHref(view: DashboardView, pathname = "/", query = ""): string {
  const params = new URLSearchParams(query);
  if (view === "overview") params.delete("view");
  else params.set("view", view);
  return params.size ? `${pathname}?${params}` : pathname;
}
