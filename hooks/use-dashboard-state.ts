"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { parseWindowKey, type WindowKey } from "@/lib/api-types";
import { dashboardViewHref, parseDashboardView, type DashboardView } from "@/lib/dashboard-views";
import {
  hasAnyFilter,
  parseFilters,
  serialiseFilters,
  type MetricFilters,
} from "@/lib/db/filters";

/**
 * Dashboard state, kept in the URL rather than in React state.
 *
 * The point is shareability: "the RAG spike on GPT-4o over 7 days" should be a
 * link you can paste to a colleague, and a reload should not silently drop you
 * back to the default view. It also means the server can parse exactly the same
 * query string the client is showing, so there is one representation of the
 * filters instead of two that can drift.
 */

export type FilterDimension = keyof MetricFilters;

export interface DashboardState {
  view: DashboardView;
  windowKey: WindowKey;
  filters: MetricFilters;
  /** Query string for the API, including the window. */
  queryString: string;
  hasFilters: boolean;
}

export interface DashboardActions {
  getViewHref: (view: DashboardView) => string;
  setView: (view: DashboardView) => void;
  setWindow: (key: WindowKey) => void;
  toggleFilter: (dimension: FilterDimension, value: string) => void;
  setFilter: (dimension: FilterDimension, values: string[]) => void;
  clearFilters: () => void;
}

export function useDashboardState(): DashboardState & DashboardActions {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const windowKey = parseWindowKey(searchParams.get("window"));
  const view = parseDashboardView(searchParams.get("view"));
  // Re-parsing rather than trusting the URL text keeps client and server
  // agreeing on what a filter set means, including which values are valid.
  const filters = useMemo(
    () => parseFilters(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const queryString = useMemo(() => {
    const params = new URLSearchParams(serialiseFilters(filters));
    params.set("window", windowKey);
    return params.toString();
  }, [filters, windowKey]);

  const updateUrl = useCallback(
    (next: { windowKey?: WindowKey; filters?: MetricFilters }) => {
      const params = new URLSearchParams(
        serialiseFilters(next.filters ?? filters),
      );
      const w = next.windowKey ?? windowKey;
      // The default window is implicit, so the common case stays a clean URL.
      if (w !== "24h") params.set("window", w);

      const url = new URL(window.location.href);
      // Next syncs replaceState with useSearchParams. The dashboard loads its
      // data through SSE, so changing these filters needs no route fetch.
      const currentView = parseDashboardView(url.searchParams.get("view"));
      window.history.replaceState(null, "", dashboardViewHref(currentView, url.pathname, params.toString()));
    },
    [filters, windowKey],
  );

  const setWindow = useCallback(
    (key: WindowKey) => updateUrl({ windowKey: key }),
    [updateUrl],
  );

  const setFilter = useCallback(
    (dimension: FilterDimension, values: string[]) =>
      updateUrl({ filters: { ...filters, [dimension]: values } as MetricFilters }),
    [filters, updateUrl],
  );

  const toggleFilter = useCallback(
    (dimension: FilterDimension, value: string) => {
      const current: string[] = filters[dimension];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      setFilter(dimension, next);
    },
    [filters, setFilter],
  );

  const clearFilters = useCallback(
    () => updateUrl({ filters: { models: [], endpoints: [], statuses: [] } }),
    [updateUrl],
  );

  const getViewHref = useCallback(
    (next: DashboardView) => dashboardViewHref(next, pathname, searchParams.toString()),
    [pathname, searchParams],
  );

  const setView = useCallback((next: DashboardView) => {
    const url = new URL(window.location.href);
    const href = dashboardViewHref(next, url.pathname, url.search);
    if (href !== `${url.pathname}${url.search}${url.hash}`) {
      window.history.pushState(null, "", href);
    }
  }, []);

  return {
    view,
    getViewHref,
    setView,
    windowKey,
    filters,
    queryString,
    hasFilters: hasAnyFilter(filters),
    setWindow,
    toggleFilter,
    setFilter,
    clearFilters,
  };
}
